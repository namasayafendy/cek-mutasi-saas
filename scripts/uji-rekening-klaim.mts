// Uji Tahap 2 "rekening pemilik klaim" — dijalankan manual, bukan bagian build.
//   npx tsx scripts/uji-rekening-klaim.mts
// Murni: aturan (lib/pipeline/rekeningKlaim.ts) + mesin pencocok sungguhan
// (lib/matching.ts runMatching, opsi bankKetat). Tanpa database.
import { susunAturanRekening, pemilikKlaim, TANPA_REKENING, arahBawaanRekeningLain, lewatiPassRekeningLain } from "../lib/pipeline/rekeningKlaim.ts";
import { runMatching } from "../lib/matching.ts";
import type { PdfTransaction, UserInput } from "../lib/types.ts";

let lulus = 0;
let gagal = 0;
const cek = (nama: string, benar: boolean, ket = "") => {
  if (benar) lulus++;
  else gagal++;
  console.log(`  ${benar ? "ok  " : "GAGAL"} ${nama}${!benar && ket ? "  — " + ket : ""}`);
};

const MASUK = { id: "bank-masuk", peran: "MASUK" as const, nomor_rekening: "1999881994", is_active: true };
const KELUAR = { id: "bank-keluar", peran: "KELUAR" as const, nomor_rekening: "1999881919", mulai_tgl: "2026-11-01", is_active: true };

console.log("\n1. Aturan MATI tanpa rekening KELUAR (semua akun hari ini)");
{
  const a = susunAturanRekening([{ id: "b1" }, { id: "b2", peran: "MASUK" }]);
  cek("aktif=false", a.aktif === false);
  cek("tanpa masalah", a.masalah === null);
  cek("pemilikKlaim → null (pemanggil pakai perilaku lama)", pemilikKlaim(a, "debet", "2026-11-05") === null);
  cek("akun kosong → mati", susunAturanRekening([]).aktif === false && susunAturanRekening([]).masalah === null);
}

console.log("\n2. Konfigurasi KELUAR tidak lengkap → masalah (pass ditolak)");
{
  cek("KELUAR tanpa tanggal mulai", !!susunAturanRekening([MASUK, { ...KELUAR, mulai_tgl: null }]).masalah);
  cek("KELUAR tanpa MASUK", !!susunAturanRekening([KELUAR]).masalah);
  cek("dua KELUAR", !!susunAturanRekening([MASUK, KELUAR, { ...KELUAR, id: "k2" }]).masalah);
  cek("dua MASUK", !!susunAturanRekening([MASUK, { ...MASUK, id: "m2" }, KELUAR]).masalah);
  cek("KELUAR nonaktif", !!susunAturanRekening([MASUK, { ...KELUAR, is_active: false }]).masalah);
  cek("MASUK nonaktif saja", !!susunAturanRekening([{ ...MASUK, is_active: false }, KELUAR]).masalah);
  cek("tanggal mulai rusak", !!susunAturanRekening([MASUK, { ...KELUAR, mulai_tgl: "1/11/2026" }]).masalah);
  cek("KELUAR tanpa nomor", !!susunAturanRekening([MASUK, { ...KELUAR, nomor_rekening: null }]).masalah);
  cek("MASUK tanpa nomor", !!susunAturanRekening([{ ...MASUK, nomor_rekening: "" }, KELUAR]).masalah);
}

console.log("\n3. Aturan AKTIF: pemilik per klaim");
{
  const a = susunAturanRekening([MASUK, KELUAR]);
  cek("aktif", a.aktif === true);
  cek("KREDIT → MASUK (kapan pun)", pemilikKlaim(a, "kredit", "2026-12-01") === "bank-masuk");
  cek("DEBET sebelum garis → MASUK", pemilikKlaim(a, "debet", "2026-10-31") === "bank-masuk");
  cek("DEBET tepat di garis → KELUAR", pemilikKlaim(a, "debet", "2026-11-01") === "bank-keluar");
  cek("DEBET sesudah garis → KELUAR", pemilikKlaim(a, "debet", "2026-11-15") === "bank-keluar");
  cek("DEBET tanggal tak terbaca → TANPA_REKENING (tidak ditebak)", pemilikKlaim(a, "debet", "") === TANPA_REKENING);
  cek("eksplisit nomor KELUAR (Setor Cash Pusat ke KELUAR) mengalahkan KREDIT→MASUK",
    pemilikKlaim(a, "kredit", "2026-11-05", "1999881919") === "bank-keluar");
  cek("eksplisit nomor MASUK (debet Fendy dari MASUK) mengalahkan DEBET→KELUAR",
    pemilikKlaim(a, "debet", "2026-11-05", "1999-881-994") === "bank-masuk");
  cek("eksplisit nomor tak terdaftar → TANPA_REKENING", pemilikKlaim(a, "kredit", "2026-11-05", "7777777") === TANPA_REKENING);
  cek("eksplisit kosong → aturan bawaan", pemilikKlaim(a, "kredit", "2026-11-05", "") === "bank-masuk");
}

// ── Mesin pencocok sungguhan ──
const ATURAN = { lookback_days: 3, forward_window_days: 1, match_mode: "exact" as const, tolerance_rp: 0, tolerance_pct: 0 };
let no = 0;
const tx = (bankId: string, iso: string, kredit: number, o: Partial<PdfTransaction> = {}): PdfTransaction => ({
  no: ++no, tanggal: iso.split("-").reverse().join("/"),
  tanggalDate: new Date(`${iso}T12:00:00Z`), waktu: "10.00",
  namaPengirim: "", deskripsi: "", kredit,
  bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
  page: 1, noRef: `FTX${no}`, bankId, parsedTxId: `tx-${no}`,
  claimedByOther: false, ...o,
} as any);
const inp = (id: string, bankId: string, iso: string, nominal: number, o: Partial<UserInput> = {}): UserInput => ({
  id, tanggal: new Date(`${iso}T12:00:00Z`), nominal, jenis: "kredit",
  outletId: "o", bankId, matchRuleId: "r", refFt: null, jamResi: null, namaPengirimResi: null,
  ...o,
} as any);
const jalan = (ins: UserInput[], txs: PdfTransaction[], opsi: Record<string, unknown> = {}) =>
  runMatching(ins, txs, new Map(), { getRulesForInput: () => ATURAN, ...opsi }).inputs;
const st = (out: UserInput[], id: string) => (out.find((x) => x.id === id)!.match as any)?.status;
const txOf = (out: UserInput[], id: string) => (out.find((x) => x.id === id)!.match as any)?.txId ?? (out.find((x) => x.id === id)!.match as any)?.parsedTxId;

console.log("\n4. Klaim DEBET milik KELUAR vs baris MASUK yang sama tanggal + nominal");
{
  no = 0;
  const txs = [tx("bank-masuk", "2026-11-05", 1_500_000)];
  const lama = jalan([inp("TFKD-1", "", "2026-11-05", 1_500_000)], txs);
  cek("PERILAKU LAMA (bankId kosong): cocok palsu ke baris MASUK", st(lama, "TFKD-1") === "matched", st(lama, "TFKD-1"));
  const baru = jalan([inp("TFKD-1", "bank-keluar", "2026-11-05", 1_500_000)], txs, { bankKetat: true });
  cek("KETAT: tidak cocok ke rekening lain", st(baru, "TFKD-1") !== "matched", st(baru, "TFKD-1"));
}

console.log("\n5. PASS 1 REF (biasanya tanpa saringan bank)");
{
  no = 0;
  const txs = [tx("bank-masuk", "2026-11-05", 750_000, { noRef: "FT26309ABCDEF/213" } as any)];
  const lama = jalan([inp("TFK-2", "bank-keluar", "2026-11-05", 750_000, { refFt: "FT26309ABCDEF" })], txs);
  cek("lama: REF menyeberang bank", st(lama, "TFK-2") === "matched", st(lama, "TFK-2"));
  const baru = jalan([inp("TFK-2", "bank-keluar", "2026-11-05", 750_000, { refFt: "FT26309ABCDEF" })], txs, { bankKetat: true });
  cek("ketat: REF tidak menyeberang bank", st(baru, "TFK-2") !== "matched", st(baru, "TFK-2"));
  const sendiri = jalan([inp("TFK-3", "bank-masuk", "2026-11-05", 750_000, { refFt: "FT26309ABCDEF" })], txs, { bankKetat: true });
  cek("ketat: REF di rekeningnya sendiri tetap cocok", st(sendiri, "TFK-3") === "matched", st(sendiri, "TFK-3"));
}

console.log("\n6. Klaim di rekeningnya sendiri tetap cocok seperti biasa; rekening lain diabaikan");
{
  no = 0;
  const txs = [tx("bank-masuk", "2026-11-05", 300_000), tx("bank-keluar", "2026-11-05", 300_000)];
  const out = jalan([inp("TFKD-4", "bank-keluar", "2026-11-05", 300_000)], txs, { bankKetat: true });
  cek("cocok", st(out, "TFKD-4") === "matched", st(out, "TFKD-4"));
  const m = out[0].match as any;
  cek("cocok ke baris KELUAR (bukan MASUK)", m?.txBankId === "bank-keluar" || m?.bankId === "bank-keluar" || (m?.tx?.bankId ?? m?.txBankId) === "bank-keluar", JSON.stringify(m).slice(0, 200));
}

console.log("\n7. Leftover re-run lintas bank (forceCrossBank) diabaikan untuk klaim ber-rekening");
{
  no = 0;
  const txs = [tx("bank-masuk", "2026-11-05", 99_000)];
  const out = jalan([inp("TFKD-5", "bank-keluar", "2026-11-05", 99_000)], txs, { bankKetat: true, forceCrossBank: true });
  cek("tetap tidak menyeberang", st(out, "TFKD-5") !== "matched", st(out, "TFKD-5"));
}

console.log("\n8. Input 'Semua bank' (bankId kosong, ketik manual di /check) tetap lintas bank walau ketat");
{
  no = 0;
  const txs = [tx("bank-keluar", "2026-11-05", 45_000)];
  const out = jalan([inp("M-1", "", "2026-11-05", 45_000)], txs, { bankKetat: true });
  cek("cocok", st(out, "M-1") === "matched", st(out, "M-1"));
}

console.log("\n9. Klaim TANPA_REKENING tidak pernah cocok");
{
  no = 0;
  const txs = [tx("bank-masuk", "2026-11-05", 12_000), tx("bank-keluar", "2026-11-05", 12_000)];
  const out = jalan([inp("TFKD-6", TANPA_REKENING, "2026-11-05", 12_000)], txs, { bankKetat: true });
  cek("tidak cocok", st(out, "TFKD-6") !== "matched", st(out, "TFKD-6"));
}

console.log("\n10. bankKetat mati = hasil PERSIS seperti tanpa opsi (perilaku lama)");
{
  no = 0;
  const txs = [tx("bank-masuk", "2026-11-05", 1_000), tx("bank-keluar", "2026-11-06", 2_000, { noRef: "FTREF99/213" } as any)];
  const ins = [
    inp("A", "", "2026-11-05", 1_000),
    inp("B", "bank-masuk", "2026-11-06", 2_000, { refFt: "FTREF99" }),
    inp("C", "bank-keluar", "2026-11-05", 1_000),
  ];
  const a = JSON.stringify(jalan(ins, txs).map((i) => i.match));
  const b = JSON.stringify(jalan(ins, txs, { bankKetat: false }).map((i) => i.match));
  cek("identik", a === b);
}

console.log("\n11. Pass dua rekening yang dilewati sebagai info (bukan 🚨 TIDAK_ADA_KLAIM / PERIODE_KOSONG)");
{
  const on = susunAturanRekening([MASUK, KELUAR]);
  const off = susunAturanRekening([MASUK]);
  // klaimLain / adaInput hanya keterangan skenario: keputusan TIDAK boleh
  // bergantung padanya (tinjauan 31 Okt — arah rumah tetap alarm).
  const L = (o: { aturan?: any; bankId: string; arah: "kredit" | "debet"; periodEnd: string | null;
                  klaimMilik?: number; klaimDibuangMilik?: number; klaimLain?: number; adaInput?: boolean }) =>
    lewatiPassRekeningLain({
      aturan: o.aturan ?? on, bankId: o.bankId, arah: o.arah, periodEnd: o.periodEnd,
      klaimMilik: o.klaimMilik ?? 0, klaimDibuangMilik: o.klaimDibuangMilik ?? 0,
    });

  // arah bawaan
  cek("bawaan: kredit di KELUAR → rekening lain", arahBawaanRekeningLain(on, "bank-keluar", "kredit", "2026-11-02"));
  cek("bawaan: kredit di MASUK → BUKAN", !arahBawaanRekeningLain(on, "bank-masuk", "kredit", "2026-11-02"));
  cek("bawaan: debet di KELUAR → BUKAN", !arahBawaanRekeningLain(on, "bank-keluar", "debet", "2026-11-02"));
  cek("bawaan: debet MASUK periode sampai 2026-11-01 → rekening lain", arahBawaanRekeningLain(on, "bank-masuk", "debet", "2026-11-01"));
  cek("bawaan: debet MASUK periode sampai 2026-10-31 → BUKAN", !arahBawaanRekeningLain(on, "bank-masuk", "debet", "2026-10-31"));
  cek("bawaan: debet MASUK tanggal tak terbaca → BUKAN (gagal-tertutup)", !arahBawaanRekeningLain(on, "bank-masuk", "debet", null));
  cek("bawaan: aturan mati → BUKAN", !arahBawaanRekeningLain(off, "bank-masuk", "debet", "2026-11-02"));

  // kasus yang dulu berbunyi 🚨 setiap hari
  cek("MASUK·debet hanya pemegang lemah, sesudah garis → lewat", L({ bankId: "bank-masuk", arah: "debet", periodEnd: "2026-11-02", adaInput: true }));
  cek("MASUK·debet hanya pemegang + klaim KELUAR menunggu → lewat", L({ bankId: "bank-masuk", arah: "debet", periodEnd: "2026-11-02", adaInput: true, klaimLain: 2 }));
  cek("MASUK·debet periode menyentuh garis (31/10–01/11), hanya pemegang → lewat", L({ bankId: "bank-masuk", arah: "debet", periodEnd: "2026-11-01", adaInput: true }));
  cek("KELUAR·kredit tanpa klaim sama sekali → lewat", L({ bankId: "bank-keluar", arah: "kredit", periodEnd: "2026-11-02" }));
  cek("KELUAR·kredit hanya pemegang → lewat", L({ bankId: "bank-keluar", arah: "kredit", periodEnd: "2026-11-02", adaInput: true }));
  cek("KELUAR·debet tanpa input + klaim rekening lain → TETAP alarm (arah rumah)", !L({ bankId: "bank-keluar", arah: "debet", periodEnd: "2026-11-02", klaimLain: 3 }));
  cek("MASUK·kredit tanpa input + setoran KIRIM menunggu → TETAP alarm (arah rumah)", !L({ bankId: "bank-masuk", arah: "kredit", periodEnd: "2026-11-02", klaimLain: 1 }));

  // yang TETAP alarm
  cek("MASUK·kredit hanya pemegang, PENDING 0 → TETAP alarm", !L({ bankId: "bank-masuk", arah: "kredit", periodEnd: "2026-11-02", adaInput: true }));
  cek("MASUK·kredit tanpa klaim → TETAP alarm", !L({ bankId: "bank-masuk", arah: "kredit", periodEnd: "2026-11-02" }));
  cek("KELUAR·debet tanpa klaim → TETAP alarm", !L({ bankId: "bank-keluar", arah: "debet", periodEnd: "2026-11-02" }));
  cek("MASUK·debet sebelum garis tanpa klaim → TETAP alarm", !L({ bankId: "bank-masuk", arah: "debet", periodEnd: "2026-10-31", adaInput: true }));
  cek("ada satu klaim milik (bukan pemegang) → TIDAK dilewati", !L({ bankId: "bank-masuk", arah: "debet", periodEnd: "2026-11-02", adaInput: true, klaimMilik: 1 }));
  cek("KELUAR·kredit dengan 1 setoran KIRIM milik → TIDAK dilewati", !L({ bankId: "bank-keluar", arah: "kredit", periodEnd: "2026-11-02", adaInput: true, klaimMilik: 1 }));
  cek("klaim milik dibuang (data rusak) → TETAP alarm", !L({ bankId: "bank-masuk", arah: "debet", periodEnd: "2026-11-02", adaInput: true, klaimDibuangMilik: 1 }));
  cek("aturan mati → TIDAK pernah dilewati", !L({ aturan: off, bankId: "bank-masuk", arah: "debet", periodEnd: "2026-11-02", klaimLain: 5 }));
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal > 0) process.exit(1);
