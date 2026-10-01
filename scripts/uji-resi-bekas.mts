// Uji pagar RESI BEKAS di pencocokan Lapis 2 (1 Oktober 2026).
//
// Asal: uji "resi bekas" — satu resi lama di-upload ulang untuk transaksi baru.
// Tiga celah di sisi Lapis 2 yang ditutup di lib/matching.ts:
//   (f) pengusiran PASS 1: klaim ber-REF mengusir pemegang lemah TANPA syarat,
//       padahal pengusirnya bisa resi bekas (baris jauh lebih tua daripada
//       transaksinya) atau pemegangnya justru pemilik sah (tanggal & jam
//       resinya sendiri cocok dengan baris). Disimulasikan ke data hidup:
//       SJB-1-0250 memegang baris 18 Agu 20.48 ANUAR MUDDIN Rp 300.000
//       (FT262309MB08) lewat NOMINAL, jam resinya 20:48.
//   (h) alarm REF_SUDAH_DIKLAIM tidak menyebut SIAPA pemegang barisnya.
//   (c) aturan tanggal MUTASI_LAMA (dipakai jalankanPass): baris mutasi lebih
//       dari 3 hari lebih tua daripada TRANSAKSI. SJB-10-1386 (1 Sep) cocok
//       lewat REF ke baris 29 Juni tanpa peringatan.
// Dan yang WAJIB tetap jalan: pengusiran pemegang lemah yang memang salah
// tebak (SJB-2-0036 / SBR-11-2096, 5 Sep 2026), serta "1 resi untuk 2 kontrak"
// yang sah (SJB-11-0742 FT26273XHRC9 Rp 190.000, 30 Sep).
//
//   npx tsx scripts/uji-resi-bekas.mts
import { runMatching, uangLamaHari, pemegangCocokJam, BATAS_UANG_LAMA_HARI } from "../lib/matching.ts";
import type { PdfTransaction, UserInput } from "../lib/types.ts";

const ATURAN = { lookback_days: 3, forward_window_days: 1, match_mode: "exact" as const, tolerance_rp: 0, tolerance_pct: 0 };
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

let no = 0;
const tx = (iso: string, jam: string, kredit: number, nama: string, o: Partial<PdfTransaction> = {}): PdfTransaction => ({
  no: ++no, tanggal: iso.split("-").reverse().join("-"),
  tanggalDate: d(iso), waktu: jam,
  namaPengirim: nama, deskripsi: "", kredit,
  bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
  page: 1, noRef: `FTX${no}`, bankId: "bank-1", parsedTxId: `tx-${no}`,
  claimedByOther: false, ...o,
} as any);
const inp = (id: string, iso: string, nominal: number, o: Partial<UserInput> = {}): UserInput => ({
  id, tanggal: d(iso), nominal, jenis: "kredit",
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
const ringkas = (m: any) => `${m?.status} ${m?.matchedBy ?? ""} ${m?.refIssue ?? ""}`.trim();

// ── 0. Aturan tanggal & jam (murni) ──
console.log("── 0. aturan tanggal MUTASI_LAMA & jam pemegang ──");
harap(`batas = ${BATAS_UANG_LAMA_HARI} hari`, BATAS_UANG_LAMA_HARI === 3);
harap("SJB-10-1386: transaksi 1 Sep, baris 29 Jun → 64 hari", uangLamaHari(d("2026-09-01"), d("2026-06-29")) === 64);
harap("tepat 3 hari → bukan uang lama", uangLamaHari(d("2026-09-03"), d("2026-08-31")) === null);
harap("4 hari → uang lama (4)", uangLamaHari(d("2026-09-04"), d("2026-08-31")) === 4);
harap("baris SESUDAH transaksi → bukan uang lama", uangLamaHari(d("2026-09-01"), d("2026-09-02")) === null);
harap("hari sama (SJB-11-0742 30 Sep) → bukan uang lama", uangLamaHari(d("2026-09-30"), d("2026-09-30")) === null);
harap("tanggal transaksi tak diketahui → null (diam)", uangLamaHari(undefined, d("2026-06-29")) === null);
harap("tanggal rusak → null, tidak melempar", uangLamaHari(new Date("x"), d("2026-06-29")) === null);
harap("jam sama, hari sama → pemilik sah", pemegangCocokJam({ tanggal: d("2026-08-18"), jamResi: "20:48" }, { tanggalDate: d("2026-08-18"), waktu: "20.48" }));
harap("jam ±5 menit → pemilik sah", pemegangCocokJam({ tanggal: d("2026-08-18"), jamResi: "20:43" }, { tanggalDate: d("2026-08-18"), waktu: "20.48" }));
harap("jam 6 menit → bukan", !pemegangCocokJam({ tanggal: d("2026-08-18"), jamResi: "20:54" }, { tanggalDate: d("2026-08-18"), waktu: "20.48" }));
harap("hari beda → bukan", !pemegangCocokJam({ tanggal: d("2026-08-17"), jamResi: "20:48" }, { tanggalDate: d("2026-08-18"), waktu: "20.48" }));
harap("jam resi kosong → bukan", !pemegangCocokJam({ tanggal: d("2026-08-18"), jamResi: null }, { tanggalDate: d("2026-08-18"), waktu: "20.48" }));

// Baris ANUAR MUDDIN 18 Agu, dipegang SJB-1-0250 lewat NOMINAL (data hidup).
const barisAnuar = (o: Partial<PdfTransaction> = {}) => tx("2026-08-18", "20.48", 300_000, "ANUAR MUDDIN", {
  noRef: "FT262309MB08\\P17/213", claimedByOther: true,
  pemegang: { inputId: "25da4473", matchedBy: "NOMINAL", manual: false,
              gadaiKlaimId: "TFK-1-20260818-PXMAW0", noFaktur: "SJB-1-0250" },
  ...o,
} as any);
const pemegang0250 = (jamResi: string | null) => inp("TFK-1-20260818-PXMAW0", "2026-08-18", 300_000, {
  jamResi, sudahMemegang: true, noFaktur: "SJB-1-0250", tanggalTransaksi: d("2026-08-18"),
} as any);

// ── 1. (f) pagar 6: pengusir tampak resi bekas ──
console.log("\n── 1. resi 18 Agu dipakai ulang untuk transaksi 30 Sep (pemegang tanpa jam) ──");
for (const [label, tglResi] of [["tanggal resi terbaca 18 Agu", "2026-08-18"], ["tanggal resi tak terbaca → 30 Sep", "2026-09-30"]] as const) {
  no = 0;
  const { inputs: out, summary } = jalan(
    [inp("BARU", tglResi, 300_000, { refFt: "FT262309MB08", jamResi: "20:48", namaPengirimResi: "ANUAR MUDDIN",
                                       noFaktur: "SBR-X-BEKAS", tanggalTransaksi: d("2026-09-30") } as any),
     pemegang0250(null)],
    [barisAnuar()]);
  const m = hasil(out, "BARU");
  const p = m?.dipegang?.[0];
  harap(`${label}: TIDAK mengusir`, (summary.disepak ?? []).length === 0, JSON.stringify(summary.disepak));
  harap(`${label}: jatuh ke REF_SUDAH_DIKLAIM`, m?.status === "all_taken" && m.refIssue === "REF_SUDAH_DIKLAIM", ringkas(m));
  harap(`${label}: pemegang disebut SJB-1-0250`,
        p?.noFaktur === "SJB-1-0250" && p?.gadaiKlaimId === "TFK-1-20260818-PXMAW0" && p?.tanggal === "2026-08-18" && p?.kredit === 300_000,
        JSON.stringify(p));
}

// ── 2. (f) pagar 7: pemegang tampak pemilik sah (tanggal + jam resinya sendiri) ──
console.log("\n── 2. pengusir TIDAK tampak bekas, tapi pemegang punya jam resi 20:48 = baris 20.48 ──");
{
  no = 0;
  const { inputs: out, summary } = jalan(
    [inp("BARU", "2026-08-18", 300_000, { refFt: "FT262309MB08", noFaktur: "SBR-Y", tanggalTransaksi: d("2026-08-18") } as any),
     pemegang0250("20:48")],
    [barisAnuar()]);
  const m = hasil(out, "BARU");
  harap("TIDAK mengusir", (summary.disepak ?? []).length === 0);
  harap("REF_SUDAH_DIKLAIM dengan pemegang SJB-1-0250",
        m?.status === "all_taken" && m.refIssue === "REF_SUDAH_DIKLAIM" && m.dipegang?.[0]?.noFaktur === "SJB-1-0250", ringkas(m));
}
{
  no = 0;
  const { inputs: out, summary } = jalan(
    [inp("BARU", "2026-08-18", 300_000, { refFt: "FT262309MB08", noFaktur: "SBR-Y", tanggalTransaksi: d("2026-08-18") } as any),
     pemegang0250("20:54")],
    [barisAnuar()]);
  const m = hasil(out, "BARU");
  harap("batas: jam pemegang 6 menit dari baris → pengusiran TETAP jalan",
        (summary.disepak ?? []).some((x) => x.pemegangKlaimId === "TFK-1-20260818-PXMAW0") && m?.matchedBy === "REF", ringkas(m));
}

// ── 3. Pengusiran yang SAH tetap jalan ──
console.log("\n── 3. pemegang lemah yang memang salah tebak (pola SJB-2-0036 / SBR-11-2096) ──");
const barisWahyudi = () => tx("2026-08-31", "15.09", 70_000, "WAHYUDI PRAKARSA", {
  noRef: "FT262438R70Q/213", claimedByOther: true,
  pemegang: { inputId: "inp-0036", matchedBy: "NOMINAL", manual: false, gadaiKlaimId: "TFK-2-0036", noFaktur: "SJB-2-0036" },
} as any);
const korban0036 = () => inp("TFK-2-0036", "2026-08-31", 70_000, { sudahMemegang: true, noFaktur: "SJB-2-0036",
                                                                   tanggalTransaksi: d("2026-08-31") } as any);
{
  no = 0;
  const lain = tx("2026-08-31", "09.12", 70_000, "ORANG LAIN");
  const { inputs: out, summary } = jalan(
    [inp("TFK-SBR-2096", "2026-08-31", 70_000, { refFt: "FT262438R70Q", noFaktur: "SBR-11-2096", tanggalTransaksi: d("2026-09-03") } as any),
     korban0036()],
    [barisWahyudi(), lain]);
  const m = hasil(out, "TFK-SBR-2096");
  const k = hasil(out, "TFK-2-0036");
  harap("transaksi 3 Sep (3 hari): klaim ber-REF mengambil barisnya", m?.status === "matched" && m.matchedBy === "REF", ringkas(m));
  harap("pengusiran tercatat", (summary.disepak ?? []).some((x) => x.pemegangKlaimId === "TFK-2-0036"));
  harap("yang terusir dicocokkan ulang ke baris lain", k?.status === "matched" && tglOf(k) === "2026-08-31", ringkas(k));
}
{
  no = 0;
  const { summary } = jalan(
    [inp("TFK-SBR-2096", "2026-08-31", 70_000, { refFt: "FT262438R70Q", noFaktur: "SBR-11-2096" }), korban0036()],
    [barisWahyudi()]);
  harap("tanpa tanggal transaksi (layar /check lama): pengusiran seperti dulu",
        (summary.disepak ?? []).some((x) => x.pemegangKlaimId === "TFK-2-0036"));
}
{
  // DATA ASLI: SBR-11-2096 resi 31 Agu, transaksi 4 Sep = 4 hari. Dengan
  // batas 3 hari pagar 6 MENAHANnya — perilaku sebelum 5 Sep (diparkir,
  // manusia memutuskan), kini dengan nama pemegangnya. Dicetak supaya
  // perubahan ini terlihat, bukan tersembunyi.
  no = 0;
  const { inputs: out, summary } = jalan(
    [inp("TFK-SBR-2096", "2026-08-31", 70_000, { refFt: "FT262438R70Q", noFaktur: "SBR-11-2096", tanggalTransaksi: d("2026-09-04") } as any),
     korban0036()],
    [barisWahyudi()]);
  const m = hasil(out, "TFK-SBR-2096");
  harap("ℹ️ tanggal asli (transaksi 4 Sep, 4 hari): TIDAK mengusir, alarm menyebut SJB-2-0036",
        (summary.disepak ?? []).length === 0 && m?.refIssue === "REF_SUDAH_DIKLAIM" && m.dipegang?.[0]?.noFaktur === "SJB-2-0036",
        ringkas(m));
}

// ── 4. Pemegang di jalan yang SAMA (dua resi, ref sama) ──
console.log("\n── 4. dua klaim membawa ref yang sama dalam satu sapuan ──");
{
  no = 0;
  const { inputs: out } = jalan(
    [inp("K1", "2026-09-20", 150_000, { refFt: "FT26263AAAA1", noFaktur: "SBR-1-0001", tanggalTransaksi: d("2026-09-20") } as any),
     inp("K2", "2026-09-20", 150_000, { refFt: "FT26263AAAA1", noFaktur: "SJB-2-0002", tanggalTransaksi: d("2026-09-27") } as any)],
    [tx("2026-09-20", "10.00", 150_000, "NASABAH", { noRef: "FT26263AAAA1/213" } as any)]);
  const m1 = hasil(out, "K1");
  const m2 = hasil(out, "K2");
  harap("K1 cocok REF", m1?.matchedBy === "REF");
  harap("K2 REF_SUDAH_DIKLAIM, pemegang = SBR-1-0001 (jalan ini)",
        m2?.refIssue === "REF_SUDAH_DIKLAIM" && m2.dipegang?.[0]?.noFaktur === "SBR-1-0001" &&
        m2.dipegang?.[0]?.diJalanIni === true && m2.dipegang?.[0]?.gadaiKlaimId === "K1",
        JSON.stringify(m2?.dipegang));
}

// ── 5. Pemegang MANUAL / ber-REF: tidak disentuh, tetap disebut ──
console.log("\n── 5. pemegang manual tidak disepak, dan namanya disebut ──");
{
  no = 0;
  const { inputs: out, summary } = jalan(
    [inp("BARU", "2026-09-10", 500_000, { refFt: "FT26253CB502", noFaktur: "SBR-Z", tanggalTransaksi: d("2026-09-10") } as any)],
    [tx("2026-09-10", "11.00", 500_000, "SESEORANG", {
      noRef: "FT26253CB502\\Q15/213", claimedByOther: true,
      pemegang: { inputId: "inp-x", matchedBy: "REF", manual: true, gadaiKlaimId: "TFK-1-20260918-FJ22M1", noFaktur: "SBR-1-0431" },
    } as any)]);
  const m = hasil(out, "BARU");
  harap("tidak ada pengusiran", (summary.disepak ?? []).length === 0);
  harap("REF_SUDAH_DIKLAIM menyebut SBR-1-0431", m?.refIssue === "REF_SUDAH_DIKLAIM" && m.dipegang?.[0]?.noFaktur === "SBR-1-0431",
        JSON.stringify(m?.dipegang));
}
{
  no = 0;
  // Pemegang dari DB yang identitasnya tak terbaca: kalimat jatuh ke "klaim lain".
  const { inputs: out } = jalan(
    [inp("BARU", "2026-09-10", 500_000, { refFt: "FT26253CB502", tanggalTransaksi: d("2026-09-10") } as any)],
    [tx("2026-09-10", "11.00", 500_000, "SESEORANG", { noRef: "FT26253CB502\\Q15/213", claimedByOther: true } as any)]);
  const m = hasil(out, "BARU");
  harap("pemegang tak dikenal → noFaktur null (bukan nama karangan)",
        m?.refIssue === "REF_SUDAH_DIKLAIM" && m.dipegang?.length === 1 && m.dipegang[0].noFaktur === null, JSON.stringify(m?.dipegang));
}

// ── 6. Yang sah tetap sah ──
console.log("\n── 6. kasus sah: 1 resi untuk 2 kontrak (SJB-11-0742) & bayar di muka ──");
{
  no = 0;
  const { inputs: out } = jalan(
    [inp("TFK-4-20260930-QLH4G0", "2026-09-30", 190_000, { refFt: "FT26273XHRC9", jamResi: "14:35", namaPengirimResi: "Nur Afni",
                                                           noFaktur: "SJB-11-0742", tanggalTransaksi: d("2026-09-30") } as any)],
    [tx("2026-09-30", "14.35", 190_000, "NUR AFNI", { noRef: "FT26273XHRC9\\P05/213" } as any)]);
  const m = hasil(out, "TFK-4-20260930-QLH4G0");
  harap("SJB-11-0742 cocok REF", m?.status === "matched" && m.matchedBy === "REF" && !m.refIssue, ringkas(m));
  harap("SJB-11-0742 bukan uang lama", uangLamaHari(d("2026-09-30"), m?.txDate) === null);
}
{
  no = 0;
  // SJB-10-1386 replay: resi 29 Jun, transaksi 1 Sep, baris 29 Jun bebas.
  // Cocoknya TIDAK berubah — peringatannya urusan jalankanPass (MUTASI_LAMA).
  const { inputs: out } = jalan(
    [inp("TFK-1-20260901-QI33S0", "2026-06-29", 80_000, { refFt: "FT261805QY44", noFaktur: "SJB-10-1386",
                                                          tanggalTransaksi: d("2026-09-01") } as any)],
    [tx("2026-06-29", "10.00", 80_000, "JUNAIDI", { noRef: "FT261805QY44\\P25/213" } as any)]);
  const m = hasil(out, "TFK-1-20260901-QI33S0");
  harap("SJB-10-1386 tetap cocok REF (vonis tidak diubah)", m?.status === "matched" && m.matchedBy === "REF", ringkas(m));
  harap("…dan aturan MUTASI_LAMA menyala: 64 hari", uangLamaHari(d("2026-09-01"), m?.txDate) === 64);
}

console.log(gagal ? `\n❌ ${gagal} harapan meleset` : "\n✅ SEMUA SESUAI");
process.exit(gagal ? 1 : 0);
