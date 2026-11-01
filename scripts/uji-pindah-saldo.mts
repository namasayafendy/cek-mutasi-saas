// Uji JEMBATAN PINDAH SALDO (1 November 2026) — lib/pipeline/pindahSaldo.ts.
//
// Pindah saldo resmi 1994 → 1919 (menu Pindah Saldo gadai, sesi PINDAH
// SELESAI) tidak boleh lagi tampil "UANG DI MUTASI TANPA PEMILIK" (debet 1994
// 🔴 UANG KELUAR TANPA ALASAN, kredit 1919 uang masuk tanpa pemilik) — dan
// TIDAK BOLEH ada baris bukan-PINDAH yang ikut dibungkam.
//
//   1. bacaKirimanPindah: medan tidak ada = null; sesi rusak dibuang.
//   2. kakiPindahBerkas: debet hanya di MASUK bernomor asal, kredit hanya di
//      KELUAR bernomor tujuan, nomor kepala PDF terbukti, aturan aktif.
//   3. waktuBaris / jendelaPindah (jendela di JAM BANK, dibuat/selesai hanya
//      pagar luar — tinjauan 2 Nov temuan 1).
//   4. pasangkanPindah: tunggal → pasang; ragu, baris dua sesi, dipegang
//      klaim, di luar bacaan, tanpa jam, jendela janggal; uji serang S1
//      (debet 5 jam sebelum kredit), kaki debet wajib debit_at + keterangan
//      "TRF Ke - PT ACEH GADAI SYARIAH" (temuan 2), catatan disebut sekali
//      (temuan 4, uji serang S3).
//   5. bacaBarisNganggur (DB tiruan, kueri sungguhan): tanpa opsi = SAMA
//      PERSIS; kaki dipisah; keunikan dihitung dari SEMUA baris DB; galat
//      kueri calon = catatan, bukan lemparan; PDF sebagian hari + pindah asli
//      datang belakangan.
//   6. Laporan: bahanNganggur → susunLapis2Lengkap → idStempelNganggur →
//      pecahPesanLapis2. Tanpa jembatan teks sama persis; dengan jembatan
//      baris 🔁 bukan 🔴, cacah 🚨 tidak memuatnya, yang distempel = yang
//      dirinci.
//   7. Kabel: auto-runner menyalin medan, jalankanPass memberi hak stempel di
//      dua jalan keluar yang sama dengan idNganggur.
//   8. (--kontrak=<berkas>) jawaban contoh dari uji gadai
//      scripts/uji-pindah-lapis2.mts --tulis-kontrak=<berkas> terbaca utuh.
//
//   npx tsx scripts/uji-pindah-saldo.mts [--kontrak=<berkas.json>]
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TG_MUTASI_BOT_TOKEN"]) delete process.env[k];

import { readFileSync, existsSync } from "node:fs";
import {
  bacaKirimanPindah, kakiPindahBerkas, jendelaPindah, waktuBaris, tanggalWib, pasangkanPindah,
  sesiDalamRentang, rutePindah, rentangTanggalPindah, keteranganKePt, SELA_PINDAH_MS, SELISIH_MAKS_DEBIT_KREDIT_MS,
  type SesiPindah, type CalonPindah, type KirimanPindah, type KakiPindah,
} from "../lib/pipeline/pindahSaldo.ts";
import { susunAturanRekening } from "../lib/pipeline/rekeningKlaim.ts";
import { bacaBarisNganggur } from "../lib/pipeline/nganggur.ts";
import { bahanNganggur, idStempelNganggur, type PassNganggur } from "../lib/laporan/nganggur.ts";
import { susunLapis2Lengkap, pecahPesanLapis2, SAMBUNGAN_KELUAR_LAPIS2, type IsiLapis2 } from "../lib/laporan/lapis2.ts";

let lulus = 0, gagal = 0;
const harap = (label: string, ok: boolean, rinci = "") => {
  if (ok) lulus++; else gagal++;
  console.log(`${ok ? "✅" : "❌"} ${label}${!ok && rinci ? "  — " + rinci : ""}`);
};

const MASUK = { id: "bank-1994", peran: "MASUK" as const, nomor_rekening: "1999881994", is_active: true };
const KELUAR = { id: "bank-1919", peran: "KELUAR" as const, nomor_rekening: "1999881919", mulai_tgl: "2026-11-01", is_active: true };
const ATURAN = susunAturanRekening([MASUK, KELUAR]);
const MATI = susunAturanRekening([{ id: "b1" }]);

// Sesi contoh: dibuat 14.00 WIB, debit & kredit 14.08, selesai 14.09.30 (2 Nov 2026).
const W = (hhmm: string, tgl = "2026-11-02") => Date.parse(`${tgl}T${hhmm}:00+07:00`);
const SESI_MENTAH = {
  id: "12", nominal: 5_000_000, dibuat_at: "2026-11-02T07:00:00.000Z", debit_at: "2026-11-02T07:08:00.000Z",
  kredit_at: "2026-11-02T07:08:00.000Z", selesai_at: "2026-11-02T07:09:30.000Z",
};
const KIRIMAN_MENTAH = { versi: 1, rek_asal: "1999881994", rek_tujuan: "1999881919", sesi: [SESI_MENTAH] };

// ═════════════ 1. bacaKirimanPindah ═════════════
console.log("\n1. bacaKirimanPindah");
{
  harap("1a. medan tidak ada → null", bacaKirimanPindah(undefined) === null && bacaKirimanPindah(null) === null);
  harap("1b. bukan objek → null", bacaKirimanPindah("x") === null && bacaKirimanPindah([1]) === null && bacaKirimanPindah(5) === null);
  const k = bacaKirimanPindah(KIRIMAN_MENTAH)!;
  harap("1c. sah → 1 sesi, waktu epoch", k.sesi.length === 1 && k.sesi[0].id === "12" && k.sesi[0].nominal === 5_000_000
        && k.sesi[0].debitMs === W("14:08") && k.sesi[0].kreditMs === W("14:08") && k.galat === null && k.ditolak === 0);
  harap("1d. rekening digit-saja", k.rekAsal === "1999881994" && k.rekTujuan === "1999881919");
  const rusak = bacaKirimanPindah({ ...KIRIMAN_MENTAH, sesi: [
    SESI_MENTAH,
    { ...SESI_MENTAH },                                 // id ganda
    { ...SESI_MENTAH, id: "13", nominal: 1.5 },          // pecahan
    { ...SESI_MENTAH, id: "14", nominal: -1 },           // negatif
    { ...SESI_MENTAH, id: "15", kredit_at: "bukan" },    // waktu rusak
    { ...SESI_MENTAH, id: "16", debit_at: "bukan" },     // debit rusak (bukan null)
    { ...SESI_MENTAH, id: "x17" },                       // id bukan angka
    { ...SESI_MENTAH, id: "18", debit_at: null },        // sah
  ] })!;
  harap("1e. sesi rusak dibuang & dihitung", rusak.sesi.map((s) => s.id).join(",") === "12,18" && rusak.ditolak === 6, JSON.stringify(rusak));
  const sama = bacaKirimanPindah({ ...KIRIMAN_MENTAH, rek_tujuan: "1999881994" })!;
  harap("1f. asal = tujuan → tanpa sesi + galat", sama.sesi.length === 0 && !!sama.galat);
  const g = bacaKirimanPindah({ ...KIRIMAN_MENTAH, sesi: [], galat: "sesi pindah saldo tak terbaca\nbaris palsu", dilewati: 2 })!;
  harap("1g. galat & dilewati diteruskan (baris baru dijinakkan)", g.galat === "sesi pindah saldo tak terbaca baris palsu" && g.dilewati === 2);
  harap("1h. rute 4 digit", rutePindah(k) === "1994 → 1919");
}

// ═════════════ 2. kakiPindahBerkas ═════════════
console.log("\n2. kakiPindahBerkas");
{
  const k = bacaKirimanPindah(KIRIMAN_MENTAH)!;
  const kaki = (o: Partial<Parameters<typeof kakiPindahBerkas>[0]>) =>
    kakiPindahBerkas({ kiriman: k, aturan: ATURAN, bankId: MASUK.id, jenis: "debet", rekeningTerbukti: true, ...o });
  harap("2a. debet di MASUK 1994 → DEBET_ASAL", kaki({}) === "DEBET_ASAL");
  harap("2b. kredit di KELUAR 1919 → KREDIT_TUJUAN", kaki({ bankId: KELUAR.id, jenis: "kredit" }) === "KREDIT_TUJUAN");
  harap("2c. kredit di MASUK → null", kaki({ jenis: "kredit" }) === null);
  harap("2d. debet di KELUAR → null", kaki({ bankId: KELUAR.id }) === null);
  harap("2e. nomor kepala PDF tidak terbukti → null", kaki({ rekeningTerbukti: false }) === null);
  harap("2f. aturan rekening mati (satu rekening) → null", kaki({ aturan: MATI }) === null);
  harap("2g. gadai tidak mengirim → null", kaki({ kiriman: null }) === null && kaki({ kiriman: undefined }) === null);
  const terbalik = bacaKirimanPindah({ ...KIRIMAN_MENTAH, rek_asal: "1999881919", rek_tujuan: "1999881994" })!;
  harap("2h. asal/tujuan terbalik dari peran → null kedua kaki",
        kaki({ kiriman: terbalik }) === null && kaki({ kiriman: terbalik, bankId: KELUAR.id, jenis: "kredit" }) === null);
  const lain = bacaKirimanPindah({ ...KIRIMAN_MENTAH, rek_asal: "1234567890" })!;
  harap("2i. rekening asal tak terdaftar → null", kaki({ kiriman: lain }) === null);
}

// ═════════════ 3. waktu & jendela ═════════════
console.log("\n3. waktuBaris / jendelaPindah");
{
  harap("3a. HH.MM WIB", waktuBaris("2026-11-02", "14.08") === W("14:08"));
  harap("3b. H.MM", waktuBaris("2026-11-02", "9.05") === W("09:05"));
  harap("3c. HH:MM:SS → menit", waktuBaris("2026-11-02", "14:08:59") === W("14:08"));
  harap("3d. jam kosong / rusak → null", waktuBaris("2026-11-02", "") === null && waktuBaris("2026-11-02", "25.00") === null
        && waktuBaris("2026-11-02", null) === null && waktuBaris("02/11/2026", "14.08") === null);
  const s = bacaKirimanPindah(KIRIMAN_MENTAH)!.sesi[0];
  const j = jendelaPindah(s)!;
  harap("3e. jendela = jam bank [min(debit,kredit) − 10 mnt, max + 10 mnt] (13.58–14.18), bukan dibuat/selesai",
        j.awal === W("14:08") - SELA_PINDAH_MS && j.akhir === W("14:08") + SELA_PINDAH_MS && j.awal === W("13:58") && j.akhir === W("14:18"), JSON.stringify(j));
  // Uji serang S1 (tinjauan 2 Nov): sesi dibuat 10.00, kredit 15.30 → dulu jendela 351 menit.
  const s1: SesiPindah = { ...s, dibuatMs: W("10:00"), debitMs: W("15:30"), kreditMs: W("15:30"), selesaiMs: W("15:31") };
  const j1 = jendelaPindah(s1)!;
  harap("3f. S1: dibuat 10.00, kredit 15.30 → jendela 15.20–15.40 (20 mnt, bukan 351)", j1.awal === W("15:20") && j1.akhir === W("15:40"), JSON.stringify(j1));
  const s1sapu: SesiPindah = { ...s1, debitMs: null, selesaiMs: W("18:30") };
  const j1s = jendelaPindah(s1sapu)!;
  harap("3f1. selesai_at = jam sapu (3 jam sesudah kredit) TIDAK memperlebar: kredit ± 10 mnt", j1s.awal === W("15:20") && j1s.akhir === W("15:40"), JSON.stringify(j1s));
  harap("3f2. selisih debit–kredit > 30 mnt → janggal (null); tepat 30 mnt → masih wajar",
        jendelaPindah({ ...s, debitMs: W("14:08"), kreditMs: W("14:39"), selesaiMs: W("14:40") }) === null
        && jendelaPindah({ ...s, debitMs: W("14:08"), kreditMs: W("14:38"), selesaiMs: W("14:40") }) !== null
        && SELISIH_MAKS_DEBIT_KREDIT_MS === 30 * 60_000);
  harap("3f3. kredit sebelum dibuat − 10 mnt / sesudah selesai + 10 mnt → janggal",
        jendelaPindah({ ...s, debitMs: null, kreditMs: W("13:49") }) === null
        && jendelaPindah({ ...s, debitMs: null, kreditMs: W("14:20"), selesaiMs: W("14:09") }) === null);
  const telatSms: SesiPindah = { ...s, debitMs: W("14:20"), kreditMs: W("14:08"), selesaiMs: W("14:09") };
  const jt = jendelaPindah(telatSms)!;
  harap("3f4. pagar luar memotong: debit SMS sesudah sesi ditutup → akhir = selesai + 10 mnt", jt.awal === W("13:58") && jt.akhir === W("14:19"), JSON.stringify(jt));
  const tanpaDebit: SesiPindah = { ...s, debitMs: null };
  const jd = jendelaPindah(tanpaDebit)!;
  harap("3f5. debit_at null → kredit ± 10 mnt", jd.awal === W("13:58") && jd.akhir === W("14:18"));
  const lintas: SesiPindah = { ...s, dibuatMs: W("23:55", "2026-11-02"), debitMs: W("00:02", "2026-11-03"), kreditMs: W("00:02", "2026-11-03"), selesaiMs: W("00:03", "2026-11-03") };
  const jl = jendelaPindah(lintas)!;
  harap("3g. lintas tengah malam WIB", tanggalWib(jl.awal) === "2026-11-02" && tanggalWib(jl.akhir) === "2026-11-03");
  harap("3h. sesiDalamRentang", sesiDalamRentang([s], "2026-11-02", "2026-11-02").length === 1
        && sesiDalamRentang([s], "2026-11-03", "2026-11-05").length === 0 && sesiDalamRentang([lintas], "2026-11-03", "2026-11-03").length === 1);
  const janggalLintas: SesiPindah = { ...s, dibuatMs: W("23:00", "2026-11-01"), debitMs: W("23:10", "2026-11-01"), kreditMs: W("00:30", "2026-11-02"), selesaiMs: W("00:31", "2026-11-02") };
  const rj = rentangTanggalPindah(janggalLintas);
  harap("3i. jendela janggal: rentang tanggal = tanggal jam bank SMS (bukan dibuat/selesai)", jendelaPindah(janggalLintas) === null
        && rj.dari === "2026-11-01" && rj.sampai === "2026-11-02" && sesiDalamRentang([janggalLintas], "2026-11-02", "2026-11-02").length === 1);
  harap("3j. keteranganKePt: ujung 'TRF Ke - PT ACEH GADAI SYARIAH', TRF Ke tepat sekali",
        keteranganKePt("Pindah - TRF Ke - PT ACEH GADAI SYARIAH") && keteranganKePt("Tf - TRF Ke - PT ACEH GADAI SYARIAH  ")
        && keteranganKePt("AB12CD - TRF  Ke -  PT ACEH  GADAI SYARIAH") && keteranganKePt("x - trf ke - pt aceh gadai syariah"));
  harap("3k. keteranganKePt menolak: TRF Dari, GO-PAY ber-ujung PT, nama orang di ujung, berita palsu di awal/ujung, ekor tambahan, kosong",
        !keteranganKePt("Setor - TRF Dari - PT ACEH GADAI SYARIAH") && !keteranganKePt("TRF Ke - 987 - GO-PAY - PT ACEH GADAI SYARIAH")
        && !keteranganKePt("Tf x/BIFAST y/TRF Ke - NAMA ORANG") && !keteranganKePt("TRF Ke - PT ACEH GADAI SYARIAH - TRF Ke - NAMA ORANG")
        && !keteranganKePt("Tf - TRF Ke - NAMA ORANG - TRF Ke - PT ACEH GADAI SYARIAH") && !keteranganKePt("Tf - TRF Ke - PT ACEH GADAI SYARIAH x")
        && !keteranganKePt("PT ACEH GADAI SYARIAH") && !keteranganKePt(null) && !keteranganKePt(""));
}

// ═════════════ 4. pasangkanPindah ═════════════
console.log("\n4. pasangkanPindah");
{
  const s = bacaKirimanPindah(KIRIMAN_MENTAH)!.sesi[0];
  const KET_PT = "Pindah - TRF Ke - PT ACEH GADAI SYARIAH";
  const c = (id: string, jam: string | null, o: Partial<CalonPindah> = {}): CalonPindah =>
    ({ id, tanggal: "2026-11-02", jam, claimed_by_input_id: null, deskripsi: KET_PT, ...o });
  const pasang = (calon: CalonPindah[], terbaca = calon.map((x) => x.id), sesi = [s], kaki: KakiPindah = "DEBET_ASAL", diklaim?: string[]) =>
    pasangkanPindah({ sesi, calonPerSesi: new Map(sesi.map((x) => [x.id, calon])), idTerbaca: new Set(terbaca), kaki,
                      ...(diklaim ? { idDiklaimPassIni: new Set(diklaim) } : {}) });

  const a = pasang([c("t1", "14.08")]);
  harap("4a. calon tunggal di jendela → dipasangkan", a.pasangan.get("t1") === "12" && a.catatan.length === 0);
  const b = pasang([c("t1", "14.08"), c("t2", "14.15")]);
  harap("4b. dua calon di jendela → TIDAK ditebak + catatan", b.pasangan.size === 0 && /2 baris bernominal sama/.test(b.catatan[0] ?? ""));
  const d = pasang([c("t1", "14.08"), c("t2", "16.30")]);
  harap("4c. calon kedua di luar jendela tidak dihitung", d.pasangan.get("t1") === "12" && d.pasangan.size === 1);
  const e = pasang([c("t1", "13.57")]);
  harap("4d. tepat di luar sela kiri jam bank (13.57 < 13.58) → tidak", e.pasangan.size === 0);
  const e2 = pasang([c("t1", "13.58"), c("t9", "14.19")]);
  harap("4e. batas sela: 13.58 masuk, 14.19 (> 14.18) keluar", e2.pasangan.get("t1") === "12" && !e2.pasangan.has("t9"));
  const f = pasang([c("t1", "14.08", { claimed_by_input_id: "inp-9" })], [], [s], "DEBET_ASAL", ["t1"]);
  harap("4f. calon tunggal dipegang klaim lain (diklaim pass ini) → tidak + catatan", f.pasangan.size === 0 && /dipegang klaim/.test(f.catatan[0] ?? ""));
  const f2 = pasang([c("t1", "14.08", { claimed_by_input_id: "inp-9" })], []);
  harap("4f2. dipegang klaim dari pass LAMA → tidak, TANPA catatan (disebut sekali)", f2.pasangan.size === 0 && f2.catatan.length === 0, JSON.stringify(f2.catatan));
  const g = pasang([c("t1", "14.08")], []);
  harap("4g. calon tunggal tidak sedang dibaca (sudah distempel) → tidak, tanpa catatan", g.pasangan.size === 0 && g.catatan.length === 0);
  const h = pasang([c("t1", "14.08"), c("t2", null)]);
  harap("4h. baris tanpa jam di tanggal jendela ikut dihitung calon → ragu", h.pasangan.size === 0 && h.catatan.length === 1);
  const h2 = pasang([c("t1", "14.08"), c("t2", null, { tanggal: "2026-11-05" })]);
  harap("4i. baris tanpa jam di tanggal LAIN tidak dihitung", h2.pasangan.get("t1") === "12");
  // Dua sesi bernominal sama berdekatan: baris t1 (14.08) masuk jendela keduanya.
  const s2: SesiPindah = { ...s, id: "13", dibuatMs: W("14:05"), debitMs: W("14:12"), kreditMs: W("14:12"), selesaiMs: W("14:13") };
  const i = pasang([c("t1", "14.08"), c("t2", "14.40")], ["t1", "t2"], [s, s2]);
  // s: jendela 13.58–14.18 → {t1}; s2: 14.02–14.22 → {t1}. Satu baris dua sesi.
  harap("4j. satu baris di jendela dua sesi → keduanya tidak dipasangkan", i.pasangan.size === 0 && i.catatan.length === 2, JSON.stringify(i.catatan));
  const s3: SesiPindah = { ...s, id: "14", dibuatMs: W("14:35"), debitMs: W("14:40"), kreditMs: W("14:40"), selesaiMs: W("14:41") };
  const i2 = pasang([c("t1", "14.08"), c("t2", "14.40")], ["t1", "t2"], [s, s3]);
  harap("4k. dua sesi bernominal sama, jendela terpisah → masing-masing satu baris", i2.pasangan.get("t1") === "12" && i2.pasangan.get("t2") === "14");
  const s4: SesiPindah = { ...s, id: "15", dibuatMs: W("14:05"), debitMs: W("14:10"), kreditMs: W("14:12"), selesaiMs: W("14:13") };
  const i3 = pasang([c("t1", "14.08"), c("t2", "14.20")], ["t1", "t2"], [s, s4]);
  // s: {t1} (14.20 > 14.18); s4: 14.00–14.22 → {t1, t2} ragu. t1 di dua jendela → s pun tidak.
  harap("4l. calon tunggal sesi A juga calon sesi B (ragu) → A tidak dipasangkan", i3.pasangan.size === 0, JSON.stringify([...i3.pasangan]));
  const janggal: SesiPindah = { ...s, id: "16", debitMs: W("14:08"), kreditMs: W("14:45"), selesaiMs: W("14:46") };
  const j = pasang([c("t1", "14.08")], ["t1"], [janggal]);
  harap("4m. jendela janggal (debit–kredit 37 mnt) → tidak + catatan", j.pasangan.size === 0 && /janggal/.test(j.catatan[0] ?? ""));
  const j2 = pasang([c("t1", "14.08")], [], [janggal]);
  harap("4m2. jendela janggal, barisnya tidak sedang dibaca → TANPA catatan", j2.pasangan.size === 0 && j2.catatan.length === 0);
  const k = pasangkanPindah({ sesi: [s], calonPerSesi: new Map(), idTerbaca: new Set(["t1"]), kaki: "DEBET_ASAL" });
  harap("4n. sesi tanpa peta calon → tidak dinilai", k.pasangan.size === 0 && k.catatan.length === 0);

  // ── Temuan 1: uji serang S1 — jendela dipusatkan ke jam bank ──
  const sS1: SesiPindah = { ...s, id: "20", dibuatMs: W("10:00"), debitMs: W("15:30"), kreditMs: W("15:30"), selesaiMs: W("15:31") };
  const o1 = pasang([c("x1", "10.30")], ["x1"], [sS1]);
  harap("4o. S1: debet lain 10.30 (5 jam sebelum kredit 15.30) calon tunggal → TIDAK dipasangkan", o1.pasangan.size === 0, JSON.stringify([...o1.pasangan]));
  const sS1sapu: SesiPindah = { ...sS1, id: "21", selesaiMs: W("18:30") };
  const o2 = pasang([c("x1", "10.30"), c("x2", "15.30")], ["x1", "x2"], [sS1sapu]);
  harap("4p. sesi disapu (selesai 18.30): debet 10.30 bukan calon, pindah asli 15.30 tetap dipasangkan", o2.pasangan.size === 1 && o2.pasangan.get("x2") === "21" && o2.catatan.length === 0);
  // Efek samping lama: dua pindah bernominal sama berurutan saling menggagalkan
  // (dibuat_at − 10 sesi kedua menelan debet sesi pertama).
  const sA: SesiPindah = { ...s, id: "22", dibuatMs: W("14:00"), debitMs: W("14:05"), kreditMs: W("14:05"), selesaiMs: W("14:06") };
  const sB: SesiPindah = { ...s, id: "23", dibuatMs: W("14:08"), debitMs: W("14:35"), kreditMs: W("14:35"), selesaiMs: W("14:36") };
  const o3 = pasang([c("y1", "14.05"), c("y2", "14.35")], ["y1", "y2"], [sA, sB]);
  harap("4q. dua pindah bernominal sama berurutan (sesi B dibuat 14.08, kredit 14.35) → masing-masing dipasangkan",
        o3.pasangan.get("y1") === "22" && o3.pasangan.get("y2") === "23", JSON.stringify([...o3.pasangan]));

  // ── Temuan 2: kaki DEBET 1994 wajib debit_at + keterangan ke PT ──
  const tanpaDebit: SesiPindah = { ...s, id: "24", debitMs: null };
  const d1 = pasang([c("z1", "14.08")], ["z1"], [tanpaDebit]);
  harap("4r. DEBET_ASAL, debit_at null → TIDAK dipasangkan + catatan", d1.pasangan.size === 0 && /SMS debit 1994/.test(d1.catatan[0] ?? ""), JSON.stringify(d1.catatan));
  const d2 = pasang([c("z1", "14.08", { deskripsi: "TRF" })], ["z1"], [tanpaDebit], "KREDIT_TUJUAN");
  harap("4s. KREDIT_TUJUAN, debit_at null & keterangan apa pun → tetap dipasangkan (pola 1919 belum diketahui)", d2.pasangan.get("z1") === "24");
  const d3 = pasang([c("z1", "14.08", { deskripsi: "Tf x/BIFAST y/TRF Ke - NAMA ORANG" })]);
  harap("4t. DEBET_ASAL, keterangan ke pihak ketiga → TIDAK + catatan", d3.pasangan.size === 0 && /bukan transfer ke rekening PT/.test(d3.catatan[0] ?? ""));
  const d4 = pasang([c("z1", "14.08", { deskripsi: "TRF Ke - PT ACEH GADAI SYARIAH - TRF Ke - NAMA ORANG" })]);
  const d5 = pasang([c("z1", "14.08", { deskripsi: "Tf - TRF Ke - NAMA ORANG - TRF Ke - PT ACEH GADAI SYARIAH" })]);
  const d6 = pasang([c("z1", "14.08", { deskripsi: null })]);
  harap("4u. berita palsu (di awal / di ujung) & keterangan kosong → TIDAK", d4.pasangan.size === 0 && d5.pasangan.size === 0 && d6.pasangan.size === 0);
  const d7 = pasang([c("z1", "14.08", { deskripsi: "Tf x/BIFAST y/TRF Ke - NAMA ORANG" })], []);
  harap("4v. keterangan salah tapi baris sudah distempel → tanpa catatan", d7.pasangan.size === 0 && d7.catatan.length === 0);

  // ── Temuan 4: uji serang S3 — catatan hanya bila barisnya sedang disebut ──
  const g1 = pasang([c("t1", "14.08"), c("t2", "14.15")], []);
  harap("4w. S3: ragu, semua calon sudah distempel/tak terbaca → TANPA catatan", g1.pasangan.size === 0 && g1.catatan.length === 0, JSON.stringify(g1.catatan));
  const g2 = pasang([c("t1", "14.08"), c("t2", "14.15")], ["t2"]);
  harap("4x. ragu, satu calon masih terbaca → catatan sekali, kalimat tidak lagi 'tetap terhitung'",
        g2.catatan.length === 1 && /yang tampil di daftar tanpa pemilik/.test(g2.catatan[0]) && !/tetap terhitung tanpa pemilik/.test(g2.catatan[0]));
  const g3 = pasang([c("t1", "14.08"), c("t2", "14.40")], [], [s, s2]);
  harap("4y. baris dua sesi, baris tidak terbaca → TANPA catatan", g3.pasangan.size === 0 && g3.catatan.length === 0);
}

// ═════════════ 5. bacaBarisNganggur — DB tiruan ═════════════
console.log("\n5. bacaBarisNganggur (DB tiruan)");
type Baris = Record<string, any>;
function dbTiruan(tabel: Record<string, Baris[]>, o: { tolakCalon?: boolean } = {}) {
  const log: { kolom: string; n: number }[] = [];
  const kueri = (nama: string, kolom: string, pilihan?: { count?: string }) => {
    const saring: ((b: Baris) => boolean)[] = [];
    const urut: { kol: string; naik: boolean }[] = [];
    let batas: number | null = null;
    const q: any = {
      eq: (k: string, v: any) => (saring.push((b) => b[k] === v), q),
      gte: (k: string, v: any) => (saring.push((b) => b[k] >= v), q),
      lte: (k: string, v: any) => (saring.push((b) => b[k] <= v), q),
      gt: (k: string, v: any) => (saring.push((b) => Number(b[k] ?? 0) > v), q),
      is: (k: string, v: any) => (saring.push((b) => (b[k] ?? null) === v), q),
      order: (kol: string, x: { ascending?: boolean } = {}) => (urut.push({ kol, naik: x.ascending !== false }), q),
      limit: (n: number) => ((batas = n), q),
      then: (ok: any, tolak: any) => jalan().then(ok, tolak),
    };
    const jalan = async () => {
      // Kueri calon = yang tidak memakai count (kueri pembaca selalu count exact).
      if (o.tolakCalon && pilihan?.count !== "exact") return { data: null, count: null, error: { message: "tiruan: calon ditolak" } };
      let hasil = (tabel[nama] ?? []).filter((b) => saring.every((f) => f(b)));
      const count = pilihan?.count === "exact" ? hasil.length : null;
      for (const u of [...urut].reverse()) {
        hasil = [...hasil].sort((a, b) => (a[u.kol] < b[u.kol] ? -1 : a[u.kol] > b[u.kol] ? 1 : 0) * (u.naik ? 1 : -1));
      }
      if (batas !== null) hasil = hasil.slice(0, batas);
      log.push({ kolom, n: hasil.length });
      return { data: hasil.map((b) => ({ ...b })), count, error: null };
    };
    return q;
  };
  return { log, from: (nama: string) => ({ select: (kolom: string, pilihan?: { count?: string }) => kueri(nama, kolom, pilihan) }) };
}
let noBaris = 0;
const AKUN = "akun-1";
const mutasi = (bank: string, tgl: string, jam: string, arah: "debet" | "kredit", nominal: number, o: Baris = {}): Baris => ({
  id: `tx-${String(++noBaris).padStart(4, "0")}`, account_id: AKUN, bank_id: bank, tanggal: tgl, jam,
  nominal_debet: arah === "debet" ? nominal : 0, nominal_kredit: arah === "kredit" ? nominal : 0,
  nama_pengirim: arah === "kredit" ? "PIHAK" : "", nama_penerima: arah === "debet" ? "PIHAK" : "",
  deskripsi: "TRF", claimed_by_input_id: null, unclaimed_reported_at: null, deleted_at: null, ...o,
});
const KIRIMAN = bacaKirimanPindah(KIRIMAN_MENTAH)!;
const PINDAH = { sesi: KIRIMAN.sesi, rute: rutePindah(KIRIMAN), kaki: "DEBET_ASAL" as KakiPindah };
const opsiDasar = { accountId: AKUN, jenis: "debet" as const, bankId: MASUK.id, dari: "2026-11-01", sampai: "2026-11-03", idTerpakai: new Set<string>() };
const tabelDasar = () => ({
  parsed_transactions: [
    mutasi(MASUK.id, "2026-11-01", "09.00", "debet", 1_250_000),
    mutasi(MASUK.id, "2026-11-02", "14.08", "debet", 5_000_000, { deskripsi: "Pindah - TRF Ke - PT ACEH GADAI SYARIAH" }), // kaki PINDAH
    mutasi(MASUK.id, "2026-11-02", "16.30", "debet", 5_000_000),            // nominal sama, jauh di luar jendela
    mutasi(MASUK.id, "2026-11-02", "14.09", "debet", 4_999_999),            // nominal beda di jendela
    mutasi(MASUK.id, "2026-11-03", "08.00", "debet", 2_500),                // admin
    mutasi(KELUAR.id, "2026-11-02", "14.08", "kredit", 5_000_000),          // kaki kredit (rekening lain)
    mutasi(MASUK.id, "2026-11-02", "14.08", "kredit", 5_000_000),           // kredit di MASUK — bukan kaki debet
  ],
});
{
  const t1 = tabelDasar();
  const lama = await bacaBarisNganggur(dbTiruan(t1) as any, opsiDasar);
  const nol = await bacaBarisNganggur(dbTiruan(t1) as any, { ...opsiDasar, pindah: null });
  harap("5a. tanpa opsi pindah = hasil lama (tanpa medan pindah)", !("pindah" in lama) && lama.rows.length === 5 && lama.belumLapor === 5);
  harap("5b. pindah: null = SAMA PERSIS dengan tanpa opsi", JSON.stringify(nol) === JSON.stringify(lama));

  const tBaru = tabelDasar();
  const idKaki = tBaru.parsed_transactions[1].id;
  const db = dbTiruan(tBaru);
  const baru = await bacaBarisNganggur(db as any, { ...opsiDasar, pindah: PINDAH });
  harap("5c. kaki debet 1994 dikeluarkan dari daftar tanpa pemilik", baru.rows.length === 4 && !baru.ids.includes(idKaki), JSON.stringify(baru.ids));
  harap("5d. kaki dirinci di pindah.rows dengan sesi & rute", baru.pindah?.ids.join() === idKaki && baru.pindah.rows[0].sesi === "12"
        && baru.pindah.rows[0].rute === "1994 → 1919" && baru.pindah.rows[0].nominal === 5_000_000 && baru.pindah.rows[0].jam === "14.08");
  harap("5e. belumLapor dikurangi kaki (bukan sisa)", baru.belumLapor === 4);
  harap("5f. baris 16.30 bernominal sama & 4.999.999 TETAP tanpa pemilik",
        baru.rows.some((r) => r.jam === "16.30" && r.nominal === 5_000_000) && baru.rows.some((r) => r.nominal === 4_999_999));
  harap("5g. tanpa catatan", baru.pindah?.catatan.length === 0);
  harap("5h. kueri calon hanya untuk rekening & nominal sesi (1 kueri tambahan)", db.log.length === 2);

  // Kredit 1919.
  const kr = await bacaBarisNganggur(dbTiruan(tabelDasar()) as any, { ...opsiDasar, jenis: "kredit", bankId: KELUAR.id, pindah: { ...PINDAH, kaki: "KREDIT_TUJUAN" } });
  harap("5i. kaki kredit 1919 dikenali di berkas KELUAR", kr.rows.length === 0 && kr.pindah?.rows.length === 1 && kr.pindah.rows[0].nominal === 5_000_000);

  // Keunikan dihitung dari SEMUA baris DB: kembaran yang sudah diklaim / distempel ikut.
  const t2 = tabelDasar();
  t2.parsed_transactions.push(mutasi(MASUK.id, "2026-11-02", "14.12", "debet", 5_000_000, { claimed_by_input_id: "inp-1" }));
  const r2 = await bacaBarisNganggur(dbTiruan(t2) as any, { ...opsiDasar, pindah: PINDAH });
  harap("5j. kembaran DIKLAIM di jendela → ragu, tidak ada yang dipisah", r2.pindah?.ids.length === 0 && r2.rows.length === 5 && r2.pindah.catatan.length === 1);
  const t3 = tabelDasar();
  t3.parsed_transactions.push(mutasi(MASUK.id, "2026-11-02", "14.12", "debet", 5_000_000, { unclaimed_reported_at: "2026-11-01T00:00:00Z" }));
  const r3 = await bacaBarisNganggur(dbTiruan(t3) as any, { ...opsiDasar, pindah: PINDAH });
  harap("5k. kembaran SUDAH DISTEMPEL di jendela → ragu", r3.pindah?.ids.length === 0 && r3.rows.length === 5);
  const t4 = tabelDasar();
  t4.parsed_transactions.push(mutasi(MASUK.id, "2026-11-02", "14.12", "debet", 5_000_000, { deleted_at: "2026-11-02T10:00:00Z" }));
  const r4 = await bacaBarisNganggur(dbTiruan(t4) as any, { ...opsiDasar, pindah: PINDAH });
  harap("5l. kembaran yang DIHAPUS tidak dihitung → tetap dipasangkan", r4.pindah?.ids.length === 1);
  const t5 = tabelDasar();
  t5.parsed_transactions.push(mutasi(KELUAR.id, "2026-11-02", "14.12", "debet", 5_000_000));
  const r5 = await bacaBarisNganggur(dbTiruan(t5) as any, { ...opsiDasar, pindah: PINDAH });
  harap("5m. kembaran di rekening LAIN tidak dihitung", r5.pindah?.ids.length === 1);

  // Kaki sudah distempel dulu (sebelum jembatan ada): tidak terbaca, tidak ada apa pun.
  const t6 = tabelDasar();
  t6.parsed_transactions[1].unclaimed_reported_at = "2026-11-03T00:00:00Z";
  const r6 = await bacaBarisNganggur(dbTiruan(t6) as any, { ...opsiDasar, pindah: PINDAH });
  harap("5n. kaki sudah distempel → tidak terbaca, tidak dipasangkan, tanpa catatan", r6.pindah?.ids.length === 0 && r6.rows.length === 4 && r6.pindah.catatan.length === 0);

  // Galat kueri calon → catatan, TIDAK melempar, daftar tanpa pemilik utuh.
  let dilempar = false;
  let r7: Awaited<ReturnType<typeof bacaBarisNganggur>> | null = null;
  try { r7 = await bacaBarisNganggur(dbTiruan(tabelDasar(), { tolakCalon: true }) as any, { ...opsiDasar, pindah: PINDAH }); } catch { dilempar = true; }
  harap("5o. galat calon → tidak melempar, tidak ada yang dipisah, catatan", !dilempar && r7?.rows.length === 5 && r7.pindah?.ids.length === 0
        && /tidak bisa memeriksa/.test(r7.pindah.catatan[0] ?? ""));

  // Sesi di luar rentang baca → tidak ada kueri calon.
  const db8 = dbTiruan(tabelDasar());
  const r8 = await bacaBarisNganggur(db8 as any, { ...opsiDasar, dari: "2026-11-03", sampai: "2026-11-03", pindah: PINDAH });
  harap("5p. sesi di luar rentang berkas → tanpa kueri calon", db8.log.length === 1 && r8.pindah?.ids.length === 0);

  // bankId null (aturan rekening mati) → tidak ada pemasangan sama sekali.
  const r9 = await bacaBarisNganggur(dbTiruan(tabelDasar()) as any, { ...opsiDasar, bankId: null, pindah: PINDAH });
  harap("5q. tanpa bankId → tidak dipasangkan", r9.pindah?.ids.length === 0);

  // idTerpakai (jaring memori) tetap menang: kaki yang terpakai run ini tidak dipasangkan dua kali.
  const t10 = tabelDasar();
  const r10 = await bacaBarisNganggur(dbTiruan(t10) as any, { ...opsiDasar, idTerpakai: new Set([t10.parsed_transactions[1].id]), pindah: PINDAH });
  harap("5r. kaki yang dipakai run ini (jaring memori) tidak dipasangkan lagi", r10.tersaring === 1 && r10.pindah?.ids.length === 0 && r10.rows.length === 4);

  // Temuan 1 — PDF sebagian hari (diunduh siang, diproses besok pagi) + pindah
  // asli datang belakangan. Sesi: dibuat 10.00, debit/kredit 15.30.
  const sesiS1 = bacaKirimanPindah({ ...KIRIMAN_MENTAH, sesi: [{ ...SESI_MENTAH, id: "30", dibuat_at: "2026-11-02T03:00:00.000Z",
    debit_at: "2026-11-02T08:30:00.000Z", kredit_at: "2026-11-02T08:30:00.000Z", selesai_at: "2026-11-02T08:31:00.000Z" }] })!;
  const PINDAH_S1 = { sesi: sesiS1.sesi, rute: rutePindah(sesiS1), kaki: "DEBET_ASAL" as KakiPindah };
  const ket = { deskripsi: "Tf - TRF Ke - PT ACEH GADAI SYARIAH" };
  const tS1 = { parsed_transactions: [mutasi(MASUK.id, "2026-11-02", "10.30", "debet", 5_000_000, ket)] };
  const p1 = await bacaBarisNganggur(dbTiruan(tS1) as any, { ...opsiDasar, pindah: PINDAH_S1 });
  harap("5s. PDF sebagian (berhenti siang): debet 10.30 bernominal sama TIDAK dipasangkan, tetap tanpa pemilik",
        p1.pindah?.ids.length === 0 && p1.rows.length === 1 && p1.rows[0].jam === "10.30", JSON.stringify(p1.pindah));
  // Laporan itu menstempel 10.30; PDF berikutnya membawa pindah asli 15.30.
  tS1.parsed_transactions[0].unclaimed_reported_at = "2026-11-03T00:30:00Z";
  tS1.parsed_transactions.push(mutasi(MASUK.id, "2026-11-02", "15.30", "debet", 5_000_000, ket));
  const p2 = await bacaBarisNganggur(dbTiruan(tS1) as any, { ...opsiDasar, pindah: PINDAH_S1 });
  harap("5t. pindah asli 15.30 datang belakangan → dipasangkan (10.30 di luar jendela, bukan pesaing), tanpa 🔴 & tanpa ℹ️",
        p2.pindah?.ids.length === 1 && p2.pindah.rows[0].jam === "15.30" && p2.rows.length === 0 && p2.pindah.catatan.length === 0, JSON.stringify(p2.pindah));

  // Temuan 2 — debet bernominal sama di jendela tapi ke pihak ketiga: tetap 🔴.
  const t11 = tabelDasar();
  t11.parsed_transactions[1].deskripsi = "Tf 123/BIFAST 456/TRF Ke - NAMA ORANG";
  const r11 = await bacaBarisNganggur(dbTiruan(t11) as any, { ...opsiDasar, pindah: PINDAH });
  harap("5u. debet di jendela ke pihak ketiga → TIDAK dipasangkan, tetap tanpa pemilik + catatan",
        r11.pindah?.ids.length === 0 && r11.rows.length === 5 && /bukan transfer ke rekening PT/.test(r11.pindah.catatan[0] ?? ""));
  const kTanpaDebit = bacaKirimanPindah({ ...KIRIMAN_MENTAH, sesi: [{ ...SESI_MENTAH, debit_at: null }] })!;
  const r12 = await bacaBarisNganggur(dbTiruan(tabelDasar()) as any, { ...opsiDasar, pindah: { ...PINDAH, sesi: kTanpaDebit.sesi } });
  harap("5v. sesi tanpa SMS debit 1994 (debit_at null) → kaki debet TIDAK dipasangkan", r12.pindah?.ids.length === 0 && r12.rows.length === 5);
  const r13 = await bacaBarisNganggur(dbTiruan(tabelDasar()) as any, { ...opsiDasar, jenis: "kredit", bankId: KELUAR.id, pindah: { sesi: kTanpaDebit.sesi, rute: PINDAH.rute, kaki: "KREDIT_TUJUAN" } });
  harap("5w. …kaki kredit 1919 sesi yang sama tetap dipasangkan", r13.pindah?.ids.length === 1);

  // Temuan 4 — "dipegang klaim lain" hanya di pass yang mengklaimnya.
  const t14 = tabelDasar();
  t14.parsed_transactions[1].claimed_by_input_id = "inp-7";
  const idKlaim = t14.parsed_transactions[1].id;
  const r14 = await bacaBarisNganggur(dbTiruan(t14) as any, { ...opsiDasar, idTerpakai: new Set([idKlaim]), pindah: PINDAH });
  const r15 = await bacaBarisNganggur(dbTiruan(t14) as any, { ...opsiDasar, pindah: PINDAH });
  harap("5x. kaki diklaim pass INI → catatan 'dipegang klaim'; pass berikutnya → tanpa catatan",
        r14.pindah?.ids.length === 0 && /dipegang klaim/.test(r14.pindah.catatan[0] ?? "") && r15.pindah?.catatan.length === 0, JSON.stringify([r14.pindah?.catatan, r15.pindah?.catatan]));
}

// ═════════════ 6. Laporan & stempel ═════════════
console.log("\n6. Laporan Lapis 2 + stempel + pecah pesan");
const KEPALA = { nomor: 7, sebelumNomor: null, sebelumKapan: null };
function isiDasar(bahan: ReturnType<typeof bahanNganggur>): IsiLapis2 {
  // Sama dengan isiKosong() di scripts/uji-nganggur-rinci.mts.
  return {
    bankLabel: "BSI 1999881994 (MASUK)", namaFile: "mutasi.pdf",
    berkasDari: "2026-11-01", berkasSampai: "2026-11-03", nilaiDari: null, nilaiSampai: null,
    utuh: true, rantaiPutus: 0, nyambung: true, selisihSambungan: 0,
    perTanggal: [], nDiuji: 0, rpDiuji: 0, nCocok: 0, tidakKetemu: [],
    ditahanLuarPeriode: 0, ditahanKonflik: 0,
    kreditNganggur: [], rpKreditNganggur: 0, debetNganggur: [], rpDebetNganggur: 0,
    nganggurDiperiksa: true, sandingan: null, tunggakan: [], gagal: [],
    ...bahan,
  };
}
{
  const r = (tgl: string, jam: string, nominal: number) => ({ tgl, jam, nominal, pihak: "PIHAK", ket: "TRF" });
  const nganggurD = [r("2026-11-01", "09.00", 1_250_000), r("2026-11-02", "16.30", 5_000_000)];
  const kaki = [{ ...r("2026-11-02", "14.08", 5_000_000), sesi: "12", rute: "1994 → 1919" }];
  const passLama: PassNganggur = { unclaimedRows: nganggurD, unclaimedBelumLapor: 2, idNganggur: ["tx-a", "tx-b"] };
  const passBaru: PassNganggur = { ...passLama, pindahRows: kaki, idPindah: ["tx-k"], pindahCatatan: [] };

  const bLama = bahanNganggur(undefined, passLama, "2026-07-22");
  harap("6a. tanpa jembatan: bahan TANPA kunci pindahSaldo", !("pindahSaldo" in bLama));
  const bKosong = bahanNganggur(undefined, { ...passLama, pindahRows: [], idPindah: [], pindahCatatan: [] }, "2026-07-22");
  harap("6b. jembatan tanpa kaki & tanpa catatan: bahan sama dengan tanpa jembatan", JSON.stringify(bKosong) === JSON.stringify(bLama));
  const tLama = susunLapis2Lengkap(isiDasar(bLama), KEPALA).teks;
  const tKosong = susunLapis2Lengkap(isiDasar(bKosong), KEPALA).teks;
  harap("6c. teks laporan SAMA PERSIS bila jembatan diam", tLama === tKosong);
  harap("6d. stempel lama tidak berubah", JSON.stringify(idStempelNganggur(undefined, passLama)) === JSON.stringify(["tx-a", "tx-b"]));

  const bBaru = bahanNganggur(undefined, passBaru, "2026-07-22");
  const { teks, ringkas } = susunLapis2Lengkap(isiDasar(bBaru), KEPALA);
  const L = teks.split("\n");
  harap("6e. kepala 🚨 menghitung 2 uang keluar (kaki pindah TIDAK)", L.some((l) => /^🚨 ADA 2 UANG KELUAR TANPA ALASAN \(Rp 6\.250\.000\)/.test(l)), teks);
  harap("6f. tidak ada baris 🔴 untuk kaki pindah (14.08)", !L.some((l) => l.includes("🔴") && l.includes("14.08")));
  harap("6g. blok 🔁 PINDAH SALDO RESMI merinci kakinya", L.some((l) => l.startsWith("🔁 PINDAH SALDO RESMI") && l.includes("— 1 · Rp 5.000.000"))
        && L.some((l) => l === "   🔁 2 Nov 14.08 · Rp 5.000.000 · keluar 1994 → 1919 · sesi #12"), teks);
  harap("6h. ringkas web: tanpa pemilik keluar = 2", ringkas.tanpaPemilikKeluar?.n === 2);
  harap("6i. yang distempel = yang dirinci (nganggur + kaki)", JSON.stringify(idStempelNganggur(undefined, passBaru)) === JSON.stringify(["tx-a", "tx-b", "tx-k"]));
  harap("6j. idPindah tidak sejajar → kaki TIDAK distempel, tanpa pemilik tetap",
        JSON.stringify(idStempelNganggur(undefined, { ...passBaru, idPindah: ["tx-k", "tx-z"] })) === JSON.stringify(["tx-a", "tx-b"]));
  harap("6k. pass batal (idPindah null) → kaki tidak distempel", !idStempelNganggur(undefined, { ...passBaru, idNganggur: null, idPindah: null }).includes("tx-k"));
  harap("6l. id kaki tak sah → ditolak", !idStempelNganggur(undefined, { ...passBaru, idPindah: ["tx-k),id.neq.(x"] }).some((x) => x.includes("neq")));
  // Kredit 1919 (berkas KELUAR) — arah masuk.
  const bK = bahanNganggur({ unclaimedRows: [], unclaimedBelumLapor: 0, idNganggur: [], pindahRows: kaki, idPindah: ["tx-m"] }, undefined, "2026-07-22");
  const tK = susunLapis2Lengkap(isiDasar(bK), KEPALA).teks;
  harap("6m. berkas 1919: kaki kredit 'masuk 1994 → 1919', tanpa pemilik ✅ tidak ada", tK.includes("· masuk 1994 → 1919 · sesi #12") && tK.includes("   ✅ tidak ada."), tK);
  harap("6n. kaki saja → stempel tetap jalan walau daftar tanpa pemilik kosong", JSON.stringify(idStempelNganggur({ unclaimedRows: [], idNganggur: [], pindahRows: kaki, idPindah: ["tx-m"] }, undefined)) === '["tx-m"]');
  // Catatan saja (ragu): blok tetap muncul dengan 0 kaki.
  const bC = bahanNganggur(undefined, { ...passLama, pindahRows: [], idPindah: [], pindahCatatan: ["pindah saldo sesi #12 Rp 5.000.000: 2 baris bernominal sama\nPALSU"] }, "2026-07-22");
  const tC = susunLapis2Lengkap(isiDasar(bC), KEPALA).teks;
  harap("6o. catatan ragu dicetak sebagai ℹ️, baris baru dijinakkan", tC.includes("🔁 PINDAH SALDO RESMI (menu Pindah Saldo Aceh Gadai) — 0 · Rp 0")
        && tC.includes("   ℹ️ pindah saldo sesi #12 Rp 5.000.000: 2 baris bernominal sama PALSU") && !tC.split("\n").includes("PALSU"));
  // Lantai: kaki di bawah lantai tidak dicetak.
  const bLt = bahanNganggur(undefined, { ...passBaru, pindahRows: [{ ...kaki[0], tgl: "2026-07-01" }] }, "2026-07-22");
  harap("6p. kaki di bawah lantai tidak dicetak (dan tanpa catatan → tanpa blok)", !("pindahSaldo" in bLt));
  // Sesi & jam dijinakkan.
  const bJ = bahanNganggur(undefined, { ...passBaru, pindahRows: [{ ...kaki[0], jam: "14.08\n🔴 PALSU", sesi: "12\nx", rute: "1994 → 1919\nPALSU" }] }, "2026-07-22");
  const tJ = susunLapis2Lengkap(isiDasar(bJ), KEPALA).teks;
  harap("6q. jam/sesi/rute dari peramban dijinakkan (jam hanya angka, tanpa 🔴)",
        !tJ.split("\n").some((l) => l.startsWith("🔴") || l === "PALSU") && /· sesi #12$/m.test(tJ) && tJ.includes("1994 → 1919 PALSU")
        && tJ.includes("   🔁 2 Nov 14.08 · Rp") && !tJ.split("\n").some((l) => l.startsWith("   🔁") && l.includes("🔴")), tJ);

  // Pecah pesan: laporan panjang — pesan yang dimulai di baris 🔁 TIDAK diberi judul uang keluar.
  const banyak = Array.from({ length: 100 }, (_, i) => r("2026-11-02", `1${i % 10}.0${i % 10}`, 1_000_000 + i));
  const kakiBanyak = Array.from({ length: 60 }, (_, i) => ({ ...r("2026-11-02", "14.08", 5_000_000 + i), sesi: String(100 + i), rute: "1994 → 1919" }));
  const bP = bahanNganggur(undefined, { unclaimedRows: banyak, unclaimedBelumLapor: 100, idNganggur: banyak.map((_, i) => `n${i}`),
                                        pindahRows: kakiBanyak, idPindah: kakiBanyak.map((_, i) => `p${i}`) }, "2026-07-22");
  const tP = susunLapis2Lengkap(isiDasar(bP), KEPALA).teks;
  const pesan = pecahPesanLapis2(tP);
  const salah = pesan.slice(1).filter((p) => {
    const xs = p.split("\n");
    return xs[1] === SAMBUNGAN_KELUAR_LAPIS2 && (xs[2] ?? "").startsWith("   🔁");
  });
  harap("6r. laporan panjang dipecah; pesan yang dimulai di baris 🔁 tidak berjudul 🚨", pesan.length > 1 && salah.length === 0, String(pesan.length));
  const gabung = pesan.join("\n");
  harap("6s. semua kaki & semua baris tanpa pemilik tetap tercetak setelah dipecah",
        kakiBanyak.every((k) => gabung.includes(`sesi #${k.sesi}`)) && (gabung.match(/   🔴 /g) ?? []).length === 100);
}

// ═════════════ 7. Kabel ═════════════
console.log("\n7. Kabel");
{
  const runner = readFileSync(new URL("../app/(app)/proses/[...jalur]/auto-runner.tsx", import.meta.url), "utf8");
  harap("7a. auto-runner menyalin pindahRows/idPindah/pindahCatatan",
        runner.includes("pindahRows: h.pindahRows,") && runner.includes("idPindah: h.idPindah,") && runner.includes("pindahCatatan: h.pindahCatatan,"));
  const pass = readFileSync(new URL("../lib/pipeline/jalankanPass.ts", import.meta.url), "utf8");
  const nStempel = (pass.match(/hasil\.idNganggur = (await bacaNganggur\(new Set\(\)\)|idNganggur);/g) ?? []).length;
  const nPindah = (pass.match(/if \(hasil\.pindahRows\) hasil\.idPindah = idPindahTerbaca;/g) ?? []).length;
  harap("7b. hak stempel kaki diberikan di jalan keluar yang SAMA dengan idNganggur (2 = 2)", nStempel === 2 && nPindah === 2, `${nStempel}/${nPindah}`);
  harap("7c. pembaca hanya diberi jembatan bila kakinya milik berkas ini", pass.includes("...(pindahBerkas ? { pindah: pindahBerkas } : {}),")
        && pass.includes("rekeningTerbukti: upload.rekeningTerbukti === true"));
  const tarik = readFileSync(new URL("../app/(app)/check/actions-gadai.ts", import.meta.url), "utf8");
  harap("7d. tarikan klaim membaca medan pindah lewat bacaKirimanPindah", tarik.includes("pindah = bacaKirimanPindah(json.pindah);"));
  const ngg = readFileSync(new URL("../lib/pipeline/nganggur.ts", import.meta.url), "utf8");
  harap("7e. kaki berkas & jaring klaim pass ini diteruskan ke pasangkanPindah",
        pass.includes("pindahBerkas = { sesi: kiriman.sesi, rute: rutePindah(kiriman), kaki };")
        && ngg.includes("kaki: o.pindah.kaki, idDiklaimPassIni: o.idTerpakai,"));
}

// ═════════════ 8. Kontrak dua sisi ═════════════
const kontrak = process.argv.find((a) => a.startsWith("--kontrak="))?.slice("--kontrak=".length);
if (kontrak) {
  console.log("\n8. Kontrak dengan gadai (jawaban contoh uji gadai)");
  if (!existsSync(kontrak)) {
    harap("8. berkas kontrak ada", false, kontrak);
  } else {
    const json = JSON.parse(readFileSync(kontrak, "utf8"));
    const k: KirimanPindah | null = bacaKirimanPindah(json.pindah);
    harap("8a. medan pindah gadai terbaca utuh", !!k && k.sesi.length === 2 && k.ditolak === 0 && k.galat === null, JSON.stringify(k));
    harap("8b. rekening asal/tujuan = 1994 / 1919", k?.rekAsal === "1999881994" && k?.rekTujuan === "1999881919");
    harap("8c. debit null terbaca null, kredit = jam bank", k?.sesi[1].debitMs === null && k?.sesi[0].kreditMs === Date.parse("2026-11-02T07:08:00Z"));
    harap("8d. kaki debet 1994 & kredit 1919 dari kontrak", !!k
          && kakiPindahBerkas({ kiriman: k, aturan: ATURAN, bankId: MASUK.id, jenis: "debet", rekeningTerbukti: true }) === "DEBET_ASAL"
          && kakiPindahBerkas({ kiriman: k, aturan: ATURAN, bankId: KELUAR.id, jenis: "kredit", rekeningTerbukti: true }) === "KREDIT_TUJUAN");
    const tanpa = { ...json };
    delete tanpa.pindah;
    harap("8e. jawaban gadai TANPA medan pindah → null (jembatan diam)", bacaKirimanPindah(tanpa.pindah) === null);
  }
}

console.log(`\n${lulus} lulus, ${gagal} gagal`);
if (gagal) process.exit(1);
