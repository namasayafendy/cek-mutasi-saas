// Uji Lapis 2 untuk SETOR KE PUSAT (5 Oktober 2026, KEPUTUSAN OWNER #14/#15).
//
// Slip setoran kas tunai outlet ke rekening PT (STP-…). Di mutasi BSI setoran
// teller berbunyi "SETR"/"Setoran"/"SETOR TUNAI", nama pengirim KOSONG, ref
// berekor "/52"; agen berbunyi "LKP100042CASH-…". Nominalnya bulat & besar —
// jenis angka yang paling sering kembar. Yang diuji:
//   1. matcher (data tiruan): REF / NOMINAL+JAM calon tunggal / NOMINAL saja
//      hanya bila kredit tepat satu tanpa pesaing; selain itu DITAHAN;
//      setoran tetap dihitung di `rebutan`; tidak ada pengusiran lintas
//      setoran; tidak ada satu baris dipegang dua klaim;
//   2. pembanding acak: untuk klaim TANPA setoran, hasil matcher baru SAMA
//      PERSIS dengan matcher sebelum S7 (git show <dasar>:lib/matching.ts);
//   3. laporan Lapis 2: blok setoran, "belum ketemu" bukan "tidak ada di
//      rekening", penjumlahan tetap tutup; laporan tanpa setoran SAMA PERSIS
//      dengan versi lama;
//   4. tolakLintasHari: sebab /belum-cocok untuk setoran yang ditahan;
//   5. --hidup: sampel kredit NYATA (baca-saja) — setoran teller, agen LKP,
//      kredit bulat ≥ 5 jt bernominal kembar.
//
//   npx tsx scripts/uji-setor-pusat-lapis2.mts [--hidup] [--dasar=<commit>]
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { runMatching, adalahSetoran } from "../lib/matching.ts";
import { susunLapis2, SEBAB_SETORAN_BELUM_KETEMU, type IsiLapis2 } from "../lib/laporan/lapis2.ts";
import { tandaiTolakLintasHari } from "../lib/laporan/tolakLintasHari.ts";
import type { PdfTransaction, UserInput } from "../lib/types.ts";

const ATURAN = { lookback_days: 3, forward_window_days: 1, match_mode: "exact" as const, tolerance_rp: 0, tolerance_pct: 0 };
const DASAR = (process.argv.find((a) => a.startsWith("--dasar="))?.slice(8)) || "dbf3853";

let no = 0;
const tx = (iso: string, jam: string, kredit: number, nama: string, o: Partial<PdfTransaction> = {}): PdfTransaction => ({
  no: ++no, tanggal: iso.split("-").reverse().join("-"),
  tanggalDate: new Date(`${iso}T12:00:00Z`), waktu: jam,
  namaPengirim: nama, deskripsi: "", kredit,
  bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
  page: 1, noRef: `FTX${String(no).padStart(8, "0")}`, bankId: "bank-1", parsedTxId: `tx-${no}`,
  claimedByOther: false, ...o,
} as any);
const inp = (id: string, iso: string, nominal: number, o: Partial<UserInput> = {}): UserInput => ({
  id, tanggal: new Date(`${iso}T12:00:00Z`), nominal,
  outletId: "o", bankId: "bank-1", matchRuleId: "r", refFt: null, jamResi: null, namaPengirimResi: null,
  ...o,
} as any);
const stp = (id: string, iso: string, nominal: number, o: Partial<UserInput> = {}) =>
  inp(id, iso, nominal, { setoran: true, noFaktur: `STP-${iso.replace(/-/g, "")}-${id.slice(-5).toUpperCase()}`, ...o });

let lulus = 0, gagal = 0;
const harap = (label: string, ok: boolean, rinci = "") => {
  if (ok) lulus++; else gagal++;
  console.log(`${ok ? "✅" : "❌"} ${label}${rinci ? "  — " + rinci : ""}`);
};
// Cakupan berkas lebar — kasus yang menguji cakupan memberikannya sendiri.
const CAKUPAN_LEBAR = { dari: new Date("2026-01-01T12:00:00Z"), sampai: new Date("2026-12-31T12:00:00Z") };
const OPSI_SETORAN = { terpegangLuar: [] as any[], cakupan: CAKUPAN_LEBAR };
const jalan = (inputs: UserInput[], txs: PdfTransaction[], setoran: any = OPSI_SETORAN) =>
  runMatching(inputs, txs, new Map(), { getRulesForInput: () => ATURAN, nama: { terpegangLuar: [] }, setoran });
const hasil = (out: UserInput[], id: string) => out.find((x) => x.id === id)!.match as any;
const tglOf = (m: any) => m?.txDate?.toISOString?.().slice(0, 10);
const ringkas = (m: any) =>
  `${m?.status} ${m?.matchedBy ?? ""} ${tglOf(m) ?? ""} bebas=${m?.barisBebas ?? "-"} stp=${m?.setoranTidakDitebak ?? "-"} ` +
  `rs=${m?.rebutanSetoran ?? "-"} ref=${m?.refIssue ?? "-"} n=${m?.conflictCount ?? "-"}`.trim();
const txKey = (t: PdfTransaction) => `${t.bankId ?? "_"}-${t.page}-${t.no}`;

/** Invarian anti double claim: tiap baris paling banyak SATU klaim yang
 *  cocok, dan baris yang sudah dipegang di luar jalan ini (claimedByOther)
 *  tidak pernah diambil — kecuali lewat pengusiran yang tercatat. */
function tanpaKlaimGanda(out: UserInput[], txs: PdfTransaction[], disepak: any[] = []): string | null {
  const dipakai = new Map<string, string>();
  const sepakKeys = new Set(disepak.map((d) => d.txKey));
  for (const i of out) {
    const m = i.match as any;
    if (m?.status !== "matched") continue;
    const t = txs.find((x) => x.no === m.txNo && x.tanggalDate.getTime() === m.txDate.getTime());
    if (!t) return `${i.id}: baris tak dikenal`;
    const k = txKey(t);
    if (dipakai.has(k)) return `${k} dipakai ${dipakai.get(k)} DAN ${i.id}`;
    dipakai.set(k, String(i.id));
    if ((t as any).__awalDipegang && !sepakKeys.has(k)) return `${i.id} mengambil baris ${k} yang sudah dipegang`;
  }
  return null;
}
const tandaiAwal = (txs: PdfTransaction[]) => { for (const t of txs) (t as any).__awalDipegang = !!t.claimedByOther; return txs; };

// ═══════════════════════ 1. MATCHER (data tiruan) ═══════════════════════
console.log("── 1. matcher setoran (data tiruan) ──");
{
  // A. REF menunjuk persis — cocok REF (ref FT teller berekor /52).
  const t = tx("2026-09-29", "10.08", 55_000_000, "", { noRef: "FT262721W46G\\P28/52", deskripsi: "SETR" });
  const o = jalan([stp("TFK-1-A", "2026-09-29", 55_000_000, { refFt: "FT262721W46G" })], [t]).inputs;
  harap("A. setoran ber-REF teller /52 → REF", hasil(o, "TFK-1-A").matchedBy === "REF", ringkas(hasil(o, "TFK-1-A")));
}
{
  // B. NOMINAL+JAM, calon tunggal di ±5 menit.
  const t = tx("2026-09-29", "10.08", 55_000_000, "");
  const o = jalan([stp("TFK-1-B", "2026-09-29", 55_000_000, { jamResi: "10:09" })], [t]).inputs;
  harap("B. setoran jam 10:09, satu kredit 10.08 → NOMINAL_JAM", hasil(o, "TFK-1-B").matchedBy === "NOMINAL_JAM", ringkas(hasil(o, "TFK-1-B")));
}
{
  // C. Dua kredit kembar dalam ±5 menit → PASS 3 diam, PASS 4 menolak.
  const t1 = tx("2026-07-01", "14.15", 20_000_000, "");
  const t2 = tx("2026-07-01", "14.18", 20_000_000, "");
  const o = jalan([stp("TFK-1-C", "2026-07-01", 20_000_000, { jamResi: "14:16" })], [t1, t2]).inputs;
  const m = hasil(o, "TFK-1-C");
  harap("C. dua kredit 20 jt dalam ±5 mnt → DITAHAN (setoranTidakDitebak, 2 baris bebas)",
        m.status === "all_taken" && m.setoranTidakDitebak === true && m.barisBebas === true && m.conflictCount === 2, ringkas(m));
}
{
  // D. NOMINAL saja, kredit tepat satu, tanpa pesaing → NOMINAL.
  const t = tx("2026-09-08", "14.45", 25_000_000, "");
  const o = jalan([stp("TFK-1-D", "2026-09-08", 25_000_000)], [t]).inputs;
  harap("D. kredit 25 jt tunggal tanpa pesaing → NOMINAL", hasil(o, "TFK-1-D").matchedBy === "NOMINAL", ringkas(hasil(o, "TFK-1-D")));
  // D2. Sama, beda hari (kredit H+1, jendela maju 1) tetap tunggal → NOMINAL.
  const t2 = tx("2026-09-09", "09.00", 26_000_000, "");
  const o2 = jalan([stp("TFK-1-D2", "2026-09-08", 26_000_000)], [t2]).inputs;
  harap("D2. kredit tunggal H+1 → NOMINAL (tunggal di jendela)", hasil(o2, "TFK-1-D2").matchedBy === "NOMINAL", ringkas(hasil(o2, "TFK-1-D2")));
}
{
  // E. Pemanggil tidak memuat baris terpegang di luar kolam → tidak menebak.
  const t = tx("2026-09-08", "14.45", 25_000_000, "");
  const o = runMatching([stp("TFK-1-E", "2026-09-08", 25_000_000)], [t], new Map(),
    { getRulesForInput: () => ATURAN }).inputs;
  const m = hasil(o, "TFK-1-E");
  harap("E. tanpa opsi setoran (layar /check lama) → DITAHAN, bukan tebakan", m.status === "all_taken" && m.setoranTidakDitebak === true, ringkas(m));
}
{
  // F. Kredit bulat KEMBAR di jendela setoran (20 jt tgl 7 & 8 Jul — data nyata) → DITAHAN.
  const t1 = tx("2026-07-07", "17.24", 20_000_000, "EFENDY");
  const t2 = tx("2026-07-08", "15.49", 20_000_000, "SULAIMAN T");
  const o = jalan([stp("TFK-1-F", "2026-07-07", 20_000_000)], [t1, t2]).inputs;
  const m = hasil(o, "TFK-1-F");
  harap("F. dua kredit 20 jt dalam jendela → DITAHAN, tidak menebak yang hari sama", m.status === "all_taken" && m.setoranTidakDitebak && m.conflictCount === 2, ringkas(m));
}
{
  // G. Kredit tunggal di kolam, tapi kembarannya sudah DIPEGANG di luar kolam → DITAHAN.
  const t = tx("2026-09-08", "14.45", 25_000_000, "");
  const luar = { terpegangLuar: [{ tanggalDate: new Date("2026-09-09T12:00:00Z"), kredit: 25_000_000, bankId: "bank-1", waktu: "10.00" }], cakupan: CAKUPAN_LEBAR };
  const o = jalan([stp("TFK-1-G", "2026-09-08", 25_000_000)], [t], luar).inputs;
  const m = hasil(o, "TFK-1-G");
  harap("G. kembaran terpegang di luar kolam ikut dihitung → DITAHAN", m.status === "all_taken" && m.setoranTidakDitebak === true, ringkas(m));
}
{
  // H. Kredit tunggal + klaim nasabah bernominal sama di jendela → DUA-DUANYA ditahan.
  const t = tx("2026-09-14", "11.52", 20_000_000, "MUHAMMAD REZA MULIAWAN");
  const txs = tandaiAwal([t]);
  const { inputs: o } = jalan([stp("TFK-1-H", "2026-09-14", 20_000_000), inp("TFK-2-H", "2026-09-14", 20_000_000)], txs);
  const ms = hasil(o, "TFK-1-H"), mn = hasil(o, "TFK-2-H");
  harap("H. setoran berpesaing nasabah → setoran DITAHAN", ms.status === "all_taken" && ms.setoranTidakDitebak === true, ringkas(ms));
  harap("H. nasabah tidak mengambil baris yang juga diakui setoran → DITAHAN (rebutanSetoran)",
        mn.status === "all_taken" && mn.rebutanSetoran === true, ringkas(mn));
  // Urutan dibalik — hasil sama.
  const { inputs: o2 } = jalan([inp("TFK-2-H", "2026-09-14", 20_000_000), stp("TFK-1-H", "2026-09-14", 20_000_000)], [tx("2026-09-14", "11.52", 20_000_000, "")]);
  harap("H. urutan dibalik → keduanya tetap DITAHAN",
        hasil(o2, "TFK-1-H").status === "all_taken" && hasil(o2, "TFK-2-H").status === "all_taken" && hasil(o2, "TFK-2-H").rebutanSetoran === true,
        `${ringkas(hasil(o2, "TFK-1-H"))} | ${ringkas(hasil(o2, "TFK-2-H"))}`);
  // Nasabah dengan jam jauh dari jam baris bukan pesaing setoran (pakaiJam untuk pagar (e) berlaku pada SETORAN-nya).
  const t3 = tx("2026-09-14", "11.52", 20_000_000, "");
  const { inputs: o3 } = jalan([stp("TFK-1-H3", "2026-09-14", 20_000_000, { jamResi: "16:00" }), inp("TFK-2-H3", "2026-09-14", 20_000_000)], [t3]);
  harap("H3. setoran jam 16:00 (baris 11.52) bukan pesaing (e) → nasabah boleh menebak, setoran DITAHAN",
        hasil(o3, "TFK-2-H3").status === "matched" && hasil(o3, "TFK-1-H3").status === "all_taken",
        `${ringkas(hasil(o3, "TFK-1-H3"))} | ${ringkas(hasil(o3, "TFK-2-H3"))}`);
}
{
  // I. Kredit satu-satunya sudah dipegang klaim lain → bentrok biasa, DITAHAN.
  const t = tx("2026-08-11", "13.38", 40_000_000, "", { claimedByOther: true });
  const o = jalan([stp("TFK-1-I", "2026-08-11", 40_000_000)], tandaiAwal([t])).inputs;
  const m = hasil(o, "TFK-1-I");
  harap("I. kredit satu-satunya sudah dipegang → all_taken (barisBebas=false), tidak diambil",
        m.status === "all_taken" && m.barisBebas === false && m.setoranTidakDitebak === true, ringkas(m));
}
{
  // J. Tidak ada kredit bernominal itu sama sekali → no_candidate (dikirim UNMATCHED, label /belum-cocok).
  const t = tx("2026-08-11", "13.38", 40_000_000, "");
  const o = jalan([stp("TFK-1-J", "2026-08-11", 41_000_000)], [t]).inputs;
  harap("J. tanpa kredit bernominal sama → no_candidate", hasil(o, "TFK-1-J").status === "no_candidate", ringkas(hasil(o, "TFK-1-J")));
}
{
  // K. Setoran ber-REF menunjuk baris yang dipegang NASABAH lewat NOMINAL → TIDAK mengusir.
  const t = tx("2026-09-21", "10.33", 49_011_000, "", {
    noRef: "FT2626448QJF\\Q53/52", claimedByOther: true,
    pemegang: { inputId: "ci-n", matchedBy: "NOMINAL", manual: false, gadaiKlaimId: "TFK-2-K", noFaktur: "SBR-2-0001" },
  });
  const r = jalan([
    stp("TFK-1-K", "2026-09-21", 49_011_000, { refFt: "FT2626448QJF" }),
    inp("TFK-2-K", "2026-09-21", 49_011_000, { sudahMemegang: true, noFaktur: "SBR-2-0001" }),
  ], tandaiAwal([t]));
  const m = hasil(r.inputs, "TFK-1-K");
  harap("K. setoran ber-REF TIDAK mengusir nasabah → REF_SUDAH_DIKLAIM, disepak kosong",
        m.status === "all_taken" && m.refIssue === "REF_SUDAH_DIKLAIM" && (r.summary.disepak ?? []).length === 0, ringkas(m));
  // Pembanding: klaim NASABAH ber-REF yang sama memang mengusir (perilaku lama tetap).
  const t2 = tx("2026-09-21", "10.33", 49_011_000, "", {
    noRef: "FT2626448QJF\\Q53/52", claimedByOther: true,
    pemegang: { inputId: "ci-n", matchedBy: "NOMINAL", manual: false, gadaiKlaimId: "TFK-2-K", noFaktur: "SBR-2-0001" },
  });
  const r2 = jalan([
    inp("TFK-3-K", "2026-09-21", 49_011_000, { refFt: "FT2626448QJF" }),
    inp("TFK-2-K", "2026-09-21", 49_011_000, { sudahMemegang: true, noFaktur: "SBR-2-0001" }),
  ], [t2]);
  harap("K. pembanding: nasabah ber-REF mengusir tebakan nasabah (aturan lama utuh)",
        hasil(r2.inputs, "TFK-3-K").matchedBy === "REF" && (r2.summary.disepak ?? []).length === 1, ringkas(hasil(r2.inputs, "TFK-3-K")));
}
{
  // L. Nasabah ber-REF menunjuk baris yang dipegang SETORAN lewat NOMINAL → TIDAK mengusir.
  const t = tx("2026-09-08", "14.45", 25_000_000, "", {
    noRef: "FT26251D9S6Z\\Q53/52", claimedByOther: true,
    pemegang: { inputId: "ci-s", matchedBy: "NOMINAL", manual: false, gadaiKlaimId: "TFK-1-L", noFaktur: "STP-20260908-AAAAA", setoran: true },
  });
  const r = jalan([
    inp("TFK-2-L", "2026-09-08", 25_000_000, { refFt: "FT26251D9S6Z" }),
    stp("TFK-1-L", "2026-09-08", 25_000_000, { sudahMemegang: true }),
  ], tandaiAwal([t]));
  const m = hasil(r.inputs, "TFK-2-L");
  harap("L. nasabah ber-REF TIDAK mengusir setoran → REF_SUDAH_DIKLAIM, disepak kosong",
        m.status === "all_taken" && m.refIssue === "REF_SUDAH_DIKLAIM" && (r.summary.disepak ?? []).length === 0, ringkas(m));
  // L2. pemegang setoran dikenali dari INPUT korban (setoran:true) walau pemegang.setoran kosong.
  const t2 = tx("2026-09-08", "14.45", 25_000_000, "", {
    noRef: "FT26251D9S6Z\\Q53/52", claimedByOther: true,
    pemegang: { inputId: "ci-s", matchedBy: "NOMINAL", manual: false, gadaiKlaimId: "TFK-1-L", noFaktur: null },
  });
  const r2 = jalan([
    inp("TFK-2-L", "2026-09-08", 25_000_000, { refFt: "FT26251D9S6Z" }),
    inp("TFK-1-L", "2026-09-08", 25_000_000, { sudahMemegang: true, setoran: true }),
  ], [t2]);
  harap("L2. korban dikenali setoran dari inputnya → tidak diusir", (r2.summary.disepak ?? []).length === 0, ringkas(hasil(r2.inputs, "TFK-2-L")));
}
{
  // M. Setoran TETAP dihitung di `rebutan`: nasabah tanpa jam, kredit satu-satunya
  //    di H+1 — tanpa setoran ia menebak lintas hari; dengan setoran bernominal
  //    sama di hari yang sama ia menolak (pagar lintas hari, bukan pagar (e)).
  const mk = () => [tx("2026-10-03", "09.00", 5_000_000, "")];
  const tanpa = jalan([inp("TFK-2-M", "2026-10-02", 5_000_000)], mk()).inputs;
  harap("M. pembanding: nasabah sendirian menebak kredit H+1", hasil(tanpa, "TFK-2-M").status === "matched", ringkas(hasil(tanpa, "TFK-2-M")));
  const dengan = jalan([inp("TFK-2-M", "2026-10-02", 5_000_000), stp("TFK-1-M", "2026-10-02", 5_000_000)], mk()).inputs;
  const mn = hasil(dengan, "TFK-2-M");
  harap("M. ada setoran bernominal sama hari itu → nasabah menolak tebak lintas hari (rebutan menghitung setoran)",
        mn.status === "all_taken" && mn.barisBebas === true && !mn.rebutanSetoran, ringkas(mn));
  harap("M. setorannya sendiri juga DITAHAN", hasil(dengan, "TFK-1-M").setoranTidakDitebak === true, ringkas(hasil(dengan, "TFK-1-M")));
}
{
  // N. Setoran tidak memakai PASS 2 (nama+jam 14 hari) maupun PASS 3b (nama tanpa jam).
  const t = tx("2026-07-20", "16.02", 20_000_000, "MUHAMMAD REZA MULIAWAN");
  const o = jalan([stp("TFK-1-N", "2026-07-25", 20_000_000, { jamResi: "16:02", namaPengirimResi: "Muhammad Reza Muliawan" })], [t]).inputs;
  harap("N. setoran 5 hari sesudah kredit bernama+jam sama → TIDAK cocok lewat NAMA_JAM",
        hasil(o, "TFK-1-N").status !== "matched", ringkas(hasil(o, "TFK-1-N")));
  const t2 = tx("2026-07-20", "16.02", 20_000_000, "MUHAMMAD REZA MULIAWAN");
  const t3 = tx("2026-07-21", "13.56", 20_000_000, "LAIN ORANG");
  const o2 = jalan([stp("TFK-1-N2", "2026-07-20", 20_000_000, { namaPengirimResi: "Muhammad Reza Muliawan" })], [t2, t3]).inputs;
  harap("N2. setoran bernama tanpa jam, dua kredit 20 jt → TIDAK lewat NAMA, DITAHAN",
        hasil(o2, "TFK-1-N2").status === "all_taken" && hasil(o2, "TFK-1-N2").setoranTidakDitebak === true, ringkas(hasil(o2, "TFK-1-N2")));
}
{
  // O. Agen LKP: nominal kecil yang SERING kembar dengan transfer nasabah.
  const t1 = tx("2026-10-01", "17.17", 66_000, "Ihzan bunaiya", { deskripsi: "LKP100042CASH-PT ACEH GADAI SYARIAH" });
  const t2 = tx("2026-10-01", "19.40", 66_000, "BUDI");
  const o = jalan([stp("TFK-1-O", "2026-10-01", 66_000, { jamResi: "17:18" })], [t1, t2]).inputs;
  harap("O. agen LKP berjam, kembaran beda jam → NOMINAL_JAM ke baris yang jamnya cocok",
        hasil(o, "TFK-1-O").matchedBy === "NOMINAL_JAM" && tglOf(hasil(o, "TFK-1-O")) === "2026-10-01", ringkas(hasil(o, "TFK-1-O")));
  // O2. ada klaim nasabah tanpa jam bernominal sama → setoran DITAHAN (pesaing).
  const o2 = jalan([stp("TFK-1-O", "2026-10-01", 66_000, { jamResi: "17:18" }), inp("TFK-2-O", "2026-10-01", 66_000)],
    [tx("2026-10-01", "17.17", 66_000, "Ihzan bunaiya"), tx("2026-10-01", "19.40", 66_000, "BUDI")]).inputs;
  harap("O2. nasabah tanpa jam bernominal sama = pesaing → setoran tidak lewat NOMINAL_JAM",
        hasil(o2, "TFK-1-O").status === "all_taken", ringkas(hasil(o2, "TFK-1-O")));
}
{
  // P. Campuran besar — tidak ada satu baris dipegang dua klaim, dan setoran
  //    yang cocok lewat NOMINAL selalu calon tunggal tanpa pesaing.
  no = 0;
  const txs = tandaiAwal([
    tx("2026-09-08", "14.45", 25_000_000, ""), tx("2026-09-09", "14.39", 20_000_000, ""),
    tx("2026-09-11", "10.59", 15_000_000, ""), tx("2026-09-13", "18.03", 10_000_000, "EFENDY"),
    tx("2026-09-13", "21.40", 10_000_000, "MUHAMMAD REZA MULIAWAN"), tx("2026-09-14", "11.52", 20_000_000, "MUHAMMAD REZA MULIAWAN"),
    tx("2026-09-14", "15.52", 14_000_000, ""), tx("2026-09-20", "13.14", 20_000_000, "DARWIS", { claimedByOther: true }),
  ]);
  tandaiAwal(txs);
  const ins = [
    stp("TFK-1-P1", "2026-09-08", 25_000_000), stp("TFK-1-P2", "2026-09-09", 20_000_000),
    stp("TFK-1-P3", "2026-09-11", 15_000_000, { jamResi: "10:59" }), stp("TFK-1-P4", "2026-09-13", 10_000_000),
    inp("TFK-2-P5", "2026-09-13", 10_000_000), stp("TFK-1-P6", "2026-09-14", 14_000_000),
    stp("TFK-1-P7", "2026-09-20", 20_000_000), inp("TFK-2-P8", "2026-09-14", 20_000_000, { jamResi: "11:52", namaPengirimResi: "MUHAMMAD REZA MULIAWAN" }),
  ];
  const r = jalan(ins, txs);
  harap("P. campuran: tidak ada baris dipegang dua klaim", tanpaKlaimGanda(r.inputs, txs, r.summary.disepak) === null,
        tanpaKlaimGanda(r.inputs, txs, r.summary.disepak) ?? "");
  const ms = (id: string) => hasil(r.inputs, id);
  harap("P. P1 25 jt tunggal → NOMINAL", ms("TFK-1-P1").matchedBy === "NOMINAL", ringkas(ms("TFK-1-P1")));
  harap("P. P2 20 jt (kembar 14 Sep dalam jendela? tidak — jendela setoran 9-10 Sep) → NOMINAL", ms("TFK-1-P2").matchedBy === "NOMINAL", ringkas(ms("TFK-1-P2")));
  harap("P. P3 berjam → NOMINAL_JAM", ms("TFK-1-P3").matchedBy === "NOMINAL_JAM", ringkas(ms("TFK-1-P3")));
  harap("P. P4 10 jt kembar di hari itu → DITAHAN", ms("TFK-1-P4").setoranTidakDitebak === true, ringkas(ms("TFK-1-P4")));
  harap("P. P6 14 jt tunggal → NOMINAL", ms("TFK-1-P6").matchedBy === "NOMINAL", ringkas(ms("TFK-1-P6")));
  harap("P. P7 20 jt satu-satunya sudah dipegang → tidak diambil", ms("TFK-1-P7").status === "all_taken", ringkas(ms("TFK-1-P7")));
  harap("P. P8 nasabah nama+jam → NAMA_JAM (setoran tidak mengganggu bukti kuat)", ms("TFK-2-P8").matchedBy === "NAMA_JAM", ringkas(ms("TFK-2-P8")));
  harap("P. adalahSetoran mengenali nomor STP- tanpa medan setoran", adalahSetoran({ noFaktur: "STP-20261005-ABCDE" } as any) && !adalahSetoran({ noFaktur: "SBR-1-0001" } as any));
}

// ── Perbaikan tinjauan S7: bantahan, jendela setoran, cakupan berkas ──
{
  // Q. REF slip menunjuk baris bernominal BEDA (AI salah baca angka di slip
  //    kertas / kasir menyetor kurang) → JANGAN ambil kredit bernominal sama
  //    milik orang lain; tahan dengan refIssue (dikirim sebagai alarm REF).
  no = 0;
  const tRef = tx("2026-10-04", "10.05", 15_000_000, "", { noRef: "FT26278ABCDE\P28/52" });
  const tBudi = tx("2026-10-04", "13.00", 10_000_000, "BUDI");
  const o = jalan([stp("TFK-1-Q", "2026-10-04", 10_000_000, { refFt: "FT26278ABCDE" })], [tRef, tBudi]).inputs;
  const m = hasil(o, "TFK-1-Q");
  harap("Q. REF_NOMINAL_BEDA + satu kredit 10 jt lain → TIDAK ditebak (all_taken, refIssue terbawa)",
        m.status === "all_taken" && m.refIssue === "REF_NOMINAL_BEDA" && m.setoranTidakDitebak === true, ringkas(m));
  // Q2. Varian berjam (jam slip = jam baris BUDI) → tidak lewat NOMINAL_JAM juga.
  const o2 = jalan([stp("TFK-1-Q2", "2026-10-04", 10_000_000, { refFt: "FT26278ABCDE", jamResi: "13:00" })],
    [tx("2026-10-04", "10.05", 15_000_000, "", { noRef: "FT26278ABCDE\P28/52" }), tx("2026-10-04", "13.00", 10_000_000, "BUDI")]).inputs;
  const m2 = hasil(o2, "TFK-1-Q2");
  harap("Q2. REF_NOMINAL_BEDA berjam → TIDAK lewat NOMINAL_JAM", m2.status !== "matched" && m2.refIssue === "REF_NOMINAL_BEDA", ringkas(m2));
  // Q3. REF_NOMINAL_BEDA tanpa kredit bernominal sama → no_candidate + refIssue.
  const o3 = jalan([stp("TFK-1-Q3", "2026-10-04", 11_000_000, { refFt: "FT26278ABCDE" })],
    [tx("2026-10-04", "10.05", 15_000_000, "", { noRef: "FT26278ABCDE\P28/52" })]).inputs;
  const m3 = hasil(o3, "TFK-1-Q3");
  harap("Q3. REF_NOMINAL_BEDA tanpa kredit sama → no_candidate + refIssue", m3.status === "no_candidate" && m3.refIssue === "REF_NOMINAL_BEDA", ringkas(m3));
}
{
  // R. Jam slip terbaca, satu-satunya kredit di hari yang sama jamnya meleset jauh → DITAHAN.
  const o = jalan([stp("TFK-1-R", "2026-10-04", 10_000_000, { jamResi: "10:00" })],
    [tx("2026-10-04", "15.40", 10_000_000, "SITI AMINAH")]).inputs;
  const m = hasil(o, "TFK-1-R");
  harap("R. jam slip 10:00 vs kredit tunggal 15.40 hari sama → DITAHAN (jam membantah)",
        m.status === "all_taken" && m.setoranTidakDitebak === true && m.barisBebas === true, ringkas(m));
  // R2. Jam slip sore, kredit tunggal ESOK hari (pembukuan esok) → jam tidak dinilai, NOMINAL.
  const o2 = jalan([stp("TFK-1-R2", "2026-10-04", 10_000_000, { jamResi: "16:00" })],
    [tx("2026-10-05", "08.10", 10_000_000, "")]).inputs;
  harap("R2. kredit tunggal esok hari → NOMINAL (jam beda hari tidak membantah)", hasil(o2, "TFK-1-R2").matchedBy === "NOMINAL", ringkas(hasil(o2, "TFK-1-R2")));
}
{
  // S. Kredit bernominal sama SEBELUM tanggal slip → mustahil milik setoran.
  const o = jalan([stp("TFK-1-S", "2026-10-02", 55_000_000, { jamResi: "10:00" })],
    [tx("2026-09-29", "10.08", 55_000_000, "", { noRef: "FT262721W46G\P28/52", deskripsi: "SETR" })]).inputs;
  const m = hasil(o, "TFK-1-S");
  harap("S. satu-satunya kredit 3 hari SEBELUM slip → tidak diambil (no_candidate)", m.status === "no_candidate", ringkas(m));
  // S2. Kredit H-1 + kredit hari slip → hanya hari slip yang dihitung → NOMINAL ke hari slip.
  const o2 = jalan([stp("TFK-1-S2", "2026-10-02", 20_000_000)],
    [tx("2026-10-01", "15.00", 20_000_000, "ANDI"), tx("2026-10-02", "11.00", 20_000_000, "")]).inputs;
  const m2 = hasil(o2, "TFK-1-S2");
  harap("S2. kredit H-1 tidak masuk jendela setoran → NOMINAL ke baris hari slip", m2.matchedBy === "NOMINAL" && tglOf(m2) === "2026-10-02", ringkas(m2));
  // S3. Pesaing setoran juga memakai jendela setoran: setoran tgl 3 Okt BUKAN
  //     pesaing nasabah atas baris 2 Okt (setoran tidak mundur).
  const o3 = jalan([inp("TFK-2-S3", "2026-10-02", 7_000_000), stp("TFK-1-S3", "2026-10-03", 7_000_000)],
    [tx("2026-10-02", "09.00", 7_000_000, "")]).inputs;
  harap("S3. setoran 3 Okt bukan pesaing baris 2 Okt → nasabah cocok, setoran no_candidate",
        hasil(o3, "TFK-2-S3").status === "matched" && hasil(o3, "TFK-1-S3").status === "no_candidate",
        `${ringkas(hasil(o3, "TFK-2-S3"))} | ${ringkas(hasil(o3, "TFK-1-S3"))}`);
}
{
  // T. Cakupan berkas: jendela setoran [tgl, tgl+1] harus seluruhnya di dalam berkas.
  const cak = { dari: new Date("2026-10-01T12:00:00Z"), sampai: new Date("2026-10-05T12:00:00Z") };
  const mk = (iso: string) => [tx(iso, "11.00", 20_000_000, "")];
  const ok = jalan([stp("TFK-1-T1", "2026-10-04", 20_000_000)], mk("2026-10-04"), { terpegangLuar: [], cakupan: cak }).inputs;
  harap("T1. tgl 4 Okt, berkas 1-5 Okt (jendela 4-5 tercakup) → NOMINAL", hasil(ok, "TFK-1-T1").matchedBy === "NOMINAL", ringkas(hasil(ok, "TFK-1-T1")));
  const ujung = jalan([stp("TFK-1-T2", "2026-10-05", 20_000_000)], mk("2026-10-05"), { terpegangLuar: [], cakupan: cak }).inputs;
  harap("T2. tgl 5 Okt = akhir berkas (kredit 6 Okt belum terlihat) → DITAHAN",
        hasil(ujung, "TFK-1-T2").status === "all_taken" && hasil(ujung, "TFK-1-T2").setoranTidakDitebak === true, ringkas(hasil(ujung, "TFK-1-T2")));
  const awal = jalan([stp("TFK-1-T3", "2026-09-30", 20_000_000)], mk("2026-10-01"), { terpegangLuar: [], cakupan: cak }).inputs;
  harap("T3. tgl sebelum awal berkas → DITAHAN", hasil(awal, "TFK-1-T3").status === "all_taken", ringkas(hasil(awal, "TFK-1-T3")));
  const tanpa = jalan([stp("TFK-1-T4", "2026-10-04", 20_000_000)], mk("2026-10-04"), { terpegangLuar: [] }).inputs;
  harap("T4. cakupan tidak diketahui → DITAHAN", hasil(tanpa, "TFK-1-T4").status === "all_taken", ringkas(hasil(tanpa, "TFK-1-T4")));
}
{
  // U. Pemanggil tanpa baris terpegang luar kolam (layar /check, Riwayat Cek)
  //    → PASS 3 setoran juga diam (dulu hanya PASS 4).
  const o = runMatching([stp("TFK-1-U", "2026-10-04", 20_000_000, { jamResi: "10:08" })], [tx("2026-10-04", "10.08", 20_000_000, "")], new Map(),
    { getRulesForInput: () => ATURAN }).inputs;
  const m = hasil(o, "TFK-1-U");
  harap("U. tanpa opsi setoran, jam cocok → TIDAK lewat NOMINAL_JAM (DITAHAN)", m.status === "all_taken" && m.setoranTidakDitebak === true, ringkas(m));
}

// ═══════════ 2. PEMBANDING ACAK: tanpa setoran = matcher lama ═══════════
console.log("── 2. pembanding acak vs matcher sebelum S7 ──");
const lamaPath = "lib/__lama_matching_s7.ts";
let lama: any = null;
try {
  writeFileSync(lamaPath, execSync(`git show ${DASAR}:lib/matching.ts`, { encoding: "utf8", maxBuffer: 8 << 20 }));
  lama = await import("../" + lamaPath);
} catch (e) {
  harap("matcher lama dapat dimuat dari git " + DASAR, false, String(e));
} finally {
  if (existsSync(lamaPath)) unlinkSync(lamaPath);
}
if (lama) {
  let seed = 20261005;
  const acak = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pilih = <T,>(a: T[]) => a[Math.floor(acak() * a.length)];
  const NOM = [50_000, 100_000, 460_000, 2_530_000, 5_000_000, 20_000_000];
  const NAMA = ["ANDINI SAHPUTRI", "MUHAMMAD SIDDIQ", "BUDI SANTOSO", "", "DANA"];
  const JAM = ["09.00", "12.03", "12.15", "18.02", "22.31", ""];
  const hari = (d: number) => `2026-09-${String(10 + d).padStart(2, "0")}`;
  let beda = 0, kasus = 0, kasusSetoran = 0, gandaSetoran = 0;
  for (let k = 0; k < 400; k++) {
    const nTx = 3 + Math.floor(acak() * 10), nIn = 2 + Math.floor(acak() * 8);
    const spec = Array.from({ length: nTx }, (_, j) => ({
      d: Math.floor(acak() * 6), jam: pilih(JAM), nom: pilih(NOM), nama: pilih(NAMA), j,
      pegang: acak() < 0.2, cara: pilih(["NOMINAL", "REF", "MANUAL", "NAMA"]),
    }));
    const ispec = Array.from({ length: nIn }, (_, j) => {
      const ref = acak() < 0.3 ? spec[Math.floor(acak() * nTx)] : null;
      return { id: `TFK-9-${k}-${j}`, d: Math.floor(acak() * 6), nom: ref && acak() < 0.8 ? ref.nom : pilih(NOM),
               jam: acak() < 0.5 ? pilih(JAM).replace(".", ":") : null, nama: acak() < 0.5 ? pilih(NAMA) : null,
               ref: ref ? `FTR${String(ref.j).padStart(9, "0")}` : null, memegang: false };
    });
    // Sebagian baris terpegang dipegang klaim yang ikut ditarik (korban sepak).
    const bangun = (setoranIds: Set<string>) => {
      no = 0;
      const txs = spec.map((s) => tx(hari(s.d), s.jam, s.nom, s.nama, {
        noRef: `FTR${String(s.j).padStart(9, "0")}\\Q53/52`,
        claimedByOther: s.pegang,
        pemegang: s.pegang ? { inputId: `ci-${s.j}`, matchedBy: s.cara === "MANUAL" ? null : s.cara, manual: s.cara === "MANUAL",
                               gadaiKlaimId: `TFK-8-${k}-${s.j}`, noFaktur: `SBR-8-${s.j}` } : undefined,
      }));
      const ins = ispec.map((s) => inp(s.id, hari(s.d), s.nom, {
        jamResi: s.jam, namaPengirimResi: s.nama, refFt: s.ref,
        ...(setoranIds.has(s.id) ? { setoran: true, noFaktur: `STP-202609${10 + s.d}-${s.id.slice(-3)}` } : {}),
      }));
      for (const s of spec) if (s.pegang && s.cara !== "MANUAL")
        ins.push(inp(`TFK-8-${k}-${s.j}`, hari(s.d), s.nom, { sudahMemegang: true, jamResi: s.jam ? s.jam.replace(".", ":") : null }));
      return { txs: tandaiAwal(txs), ins };
    };
    const opsi = (stp: boolean) => ({ getRulesForInput: () => ATURAN, nama: { terpegangLuar: [] },
                                      ...(stp ? { setoran: { terpegangLuar: [], cakupan: CAKUPAN_LEBAR } } : {}) });
    // (a) tanpa setoran: baru vs lama, dengan & tanpa opsi setoran.
    const a = bangun(new Set());
    const b = bangun(new Set());
    const c = bangun(new Set());
    const hBaru = runMatching(a.ins, a.txs, new Map(), opsi(true));
    const hBaru2 = runMatching(c.ins, c.txs, new Map(), opsi(false));
    const hLama = lama.runMatching(b.ins, b.txs, new Map(), opsi(false));
    const sidik = (h: any) => JSON.stringify({ i: h.inputs.map((x: any) => x.match ?? null), d: h.summary.disepak, m: h.summary.matched,
                                               u: h.summary.unclaimed.map((t: any) => t.no) });
    kasus++;
    if (sidik(hBaru) !== sidik(hLama) || sidik(hBaru2) !== sidik(hLama)) {
      beda++;
      if (beda <= 3) console.log("   beda kasus", k, "\n   baru:", sidik(hBaru).slice(0, 400), "\n   lama:", sidik(hLama).slice(0, 400));
    }
    // (b) dengan setoran acak: invarian anti double claim.
    const ids = new Set(ispec.filter(() => acak() < 0.4).map((s) => s.id));
    if (ids.size) {
      kasusSetoran++;
      const d = bangun(ids);
      const h = runMatching(d.ins, d.txs, new Map(), opsi(true));
      const salah = tanpaKlaimGanda(h.inputs, d.txs, h.summary.disepak);
      const sepakSetoran = (h.summary.disepak ?? []).some((x: any) => ids.has(x.olehKlaimId) || ids.has(x.pemegangKlaimId));
      // Setoran yang cocok lewat NOMINAL: baris itu satu-satunya kredit
      // bernominal sama di jendelanya (terpegang atau tidak).
      const nominalTakTunggal = h.inputs.some((x: any) => {
        if (!ids.has(String(x.id)) || x.match?.status !== "matched" || x.match.matchedBy !== "NOMINAL") return false;
        const sama = d.txs.filter((t) => t.kredit === x.nominal && (() => {
          const dd = Math.round((x.tanggal.getTime() - t.tanggalDate.getTime()) / 86_400_000);
          return dd === 0 || dd === -1;   // jendela setoran [tgl slip, +1]
        })());
        return sama.length !== 1;
      });
      if (salah || sepakSetoran || nominalTakTunggal) {
        gandaSetoran++;
        if (gandaSetoran <= 3) console.log("   pelanggaran kasus", k, salah, sepakSetoran, nominalTakTunggal);
      }
    }
  }
  harap(`acak: ${kasus} kasus TANPA setoran — hasil matcher baru = matcher lama (dengan & tanpa opsi setoran)`, beda === 0, `${beda} beda`);
  harap(`acak: ${kasusSetoran} kasus DENGAN setoran — tidak ada klaim ganda, tidak ada sepak lintas setoran, NOMINAL selalu tunggal`,
        gandaSetoran === 0, `${gandaSetoran} pelanggaran`);
}

// ═══════════════════════ 3. LAPORAN LAPIS 2 ═══════════════════════
console.log("── 3. laporan Lapis 2 ──");
const isiDasar = (): IsiLapis2 => ({
  bankLabel: "BSI 1999881994", namaFile: "mutasi.pdf",
  berkasDari: "2026-10-03", berkasSampai: "2026-10-05", nilaiDari: "2026-10-03", nilaiSampai: "2026-10-05",
  utuh: true, rantaiPutus: 0, nyambung: true, selisihSambungan: 0,
  perTanggal: [{ tgl: "2026-10-04", jml: 5, rp: 30_200_000, masukJml: 5, masukRp: 30_200_000, keluarJml: 0, keluarRp: 0 }],
  nDiuji: 5, rpDiuji: 30_200_000, nCocok: 3,
  tidakKetemu: [{ no_faktur: "SBR-1-0001", outlet: "BIREUEN", tgl: "2026-10-04", nominal: 100_000, sebab: "tidak ada di rekening" }],
  ditahanLuarPeriode: 0, ditahanKonflik: 0,
  kreditNganggur: [], rpKreditNganggur: 0, debetNganggur: [], rpDebetNganggur: 0, nganggurDiperiksa: true,
  sandingan: {
    total: { lahir: { n: 5, rp: 30_200_000 }, tertahan: { n: 0, rp: 0 }, dilepas: { n: 5, rp: 30_200_000 },
             divonis: { n: 5, rp: 30_200_000 }, menggantung: { n: 0, rp: 0 } },
    tanggal: [{ tgl: "2026-10-04", arah: "KREDIT", lahir: { n: 5, rp: 30_200_000 }, dilepas: { n: 5, rp: 30_200_000 },
                divonis: { n: 5, rp: 30_200_000 }, menggantung: { n: 0, rp: 0 }, tertahan: { n: 0, rp: 0 },
                rinci: { MATCHED: { n: 3, rp: 5_100_000 }, UNMATCHED: { n: 2, rp: 25_100_000 } } }],
    baruTakKetemu: [
      { no_faktur: "SBR-1-0001", outlet: "BIREUEN", arah: "KREDIT", tgl: "2026-10-04", nominal: 100_000 },
      { no_faktur: "STP-20261004-AB12C", outlet: "BIREUEN", arah: "KREDIT", tgl: "2026-10-04", nominal: 25_000_000 },
    ],
    ketinggalan: [],
  } as any,
  tunggakan: [], gagal: [],
});
// 3a. Tanpa medan setoran apa pun → teks SAMA PERSIS dengan lapis2 lama.
{
  const lamaL = "lib/laporan/__lama_lapis2_s7.ts";
  try {
    writeFileSync(lamaL, execSync(`git show ${DASAR}:lib/laporan/lapis2.ts`, { encoding: "utf8", maxBuffer: 8 << 20 }));
    const L0 = await import("../" + lamaL);
    const fixtures: IsiLapis2[] = [];
    const f1 = isiDasar(); (f1.sandingan as any).baruTakKetemu = [(f1.sandingan as any).baruTakKetemu[0]];
    (f1.sandingan as any).tanggal[0].rinci = { MATCHED: { n: 4, rp: 30_100_000 }, UNMATCHED: { n: 1, rp: 100_000 } };
    fixtures.push(f1);
    const f2 = isiDasar(); f2.sandingan = null; fixtures.push(f2);
    const f3 = isiDasar(); f3.ditahanKonflik = 2;
    f3.alasanKlaim = [{ id: "a", no_faktur: "X", outlet: "O", tgl: "2026-10-04", nominal: 1, sebab: "TOLAK_LINTAS_HARI" },
                      { id: "b", no_faktur: "Y", outlet: "O", tgl: "2026-10-04", nominal: 1, sebab: "BEREBUT", bertentangan: true }];
    fixtures.push(f3);
    const kepala = { nomor: 7, sebelumNomor: 6, sebelumKapan: null };
    const semuaSama = fixtures.every((f) => L0.susunLapis2(f, kepala) === susunLapis2(f, kepala));
    harap("3a. laporan tanpa setoran SAMA PERSIS dengan versi sebelum S7 (3 bentuk)", semuaSama);
  } catch (e) {
    harap("3a. lapis2 lama dapat dimuat dari git " + DASAR, false, String(e));
  } finally {
    if (existsSync(lamaL)) unlinkSync(lamaL);
  }
}
// 3b. Dengan setoran: STP tidak divonis "tidak ada di rekening".
{
  const isi = isiDasar();
  (isi.sandingan as any).setoran = [{
    tgl: "2026-10-04", lahir: { n: 2, rp: 30_000_000 }, cocok: { n: 1, rp: 5_000_000 }, tak: { n: 1, rp: 25_000_000 },
    menggantung: { n: 0, rp: 0 }, tertahan: { n: 0, rp: 0 }, mati: { n: 0, rp: 0 },
    perOutlet: { BIREUEN: { lahir: { n: 2, rp: 30_000_000 }, cocok: { n: 1, rp: 5_000_000 }, tak: { n: 1, rp: 25_000_000 } } },
    daftar: [{ klaim_id: "TFK-1-x", no_faktur: "STP-20261004-AB12C", outlet: "BIREUEN", nominal: 25_000_000, ket: "tidak ada di rekening PT" }],
  }];
  isi.ditahanKonflik = 2;
  isi.alasanKlaim = [
    { id: "TFK-1-y", no_faktur: "STP-20261004-ZZ9", outlet: "LANGSA", tgl: "2026-10-04", nominal: 20_000_000, sebab: "BEREBUT", setoran: true, setoranTidakDitebak: true },
    { id: "TFK-2-y", no_faktur: "SBR-2-0009", outlet: "LANGSA", tgl: "2026-10-04", nominal: 20_000_000, sebab: "BEREBUT", rebutanSetoran: true },
  ];
  const teks = susunLapis2(isi, { nomor: 8, sebelumNomor: 7, sebelumKapan: null });
  const baris = teks.split("\n");
  harap("3b. ada blok 🏦 SETORAN OUTLET → REK PT", teks.includes("🏦 SETORAN OUTLET → REK PT"));
  harap("3b. per tanggal: 🔎 setoran belum ketemu, terpisah dari ⛔", teks.includes("🔎 setoran outlet belum ketemu kreditnya 1") && teks.includes("⛔ tidak ada di rekening  1"));
  harap("3b. tidak ada baris STP yang berbunyi 'tidak ada di rekening'",
        !baris.some((b) => b.includes("STP-") && /tidak ada di rekening/i.test(b)), baris.filter((b) => b.includes("STP-")).join(" | "));
  harap("3b. penjumlahan per tanggal tetap tutup (tak ada 🚨 TIDAK tutup)", !teks.includes("TIDAK tutup"));
  harap("3b. peringatan: slip setoran tidak ditebak + resi nasabah rebutan setoran, 'berebut' tidak dobel",
        teks.includes("1 slip SETORAN OUTLET → rek PT tidak ditebak") && teks.includes("1 resi tidak ditebak mesin: baris calonnya juga diakui SETORAN") &&
        !teks.includes("resi belum bisa dinilai (berebut"));
  harap("3b. SEBAB_SETORAN_BELUM_KETEMU tidak terbaca sebagai alarm REF", !/resi bekas|\bREF\b|nominal beda/i.test(SEBAB_SETORAN_BELUM_KETEMU));
  if (gagal) console.log(teks);
}

// 3c. Laporan CADANGAN (sandingan gadai gagal diambil): setoran yang kreditnya
//     belum ketemu TIDAK dihitung di "⛔ tidak ada di rekening" (perbaikan tinjauan S7).
{
  const isi = isiDasar();
  isi.sandingan = null;
  isi.tidakKetemu = [
    { no_faktur: "SBR-1-0001", outlet: "BIREUEN", tgl: "2026-10-04", nominal: 100_000, sebab: "tidak ada di rekening" },
    { no_faktur: "STP-20261004-AB12C", outlet: "BIREUEN", tgl: "2026-10-04", nominal: 25_000_000, sebab: SEBAB_SETORAN_BELUM_KETEMU },
  ];
  const teks = susunLapis2(isi, { nomor: 9, sebelumNomor: 8, sebelumKapan: null });
  const baris = teks.split("\n");
  harap("3c. cadangan: ⛔ tidak ada di rekening hanya 1 (tanpa setoran)", teks.includes("⛔ tidak ada di rekening 1 ·"), baris.filter((b) => /rekening|setoran/.test(b)).join(" | "));
  harap("3c. cadangan: 🔎 setoran outlet belum ketemu kreditnya 1, STP tidak di bawah ⛔",
        teks.includes("🔎 setoran outlet belum ketemu kreditnya 1") &&
        baris.findIndex((b) => b.includes("STP-")) > baris.findIndex((b) => b.includes("🔎 setoran outlet")));
}

// ═══════════════════════ 4. tolakLintasHari ═══════════════════════
console.log("── 4. /belum-cocok: sebab setoran ──");
{
  const baris = [
    { gadai_klaim_id: "TFK-1-s", match_status: "all_taken", ref_issue: "SETORAN_TIDAK_DITEBAK", conflict_dates: ["04-10-2026"], created_at: "2026-10-05" },
    { gadai_klaim_id: "TFK-2-n", match_status: "all_taken", ref_issue: "REBUTAN_SETORAN", conflict_dates: ["04-10-2026"], created_at: "2026-10-05" },
  ];
  const q: any = { select: () => q, eq: () => q, in: () => q, is: () => q, order: async () => ({ data: baris, error: null }) };
  const db = { from: () => q };
  const items: any[] = [
    { klaim_id: "TFK-1-s", status: "PENDING", tgl: "2026-10-04", sebab: "lama" },
    { klaim_id: "TFK-2-n", status: "PENDING", tgl: "2026-10-04", sebab: "lama" },
  ];
  await tandaiTolakLintasHari(db, "akun", items);
  harap("4. setoran DITAHAN → sebab setoran, BUKAN tolakLintasHari", items[0].setoran === true && !items[0].tolakLintasHari &&
        /setoran outlet → rek PT tidak ditebak/.test(items[0].sebab), items[0].sebab);
  harap("4. nasabah rebutan setoran → sebab menyebut setoran", !items[1].tolakLintasHari && /diakui SETORAN OUTLET/.test(items[1].sebab), items[1].sebab);
}

// ═══════════════════════ 5. DATA HIDUP (baca-saja) ═══════════════════════
if (process.argv.includes("--hidup")) {
  console.log("── 5. sampel kredit NYATA (baca-saja) ──");
  for (const b of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = b.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const ambil = async (q: (from: number) => any) => {
    const out: any[] = [];
    for (let a = 0; ; a += 1000) {
      const { data, error } = await q(a);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    return out;
  };
  // Sampel: setoran teller (SETR/Setoran/SETOR), agen LKP CASH, kredit bulat ≥ 5 jt.
  const sampel = (await ambil((a) => db.from("parsed_transactions")
    .select("id, bank_id, tanggal, jam, nominal_kredit, no_ref, nama_pengirim, deskripsi, claimed_by_input_id")
    .is("deleted_at", null).gte("tanggal", "2026-07-01").gt("nominal_kredit", 0)
    .or("deskripsi.ilike.%setr%,deskripsi.ilike.%setor%,deskripsi.ilike.LKP%CASH%,and(nominal_kredit.gte.5000000)")
    .order("id").range(a, a + 999)))
    .filter((r: any) => /setr|setor|LKP.*CASH/i.test(String(r.deskripsi ?? "")) || (Number(r.nominal_kredit) >= 5_000_000 && Number(r.nominal_kredit) % 100_000 === 0));
  const noms = [...new Set(sampel.map((r: any) => Number(r.nominal_kredit)))];
  // Kolam = SEMUA kredit bernominal sampel (bukan hanya sampel), supaya
  // kembaran kecil (agen LKP 61.000) dari nasabah ikut terhitung.
  const kolamRaw: any[] = [];
  for (let a = 0; a < noms.length; a += 100) {
    kolamRaw.push(...await ambil((x) => db.from("parsed_transactions")
      .select("id, bank_id, tanggal, jam, nominal_kredit, no_ref, nama_pengirim, deskripsi, claimed_by_input_id")
      .is("deleted_at", null).gte("tanggal", "2026-06-25").in("nominal_kredit", noms.slice(a, a + 100))
      .order("id").range(x, x + 999)));
  }
  const keTx = (r: any, i: number): PdfTransaction => ({
    no: i + 1, tanggal: String(r.tanggal).slice(0, 10).split("-").reverse().join("-"),
    tanggalDate: new Date(`${String(r.tanggal).slice(0, 10)}T12:00:00Z`), waktu: String(r.jam ?? ""),
    namaPengirim: r.nama_pengirim ?? "", deskripsi: r.deskripsi ?? "", kredit: Number(r.nominal_kredit),
    bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 }, page: 1, noRef: r.no_ref ?? null, bankId: r.bank_id,
    parsedTxId: r.id, claimedByOther: !!r.claimed_by_input_id,
  } as any);
  const kolam = () => tandaiAwal(kolamRaw.map(keTx));
  const dalam = (iso: string, t: PdfTransaction) => {
    const d = Math.round((Date.parse(`${iso}T12:00:00Z`) - t.tanggalDate.getTime()) / 86_400_000);
    return d === 0 || d === -1;   // jendela setoran [tgl slip, +1]
  };
  const menit = (j: string) => { const m = String(j).replace(".", ":").match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  let nKembar = 0, nDipegang = 0, nCocokNominal = 0, nSalahNominal = 0, nJam = 0, nSalahJam = 0, nRef = 0, nSalahRef = 0, nAmbilDipegang = 0;
  const contohKembar: string[] = [];
  for (const r of sampel) {
    const iso = String(r.tanggal).slice(0, 10);
    const nom = Number(r.nominal_kredit);
    const pool = kolam();
    const sama = pool.filter((t) => t.kredit === nom && dalam(iso, t));
    const sasaran = pool.find((t) => t.parsedTxId === r.id)!;
    const harapTunggal = sama.length === 1 && !sasaran.claimedByOther;
    if (sama.length > 1) { nKembar++; if (contohKembar.length < 6) contohKembar.push(`${iso} Rp ${nom.toLocaleString("id-ID")} ×${sama.length}`); }
    if (sasaran.claimedByOther) nDipegang++;
    // (i) NOMINAL saja.
    const h1 = jalan([stp("TFK-1-HID", iso, nom, { bankId: r.bank_id })], pool).inputs[0].match as any;
    const cocok1 = h1?.status === "matched" ? pool.find((t) => t.no === h1.txNo) : null;
    if (cocok1) nCocokNominal++;
    if (cocok1 && (!harapTunggal || cocok1.parsedTxId !== r.id)) nSalahNominal++;
    if (!cocok1 && harapTunggal) nSalahNominal++;
    if (cocok1 && cocok1.claimedByOther) nAmbilDipegang++;
    // (ii) NOMINAL + JAM slip = jam baris.
    const pool2 = kolam();
    const h2 = jalan([stp("TFK-1-HID", iso, nom, { bankId: r.bank_id, jamResi: String(r.jam ?? "").replace(".", ":") })], pool2).inputs[0].match as any;
    const cocok2 = h2?.status === "matched" ? pool2.find((t) => t.no === h2.txNo) : null;
    if (cocok2) nJam++;
    const sejam = pool2.filter((t) => t.kredit === nom && t.tanggalDate.getTime() === sasaran.tanggalDate.getTime() &&
      menit(t.waktu) !== null && menit(r.jam) !== null && Math.abs(menit(t.waktu)! - menit(r.jam)!) <= 5);
    if (cocok2 && cocok2.parsedTxId !== r.id) nSalahJam++;
    if (cocok2 && cocok2.claimedByOther) nAmbilDipegang++;
    if (!cocok2 && !sasaran.claimedByOther && (sejam.length === 1 || harapTunggal)) nSalahJam++;
    // (iii) REF = token FT baris.
    const ft = String(r.no_ref ?? "").match(/FT\d{5}[A-Z0-9]{4,}/i)?.[0];
    if (ft) {
      const pool3 = kolam();
      const h3 = jalan([stp("TFK-1-HID", iso, nom, { bankId: r.bank_id, refFt: ft })], pool3).inputs[0].match as any;
      const cocok3 = h3?.status === "matched" ? pool3.find((t) => t.no === h3.txNo) : null;
      if (cocok3) nRef++;
      if (cocok3 ? (cocok3.parsedTxId !== r.id || cocok3.claimedByOther) : !sasaran.claimedByOther) nSalahRef++;
      if (sasaran.claimedByOther && !(h3?.status === "all_taken" && h3?.refIssue === "REF_SUDAH_DIKLAIM")) nSalahRef++;
    }
  }
  console.log(`   sampel ${sampel.length} kredit (kolam ${kolamRaw.length} baris bernominal sama) · kembar dalam jendela ${nKembar} · sudah dipegang ${nDipegang}`);
  if (contohKembar.length) console.log(`   contoh kembar: ${contohKembar.join(" · ")}`);
  harap(`5. NOMINAL saja: cocok ${nCocokNominal} — HANYA kredit tunggal yang bebas, tepat barisnya`, nSalahNominal === 0, `${nSalahNominal} salah`);
  harap(`5. NOMINAL+JAM: cocok ${nJam} — selalu baris yang benar`, nSalahJam === 0, `${nSalahJam} salah`);
  harap(`5. REF: cocok ${nRef} — baris yang benar; yang sudah dipegang → REF_SUDAH_DIKLAIM`, nSalahRef === 0, `${nSalahRef} salah`);
  harap("5. tidak pernah mengambil baris yang sudah dipegang", nAmbilDipegang === 0, `${nAmbilDipegang}`);
  harap("5. sampel memuat kredit kembar (uji bermakna)", nKembar > 0, `${nKembar}`);
  // Semua setoran tiruan sekaligus dalam SATU jalan — anti double claim global.
  const poolG = kolam();
  const insG = sampel.map((r: any, i: number) => stp(`TFK-1-G${i}`, String(r.tanggal).slice(0, 10), Number(r.nominal_kredit), { bankId: r.bank_id }));
  const hG = jalan(insG, poolG);
  const salahG = tanpaKlaimGanda(hG.inputs, poolG, hG.summary.disepak);
  harap(`5. ${insG.length} setoran tiruan dalam SATU jalan → tidak ada baris dipegang dua klaim`, salahG === null, salahG ?? "");
}

console.log(`\n===== ${lulus} lulus, ${gagal} gagal =====`);
process.exit(gagal ? 1 : 0);
