// Uji pagar (d) PASS 4: tebakan NOMINAL tidak boleh mengambil baris yang
// jam DAN nama resinya sendiri membantah (1 Oktober 2026).
//
// Asal: kalibrasi ke data hidup 60 hari (cek_inputs matched_by NOMINAL yang
// resinya berjam & bernama). Satu-satunya yang bertentangan:
//   SJB-2-0056 (LANGSA, 11 Agu 2026, Rp 2.530.000) — resi a.n. ANDINI
//   SAHPUTRI pukul 12:03 ref FT26223FW5JK; yang diambil baris 12.15 a.n.
//   MUHAMMAD SIDDIQ (ref FT262233KZP0, nasabah Langsa lain).
// Insiden pembanding SJB-1-0186 (10 Agu, Rp 460.000) yang mengambil uang
// SBR-4-0182 lewat PASS 4: resinya TANPA nama, jadi pagar ini diam — ia
// ditahan pagar (c). Varian bernamanya diuji di bagian 5.
//
// Satu bantahan saja TIDAK cukup (kalibrasi): jam meleset >5 menit pada 7
// cocok sah (SJB-2-0271 12 menit, nama sama), nama tak cocok pada 3 dari 543
// cocok REF (Rehmen Abdilleh vs RAHMAN ABDILLAH) yang jamnya tepat.
//
//   npx tsx scripts/uji-pass4-bertentangan.mts
import { runMatching, resiBertentangan } from "../lib/matching.ts";
import { tandaiTolakLintasHari } from "../lib/laporan/tolakLintasHari.ts";
import { susunLapis2, type IsiLapis2 } from "../lib/laporan/lapis2.ts";
import type { PdfTransaction, UserInput } from "../lib/types.ts";

const ATURAN = { lookback_days: 3, forward_window_days: 1, match_mode: "exact" as const, tolerance_rp: 0, tolerance_pct: 0 };

let no = 0;
const tx = (iso: string, jam: string, kredit: number, nama: string, o: Partial<PdfTransaction> = {}): PdfTransaction => ({
  no: ++no, tanggal: iso.split("-").reverse().join("-"),
  tanggalDate: new Date(`${iso}T12:00:00Z`), waktu: jam,
  namaPengirim: nama, deskripsi: "", kredit,
  bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
  page: 1, noRef: `FTX${no}`, bankId: "bank-1", parsedTxId: `tx-${no}`,
  claimedByOther: false, ...o,
} as any);
const inp = (id: string, iso: string, nominal: number, o: Partial<UserInput> = {}): UserInput => ({
  id, tanggal: new Date(`${iso}T12:00:00Z`), nominal, jenis: "kredit",
  outletId: "o", bankId: "bank-1", matchRuleId: "r", refFt: null, jamResi: null, namaPengirimResi: null,
  ...o,
} as any);

let gagal = 0;
const harap = (label: string, ok: boolean, rinci = "") => {
  if (!ok) gagal++;
  console.log(`${ok ? "✅" : "❌"} ${label}${rinci ? "  — " + rinci : ""}`);
};
const jalan = (inputs: UserInput[], txs: PdfTransaction[]) =>
  runMatching(inputs, txs, new Map(), { getRulesForInput: () => ATURAN, nama: { terpegangLuar: [] } });
const hasil = (out: UserInput[], id: string) => out.find((x) => x.id === id)!.match as any;
const tglOf = (m: any) => m?.txDate?.toISOString?.().slice(0, 10);
const ringkas = (m: any) =>
  `${m?.status} ${m?.matchedBy ?? ""} ${tglOf(m) ?? ""} bebas=${m?.barisBebas ?? "-"} bertentangan=${m?.bertentangan ?? "-"} tgl=${(m?.conflictDates ?? []).join(",")}`.trim();
const r = (id: string, jamResi: string | null, namaPengirimResi: string | null) => ({ id, jamResi, namaPengirimResi } as any);
const b = (waktu: string, namaPengirim: string) => ({ waktu, namaPengirim } as any);

// ── 0. Predikat murni — pasangan HIDUP dari kalibrasi ──
console.log("── 0. resiBertentangan (pasangan dari data hidup) ──");
harap("SJB-2-0056: Andini Sahputri 12:03 vs MUHAMMAD SIDDIQ 12.15 → bertentangan",
      resiBertentangan(r("TFK-2-20260811-7OMK60", "12:03", "Andini Sahputri"), b("12.15", "MUHAMMAD SIDDIQ")));
harap("SJB-2-0271: jam meleset 12 mnt, nama sama (HARI UTOMO) → TIDAK",
      !resiBertentangan(r("TFK-2-20260915-CRM1A0", "15:36", "HARI UTOMO"), b("15.48", "HARI UTOMO")));
harap("SBR-1-0407: jam meleset 8 jam, nama sama (RAMLAN SIDIK) → TIDAK",
      !resiBertentangan(r("TFK-1-20260903-8A66N0", "16:41", "RAMLAN SIDIK"), b("08.34", "RAMLAN SIDIK")));
harap("SBR-2-0067 (REF): nama salah baca 'Rehmen Abdilleh', jam tepat → TIDAK",
      !resiBertentangan(r("x", "18:48", "Rehmen Abdilleh"), b("18.48", "RAHMAN ABDILLAH")));
harap("SJB-1-0144 (REF): 'Ari Kandang' vs DARKASYI, jam 1 mnt → TIDAK",
      !resiBertentangan(r("x", "20:25", "Ari Kandang"), b("20.26", "DARKASYI")));
harap("SJB-1-0324: jam 6 mnt, nama sama persis → TIDAK",
      !resiBertentangan(r("x", "11:00", "Muhammad Fathir Al Mumtaz"), b("11.06", "MUHAMMAD FATHIR AL MUMTAZ")));
harap("SJB-10-1704 (NOMINAL sah): resi 'POLTEK LHOKSEUMAWE' vs YOGI PRAYOGA, jam tepat → TIDAK",
      !resiBertentangan(r("TFK-10-20260804-USGHG0", "10:39", "POLTEK LHOKSEUMAWE"), b("10.39", "YOGI PRAYOGA")));
harap("SJB-2-0070 (NOMINAL sah): resi 'SPBU PT. KANA TAMIT' vs AMALIA PUTRI, jam tepat → TIDAK",
      !resiBertentangan(r("TFK-2-20260823-4VZMI0", "21:22", "SPBU PT. KANA TAMIT"), b("21.22", "AMALIA PUTRI")));
harap("nama baris nama dompet (DOMPET ANAK BANGSA) → TIDAK",
      !resiBertentangan(r("x", "09:00", "Budi Santoso"), b("17.00", "DOMPET ANAK BANGSA")));
harap("nama baris kosong (parser BCA/BNI/Mandiri) → TIDAK",
      !resiBertentangan(r("x", "09:00", "Budi Santoso"), b("17.00", "")));
harap("nama resi tersamar '0813****4248' → TIDAK",
      !resiBertentangan(r("x", "09:00", "0813****4248"), b("17.00", "MUHAMMAD NOVALDI")));
harap("nama resi satu kata 'Hervina' → TIDAK",
      !resiBertentangan(r("x", "00:42", "Hervina"), b("05.00", "FURQAN")));
harap("nama resi 'GoPay Saldo' → TIDAK",
      !resiBertentangan(r("x", "00:17", "GoPay Saldo"), b("09.00", "BUDI SANTOSO")));
harap("jam resi tak terbaca → TIDAK",
      !resiBertentangan(r("x", null, "Budi Santoso"), b("17.00", "ANDI WIJAYA")));
harap("jam baris tak terbaca → TIDAK",
      !resiBertentangan(r("x", "09:00", "Budi Santoso"), b("", "ANDI WIJAYA")));
harap("tepat 5 menit → TIDAK (toleransi sama dengan PASS 2/3)",
      !resiBertentangan(r("x", "09:00", "Budi Santoso"), b("09.05", "ANDI WIJAYA")));
harap("6 menit + nama lain → bertentangan",
      resiBertentangan(r("x", "09:00", "Budi Santoso"), b("09.06", "ANDI WIJAYA")));
harap("lewat tengah malam 23:58 vs 00.02 (4 mnt) → TIDAK",
      !resiBertentangan(r("x", "23:58", "Budi Santoso"), b("00.02", "ANDI WIJAYA")));
harap("nama baris bertempelan bank ('SUCI ULFA Bank Seabank') cocok → TIDAK",
      !resiBertentangan(r("x", "09:00", "Suci Ulfa"), b("17.00", "SUCI ULFA Bank Seabank")));
harap("DEBET (TFKD-): nama baris PT ACEH GADAI SYARIAH → TIDAK pernah",
      !resiBertentangan(r("TFKD-654", "21:06", "M ALIF ARDIANSYAH"), b("23.00", "PT ACEH GADAI SYARIAH")));
let lempar = false;
try { resiBertentangan(null as any, null as any); resiBertentangan({} as any, { waktu: 5, namaPengirim: {} } as any); }
catch { lempar = true; }
harap("masukan rusak tidak melempar", !lempar);

// ── 1. Replay SJB-2-0056: satu-satunya baris hari itu dibantah → DITAHAN ──
console.log("\n── 1. SJB-2-0056: baris tunggal dibantah jam & nama ──");
{
  no = 0;
  const { inputs: out, summary } = jalan(
    [inp("TFK-2-20260811-7OMK60", "2026-08-11", 2_530_000,
         { jamResi: "12:03", namaPengirimResi: "Andini Sahputri", refFt: "FT26223FW5JK", noFaktur: "SJB-2-0056" } as any)],
    [tx("2026-08-11", "12.15", 2_530_000, "MUHAMMAD SIDDIQ", { noRef: "FT262233KZP0\\Q51/213" } as any)]);
  const m = hasil(out, "TFK-2-20260811-7OMK60");
  harap("tidak dicocokkan (dulu: matched NOMINAL)", m?.status === "all_taken", ringkas(m));
  harap("barisBebas + bertentangan", m?.barisBebas === true && m?.bertentangan === true, ringkas(m));
  harap("tanggal baris disebut (11-08-2026)", (m?.conflictDates ?? []).join() === "11-08-2026", ringkas(m));
  harap("tanpa refIssue (tidak jadi alarm UNMATCHED ke gadai)", !m?.refIssue);
  harap("baris Siddiq tetap BEBAS (masuk unclaimed)", summary.unclaimed.length === 1);
}

// ── 2. Dialihkan: baris hari sama yang dibantah dilewati, yang tidak dibantah dipilih ──
console.log("\n── 2. dua baris hari sama: yang dibantah dilewati ──");
{
  no = 0;
  const out = jalan(
    [inp("A", "2026-09-10", 150_000, { jamResi: "09:00", namaPengirimResi: "Budi Santoso" })],
    [tx("2026-09-10", "15.00", 150_000, "ANDI WIJAYA"),        // no 1: dulu dipilih (urutan baris)
     tx("2026-09-10", "16.00", 150_000, "DOMPET ANAK BANGSA")]).inputs; // no 2: tak bisa dibantah
  const m = hasil(out, "A");
  harap("cocok NOMINAL ke baris no 2 (bukan ANDI WIJAYA)", m?.status === "matched" && m?.txNo === 2, `${ringkas(m)} txNo=${m?.txNo}`);
  harap("ambiguous tidak menghitung baris yang dibantah", !m?.ambiguous, `ambiguous=${m?.ambiguous}`);
}

// ── 3. Campuran: hari sama dibantah, sisa calon LINTAS HARI → tetap tidak ditebak ──
console.log("\n── 3. hari sama dibantah, calon tersisa beda hari ──");
{
  no = 0;
  const out = jalan(
    [inp("C", "2026-09-10", 175_000, { jamResi: "09:00", namaPengirimResi: "Budi Santoso" })],
    [tx("2026-09-10", "15.00", 175_000, "ANDI WIJAYA"),
     tx("2026-09-09", "20.00", 175_000, "")]).inputs;
  const m = hasil(out, "C");
  harap("all_taken barisBebas (pagar lintas hari, dihitung dengan baris yang dibantah)",
        m?.status === "all_taken" && m?.barisBebas === true, ringkas(m));
  harap("BUKAN bertentangan (masih ada calon yang tidak dibantah)", !m?.bertentangan, ringkas(m));
  harap("yang disebut bebas hanya calon beda hari (09-09-2026)", (m?.conflictDates ?? []).join() === "09-09-2026", ringkas(m));
}

// ── 4. Satu bantahan saja: perilaku lama ──
console.log("\n── 4. hanya jam ATAU hanya nama yang membantah: tetap cocok ──");
{
  no = 0;
  const out = jalan(
    [inp("J", "2026-09-15", 2_100_000, { jamResi: "15:36", namaPengirimResi: "HARI UTOMO" }),
     inp("N", "2026-09-15", 205_000, { jamResi: "10:00", namaPengirimResi: "Budi Santoso" })],
    [tx("2026-09-15", "15.48", 2_100_000, "HARI UTOMO"),
     tx("2026-09-15", "", 205_000, "ANDI WIJAYA")]).inputs;
  harap("jam meleset 12 mnt, nama sama → cocok NOMINAL", hasil(out, "J")?.status === "matched", ringkas(hasil(out, "J")));
  harap("nama lain, jam baris kosong → cocok NOMINAL", hasil(out, "N")?.status === "matched", ringkas(hasil(out, "N")));
}

// ── 5. SJB-1-0186 / SBR-4-0182 ──
console.log("\n── 5. SJB-1-0186: klaim kembar Rp 460.000 ──");
{
  no = 0;
  // Replay apa adanya: resi kembar TANPA nama, baris 10 Agu dipegang klaim
  // pertama, baris 11 Agu 17.39 FAZDRIA (milik SBR-4-0182) bebas.
  const out = jalan(
    [inp("TFK-1-20260810-SWH7N1", "2026-08-10", 460_000, { jamResi: "16:02", noFaktur: "SJB-1-0186" } as any)],
    [tx("2026-08-10", "16.02", 460_000, "SAID FATURRAHMAN", { claimedByOther: true } as any),
     tx("2026-08-11", "17.39", 460_000, "FAZDRIA")]).inputs;
  const m = hasil(out, "TFK-1-20260810-SWH7N1");
  harap("tetap ditahan pagar (c) — hariSendiriDipegang", m?.status === "all_taken" && m?.hariSendiriDipegang === true, ringkas(m));
  harap("pagar (d) DIAM (resi tanpa nama)", !m?.bertentangan, ringkas(m));
}
{
  no = 0;
  // Andai resinya bernama (pengirim baris 10 Agu) dan baris 10 Agu TIDAK ada
  // di kolam (berkas lain): dulu PASS 4 mengambil FAZDRIA sebagai satu-
  // satunya kandidat lintas hari. Pagar (d) sendirian menahannya.
  const out = jalan(
    [inp("K", "2026-08-10", 460_000, { jamResi: "16:02", namaPengirimResi: "Said Faturrahman" })],
    [tx("2026-08-11", "17.39", 460_000, "FAZDRIA")]).inputs;
  const m = hasil(out, "K");
  harap("varian bernama: TIDAK mengambil uang SBR-4-0182", m?.status === "all_taken" && m?.bertentangan === true, ringkas(m));
  no = 0;
  const out2 = jalan(
    [inp("K2", "2026-08-10", 460_000, { jamResi: "16:02", namaPengirimResi: "Said Faturrahman" })],
    [tx("2026-08-10", "16.02", 460_000, "SAID FATURRAHMAN", { claimedByOther: true } as any),
     tx("2026-08-11", "17.39", 460_000, "FAZDRIA")]).inputs;
  const m2 = hasil(out2, "K2");
  harap("varian bernama + hari sendiri dipegang: bertentangan DAN hariSendiriDipegang",
        m2?.bertentangan === true && m2?.hariSendiriDipegang === true, ringkas(m2));
}

// ── 6. DEBET tidak tersentuh ──
console.log("\n── 6. klaim DEBET (TFKD-) ──");
{
  no = 0;
  const out = jalan(
    [inp("TFKD-654", "2026-08-20", 2_000_000, { jamResi: "21:06", namaPengirimResi: "M ALIF ARDIANSYAH" })],
    [tx("2026-08-20", "23.00", 2_000_000, "PT ACEH GADAI SYARIAH")]).inputs;
  harap("debet tetap cocok NOMINAL", hasil(out, "TFKD-654")?.status === "matched", ringkas(hasil(out, "TFKD-654")));
}

// ── 7. "Bebas" basi: baris yang dibantah diambil klaim lain belakangan ──
console.log("\n── 7. penanda dicabut kalau barisnya akhirnya diambil klaim lain ──");
{
  no = 0;
  const out = jalan(
    [inp("A", "2026-09-26", 90_000, { jamResi: "10:00", namaPengirimResi: "Budi Santoso" }),
     inp("B", "2026-09-27", 90_000)],
    [tx("2026-09-26", "15.00", 90_000, "ANDI WIJAYA")]).inputs;
  const a = hasil(out, "A"); const bb = hasil(out, "B");
  harap("B (sendirian, tanpa jam/nama) mengambil baris 26", bb?.status === "matched" && tglOf(bb) === "2026-09-26", ringkas(bb));
  harap("A tidak lagi 'bebas' dan tidak lagi 'bertentangan' → BEREBUT biasa",
        a?.status === "all_taken" && !a?.barisBebas && !a?.bertentangan, ringkas(a));
}
{
  no = 0;
  // Campuran (bagian 3), lalu calon lintas harinya diambil klaim lain: yang
  // tersisa bebas hanya baris yang DIBANTAH → penolakan menjadi bertentangan.
  const out = jalan(
    [inp("A", "2026-09-10", 175_000, { jamResi: "09:00", namaPengirimResi: "Budi Santoso" }),
     inp("B", "2026-09-08", 175_000)],
    [tx("2026-09-10", "15.00", 175_000, "ANDI WIJAYA"),
     tx("2026-09-09", "20.00", 175_000, "")]).inputs;
  const a = hasil(out, "A"); const bb = hasil(out, "B");
  harap("B mengambil calon beda hari milik A (09-09)", bb?.status === "matched" && tglOf(bb) === "2026-09-09", ringkas(bb));
  harap("A kini bertentangan, menyebut baris 10-09 yang dibantah",
        a?.barisBebas === true && a?.bertentangan === true && (a?.conflictDates ?? []).join() === "10-09-2026", ringkas(a));
}

// ── 8. /belum-cocok: ref_issue BERTENTANGAN tidak dilabeli "beda hari" ──
console.log("\n── 8. /belum-cocok (tolakLintasHari) ──");
{
  const baris: Record<string, any> = {
    "K-1": { gadai_klaim_id: "K-1", match_status: "all_taken", ref_issue: "BERTENTANGAN", conflict_dates: ["11-08-2026"] },
    "K-2": { gadai_klaim_id: "K-2", match_status: "all_taken", ref_issue: "BERTENTANGAN_HARI_SENDIRI_DIPEGANG", conflict_dates: ["11-08-2026"] },
    "K-3": { gadai_klaim_id: "K-3", match_status: "all_taken", ref_issue: "BEDA_HARI_BEBAS", conflict_dates: ["25-09-2026"] },
  };
  const db = {
    from: () => {
      let ids: string[] = [];
      const q: any = {
        select: () => q, eq: () => q, is: () => q,
        in: (_k: string, v: string[]) => { ids = v; return q; },
        order: async () => ({ data: ids.map((i) => baris[i]).filter(Boolean), error: null }),
      };
      return q;
    },
  };
  const items: any[] = [
    { klaim_id: "K-1", status: "PENDING", tgl: "2026-08-11", sebab: "belum pernah divonis" },
    { klaim_id: "K-2", status: "PENDING", tgl: "2026-08-10", sebab: "belum pernah divonis" },
    { klaim_id: "K-3", status: "PENDING", tgl: "2026-09-26", sebab: "belum pernah divonis" },
  ];
  await tandaiTolakLintasHari(db, "akun", items);
  harap("BERTENTANGAN: tolakLintasHari TIDAK dinyalakan", !items[0].tolakLintasHari, JSON.stringify(items[0]));
  harap("BERTENTANGAN: penanda bertentangan", items[0].bertentangan === true);
  harap("BERTENTANGAN: sebab menyebut jam DAN nama, tanpa 'beda hari'",
        /jam DAN nama/.test(items[0].sebab) && !/beda hari/i.test(items[0].sebab), items[0].sebab);
  harap("BERTENTANGAN_HARI_SENDIRI_DIPEGANG: menyebut resi kembar", /kembar/.test(items[1].sebab), items[1].sebab);
  harap("BEDA_HARI_BEBAS lama tetap seperti dulu", items[2].tolakLintasHari === true && items[2].barisBebasTgl === "2026-09-25", JSON.stringify(items[2]));
}

// ── 9. Laporan Lapis 2: kalimatnya ──
console.log("\n── 9. laporan Lapis 2 ──");
{
  const nol = { n: 0, rp: 0 };
  const isi: IsiLapis2 = {
    bankLabel: "BSI", namaFile: "mutasi.pdf",
    berkasDari: "2026-08-11", berkasSampai: "2026-08-11", nilaiDari: "2026-08-11", nilaiSampai: "2026-08-11",
    utuh: true, rantaiPutus: 0, nyambung: true, selisihSambungan: 0,
    perTanggal: [], nDiuji: 4, rpDiuji: 0, nCocok: 1,
    tidakKetemu: [], ditahanLuarPeriode: 0, ditahanKonflik: 3,
    kreditNganggur: [], rpKreditNganggur: 0, debetNganggur: [], rpDebetNganggur: 0, nganggurDiperiksa: true,
    sandingan: {
      total: { lahir: nol, tertahan: nol, dilepas: nol, divonis: nol, menggantung: nol },
      tanggal: [{ tgl: "2026-08-11", arah: "KREDIT", lahir: { n: 4, rp: 2_870_000 }, dilepas: { n: 4, rp: 2_870_000 },
                  divonis: { n: 1, rp: 100_000 }, menggantung: { n: 3, rp: 2_770_000 }, tertahan: nol,
                  rinci: { MATCHED: { n: 1, rp: 100_000 } } }],
      ketinggalan: [
        { klaim_id: "TFK-2-20260811-7OMK60", no_faktur: "SJB-2-0056", outlet: "LANGSA", arah: "KREDIT", tgl: "2026-08-11", nominal: 2_530_000 },
        { klaim_id: "T2", no_faktur: "SJB-3-0211", outlet: "BIREUEN", arah: "KREDIT", tgl: "2026-08-11", nominal: 50_000 },
        { klaim_id: "T3", no_faktur: "SBR-1-0001", outlet: "LHOKSEUMAWE", arah: "KREDIT", tgl: "2026-08-11", nominal: 190_000 },
      ],
    } as any,
    alasanKlaim: [
      { id: "TFK-2-20260811-7OMK60", no_faktur: "SJB-2-0056", outlet: "LANGSA", tgl: "2026-08-11", nominal: 2_530_000,
        sebab: "TOLAK_LINTAS_HARI", bertentangan: true },
      { id: "T2", no_faktur: "SJB-3-0211", outlet: "BIREUEN", tgl: "2026-08-11", nominal: 50_000, sebab: "TOLAK_LINTAS_HARI" },
      { id: "T3", no_faktur: "SBR-1-0001", outlet: "LHOKSEUMAWE", tgl: "2026-08-11", nominal: 190_000, sebab: "BEREBUT" },
    ],
    tunggakan: [], gagal: [],
  };
  const teks = susunLapis2(isi, { nomor: null, sebelumNomor: null, sebelumKapan: null });
  const baris = (s: string) => teks.split("\n").find((l) => l.includes(s)) ?? "";
  harap("peringatan: 1 resi bertentangan", /1 resi tidak ditebak mesin: baris bernominal sama ada, tapi jam DAN nama di resi bertentangan/.test(teks));
  harap("peringatan: 1 tolak lintas hari (tidak menghitung yang bertentangan)", /1 resi tidak ditebak mesin: baris bernominal sama ADA dan MASIH BEBAS di hari lain/.test(teks));
  harap("peringatan: 1 berebut (3 − 1 − 1)", /1 resi belum bisa dinilai \(berebut/.test(teks));
  harap("SJB-2-0056 disebut dengan kalimat bertentangan", /jam DAN nama di resi bertentangan — mesin tidak menebak; periksa di \/belum-cocok/.test(baris("SJB-2-0056")), baris("SJB-2-0056").trim());
  harap("SJB-3-0211 tetap kalimat beda hari", /beda hari/.test(baris("SJB-3-0211")), baris("SJB-3-0211").trim());
}

console.log(gagal ? `\n❌ ${gagal} harapan meleset` : "\n✅ SEMUA SESUAI");
process.exit(gagal ? 1 : 0);
