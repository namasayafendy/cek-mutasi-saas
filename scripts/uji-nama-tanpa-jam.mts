// Uji PASS 3b "nama persis tanpa jam" + penanda "tidak ditebak, baris bebas".
//
// Kasus asal: SJB-3-0211 (BIREUEN) Rp 50.000, 27 September 2026 — resi DANA
// tanpa jam a.n. Neneng Juairiah bertanggal 26 Sep; uangnya masuk 25 Sep
// 22.31 a.n. NENENG JUAIRIAH. Empat resi Rp 50.000 bertanggal 26 Sep, tiga
// baris 26 Sep diambil yang lain. Pencocokan nominal menolak menebak ke 25 Sep
// dan layar menyebutnya "sudah ke-claim input lain" — padahal barisnya bebas.
//
//   npx tsx scripts/uji-nama-tanpa-jam.mts
import { runMatching, namaResiKetat, namaMutasiKetat, namaSamaKetat } from "../lib/matching.ts";
import type { PdfTransaction, UserInput } from "../lib/types.ts";

const ATURAN = { lookback_days: 3, forward_window_days: 1, match_mode: "exact" as const, tolerance_rp: 0, tolerance_pct: 0 };

let no = 0;
const tx = (iso: string, jam: string, kredit: number, nama: string, o: Partial<PdfTransaction> = {}): PdfTransaction => ({
  no: ++no, tanggal: iso.split("-").reverse().join("/"),
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
const jalan = (inputs: UserInput[], txs: PdfTransaction[], luar: any[] = []) =>
  runMatching(inputs, txs, new Map(), { getRulesForInput: () => ATURAN, nama: { terpegangLuar: luar } }).inputs;
const hasil = (out: UserInput[], id: string) => out.find((x) => x.id === id)!.match as any;
const tglOf = (m: any) => m?.txDate?.toISOString?.().slice(0, 10);

// ── 0. Penormal nama ──
console.log("── penormal nama ──");
harap("resi 'Neneng Juairiah' layak", namaResiKetat("Neneng Juairiah") === "NENENG JUAIRIAH");
harap("resi 'M. Fauzan Islami' layak", namaResiKetat("M. Fauzan Islami") === "M FAUZAN ISLAMI");
harap("resi 'GoPay' ditolak", namaResiKetat("GoPay") === null);
harap("resi 'dara ******' ditolak", namaResiKetat("dara ******") === null);
harap("resi '0812****5803' ditolak", namaResiKetat("0812****5803") === null);
harap("resi '(tidak terbaca)' ditolak", namaResiKetat("(tidak terbaca)") === null);
harap("resi satu kata 'MUSYAWIR' ditolak", namaResiKetat("MUSYAWIR") === null);
harap("resi 'M DARMAWAN' ditolak (satu kata sungguhan)", namaResiKetat("M DARMAWAN") === null);
harap("mutasi ' Bank Seabank' dibuang", namaMutasiKetat("SUCI ULFA Bank Seabank") === "SUCI ULFA");
harap("mutasi ' Dana' dibuang", namaMutasiKetat("RIZKI MAULANA Dana") === "RIZKI MAULANA");
harap("mutasi 'PRADANA' utuh", namaMutasiKetat("AGUS PRADANA") === "AGUS PRADANA");
harap("mutasi awalan 'DANA-' dibuang", namaMutasiKetat("DANA-NURUL IZZAH") === "NURUL IZZAH");
harap("mutasi token FT dibuang", namaMutasiKetat("RAJA ARDIANSYAH FT26217X7CN6") === "RAJA ARDIANSYAH");
harap("mutasi 'DOMPET ANAK BANGSA' = umum", namaMutasiKetat("DOMPET ANAK BANGSA") === null);
harap("terpotong di batas kata (≥10)", namaSamaKetat("REYHAN DWI FACHRI", "REYHAN DWI FACHRI AL HADIS"));
harap("terpotong di tengah kata ditolak", !namaSamaKetat("REYHAN DWI FACH", "REYHAN DWI FACHRI"));
harap("awalan terlalu pendek ditolak", !namaSamaKetat("NURUL IZZ", "NURUL IZZAH"));

// ── 1. KEJADIAN ASLI ──
console.log("\n── 1. SJB-3-0211: empat resi 50rb tgl 26, baris Neneng tgl 25 bebas ──");
{
  no = 0;
  const txs = [
    tx("2026-09-25", "22.31", 50_000, "NENENG JUAIRIAH"),
    tx("2026-09-26", "11.12", 50_000, "FACHRURRAZI", { noRef: "FT26269XPZY2\\D68/213" } as any),
    tx("2026-09-26", "11.20", 50_000, "AL HAFIZ"),
    tx("2026-09-26", "21.11", 50_000, "MUHAMMAD"),
  ];
  const ins = [
    inp("OS85M0", "2026-09-26", 50_000, { refFt: "FT26269XPZY2", jamResi: "11:12", namaPengirimResi: "Fachrurrazi" }),
    inp("2SNQE1", "2026-09-26", 50_000, { jamResi: "11:20", namaPengirimResi: "0812****5803" }),
    inp("P20WA0", "2026-09-26", 50_000),
    inp("N69940", "2026-09-26", 50_000, { namaPengirimResi: "Neneng Juairiah" }),
  ];
  const out = jalan(ins, txs);
  const m = hasil(out, "N69940");
  harap("N69940 cocok lewat NAMA ke 25 Sep", m?.status === "matched" && m.matchedBy === "NAMA" && tglOf(m) === "2026-09-25",
        `${m?.status} ${m?.matchedBy ?? ""} ${tglOf(m) ?? ""}`);
  const p = hasil(out, "P20WA0");
  harap("P20WA0 tetap cocok hari sendiri (MUHAMMAD 21.11)", p?.status === "matched" && tglOf(p) === "2026-09-26", `${p?.status} ${p?.matchedBy}`);
  harap("OS85M0 tetap REF", hasil(out, "OS85M0")?.matchedBy === "REF");
  harap("2SNQE1 tetap NOMINAL_JAM", hasil(out, "2SNQE1")?.matchedBy === "NOMINAL_JAM");
}

// ── 2. Tanpa nama: penolakan tetap, tapi berlabel "baris bebas" ──
console.log("\n── 2. sama, tapi resi Neneng tanpa nama ──");
{
  no = 0;
  const txs = [
    tx("2026-09-25", "22.31", 50_000, "NENENG JUAIRIAH"),
    tx("2026-09-26", "11.20", 50_000, "AL HAFIZ"),
    tx("2026-09-26", "21.11", 50_000, "MUHAMMAD"),
  ];
  const ins = [
    inp("A", "2026-09-26", 50_000, { jamResi: "11:20" }),
    inp("B", "2026-09-26", 50_000),
    inp("C", "2026-09-26", 50_000),
  ];
  const out = jalan(ins, txs);
  const tolak = out.map((x) => x.match as any).filter((mm) => mm?.status === "all_taken");
  harap("satu ditolak menebak ke 25 Sep", tolak.length === 1 && tolak[0].conflictDates.join() === "25/09/2026".replace(/\//g, "/"),
        JSON.stringify(tolak.map((t) => t.conflictDates)));
  harap("penolakan itu ditandai barisBebas", tolak.length === 1 && tolak[0].barisBebas === true);
  harap("penolakan tidak membawa refIssue (tak jadi alarm di gadai)", tolak.length === 1 && !tolak[0].refIssue);
}

// ── 3. Pembayaran ganda nama sama: DIAM ──
console.log("\n── 3. dua baris bernama sama di jendela (SUCI ULFA) ──");
{
  no = 0;
  const out = jalan(
    [inp("X", "2026-09-10", 123_000, { namaPengirimResi: "Suci Ulfa" })],
    [tx("2026-09-10", "09.00", 123_000, "SUCI ULFA"), tx("2026-09-11", "10.00", 123_000, "SUCI ULFA Bank Seabank")]);
  harap("tidak lewat NAMA", hasil(out, "X")?.matchedBy !== "NAMA", `${hasil(out, "X")?.status} ${hasil(out, "X")?.matchedBy}`);
}

// ── 4. Baris bernama sama sudah dipegang: DIAM ──
console.log("\n── 4. satu-satunya baris bernama sama sudah dipegang klaim lain ──");
{
  no = 0;
  const out = jalan(
    [inp("Y", "2026-09-10", 75_000, { namaPengirimResi: "Nurul Izzah" })],
    [tx("2026-09-09", "20.00", 75_000, "NURUL IZZAH", { claimedByOther: true } as any),
     tx("2026-09-10", "08.00", 75_000, "ORANG LAIN")]);
  harap("tidak lewat NAMA", hasil(out, "Y")?.matchedBy !== "NAMA", `${hasil(out, "Y")?.status} ${hasil(out, "Y")?.matchedBy}`);
}

// ── 5. Dua klaim bernama sama di jalan yang sama: DIAM ──
console.log("\n── 5. dua resi a.n. sama, nominal sama ──");
{
  no = 0;
  const out = jalan(
    [inp("K1", "2026-09-10", 90_000, { namaPengirimResi: "Rizki Maulana" }),
     inp("K2", "2026-09-11", 90_000, { namaPengirimResi: "RIZKI MAULANA" })],
    [tx("2026-09-09", "21.00", 90_000, "RIZKI MAULANA")]);
  harap("K1 tidak lewat NAMA", hasil(out, "K1")?.matchedBy !== "NAMA");
  harap("K2 tidak lewat NAMA", hasil(out, "K2")?.matchedBy !== "NAMA");
}

// ── 6. Nama umum / tersamar / satu kata: DIAM ──
console.log("\n── 6. nama tidak layak ──");
for (const [nm, row] of [["GoPay", "DOMPET ANAK BANGSA"], ["dara ******", "DARA AYU"], ["Musyawir", "MUSYAWIR"]] as const) {
  no = 0;
  const out = jalan([inp("Z", "2026-09-10", 60_000, { namaPengirimResi: nm })],
                    [tx("2026-09-09", "22.00", 60_000, row)]);
  harap(`'${nm}' tidak lewat NAMA`, hasil(out, "Z")?.matchedBy !== "NAMA", `${hasil(out, "Z")?.status} ${hasil(out, "Z")?.matchedBy ?? ""}`);
}

// ── 7. Lewat jendela ±1 hari: DIAM ──
console.log("\n── 7. baris bernama sama 2 hari sebelumnya ──");
{
  no = 0;
  const out = jalan([inp("W", "2026-09-10", 40_000, { namaPengirimResi: "Cut Nella Wita" })],
                    [tx("2026-09-08", "22.00", 40_000, "CUT NELLA WITA")]);
  harap("tidak lewat NAMA", hasil(out, "W")?.matchedBy !== "NAMA", `${hasil(out, "W")?.status} ${hasil(out, "W")?.matchedBy ?? ""}`);
}

// ── 8. Resi ada jamnya: bukan urusan pass ini ──
console.log("\n── 8. resi bernama DAN berjam → tetap PASS 2 ──");
{
  no = 0;
  const out = jalan([inp("J", "2026-09-10", 40_000, { namaPengirimResi: "Milsa Salsabila", jamResi: "22:37" })],
                    [tx("2026-09-10", "22.37", 40_000, "MILSA SALSABILA")]);
  harap("lewat NAMA_JAM", hasil(out, "J")?.matchedBy === "NAMA_JAM", hasil(out, "J")?.matchedBy);
}

// ── 9. Klaim ber-REF mengusir pemegang NAMA ──
console.log("\n── 9. REF mengusir pemegang NAMA (lemah) ──");
{
  no = 0;
  const baris = tx("2026-09-10", "15.09", 70_000, "WAHYUDI PRAKARSA", {
    noRef: "FT262438R70Q/213", claimedByOther: true,
    pemegang: { inputId: "inp-lama", matchedBy: "NAMA", manual: false, gadaiKlaimId: "LAMA" },
  } as any);
  const out = runMatching(
    [inp("BARU", "2026-09-10", 70_000, { refFt: "FT262438R70Q" }),
     inp("LAMA", "2026-09-10", 70_000, { namaPengirimResi: "Wahyudi Prakarsa", sudahMemegang: true } as any)],
    [baris], new Map(), { getRulesForInput: () => ATURAN, nama: { terpegangLuar: [] } });
  const m = out.inputs.find((x) => x.id === "BARU")!.match as any;
  harap("klaim ber-REF mengambil barisnya", m?.status === "matched" && m.matchedBy === "REF", `${m?.status} ${m?.matchedBy ?? ""}`);
  harap("pengusiran tercatat", (out.summary.disepak ?? []).some((d) => d.pemegangKlaimId === "LAMA"));
}

// ── 10. Baris bernama sama TERPEGANG di luar kolam (carry-over hanya memuat yang bebas) ──
console.log("\n── 10. baris bernama sama sudah dipegang, di LUAR kolam ──");
{
  no = 0;
  const luar = [{ tanggalDate: new Date("2026-09-09T12:00:00Z"), kredit: 80_000, namaPengirim: "IKWANSYAH TANJUNG", bankId: "bank-1" }];
  const out = jalan([inp("L", "2026-09-10", 80_000, { namaPengirimResi: "Ikwansyah Tanjung" })],
                    [tx("2026-09-10", "19.00", 80_000, "IKWANSYAH TANJUNG")], luar);
  harap("tidak lewat NAMA", hasil(out, "L")?.matchedBy !== "NAMA", `${hasil(out, "L")?.status} ${hasil(out, "L")?.matchedBy ?? ""}`);
  const out2 = jalan([inp("L", "2026-09-10", 80_000, { namaPengirimResi: "Ikwansyah Tanjung" })],
                     [tx("2026-09-10", "19.00", 80_000, "IKWANSYAH TANJUNG")], []);
  harap("tanpa baris luar → lewat NAMA", hasil(out2, "L")?.matchedBy === "NAMA");
}

// ── 11. Pemanggil tanpa opsi `nama` (layar /check lama): PASS 3b mati ──
console.log("\n── 11. tanpa opsi nama ──");
{
  no = 0;
  const out = runMatching([inp("Q", "2026-09-10", 55_000, { namaPengirimResi: "Neneng Juairiah" })],
                          [tx("2026-09-09", "22.31", 55_000, "NENENG JUAIRIAH")], new Map(),
                          { getRulesForInput: () => ATURAN }).inputs;
  harap("tidak lewat NAMA", hasil(out, "Q")?.matchedBy !== "NAMA", `${hasil(out, "Q")?.status} ${hasil(out, "Q")?.matchedBy ?? ""}`);
}

// ── 12. Pola resi kembar (SJB-1-0186): hari sendiri dipegang → diberi tanda ──
console.log("\n── 12. resi kembar: baris hari resi sudah dipegang ──");
{
  no = 0;
  const out = jalan([inp("KEMBAR", "2026-08-10", 460_000)],
                    [tx("2026-08-10", "16.02", 460_000, "SIAPA", { claimedByOther: true } as any),
                     tx("2026-08-11", "17.39", 460_000, "NASABAH LAIN")]);
  const m = hasil(out, "KEMBAR");
  harap("tetap ditolak", m?.status === "all_taken", m?.status);
  harap("hariSendiriDipegang = true", m?.hariSendiriDipegang === true);
}

// ── 13. "Bebas" basi: input belakangan mengambil barisnya ──
console.log("\n── 13. baris bebas diambil input yang diproses belakangan ──");
{
  no = 0;
  const out = jalan(
    [inp("A1", "2026-09-26", 100_000), inp("A2", "2026-09-26", 100_000), inp("B", "2026-09-27", 100_000)],
    [tx("2026-09-25", "20.00", 100_000, "X"), tx("2026-09-26", "10.00", 100_000, "Y")]);
  const tolak = ["A1", "A2"].map((id) => hasil(out, id)).find((m) => m?.status === "all_taken");
  const b = hasil(out, "B");
  const barisXDiambilB = b?.status === "matched" && tglOf(b) === "2026-09-25";
  harap("kalau B mengambil baris 25, penolakan A tidak lagi berkata 'bebas'",
        !barisXDiambilB || (tolak && !tolak.barisBebas),
        `B=${b?.status} ${tglOf(b) ?? ""}; A tolak barisBebas=${tolak?.barisBebas}`);
}

console.log(gagal ? `\n❌ ${gagal} harapan meleset` : "\n✅ SEMUA SESUAI");
process.exit(gagal ? 1 : 0);
