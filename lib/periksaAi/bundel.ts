// ============================================================
// CEKTRANSFER - Bundel data mutasi untuk PEMERIKSAAN AI
// File: lib/periksaAi/bundel.ts
//
// AI pemeriksa hidup di aplikasi gadai. Ia tidak punya akses ke database
// cektransfer, jadi semua yang perlu ia lihat dari sisi mutasi dikirim
// sekaligus sebagai satu bundel:
//   - mutasi  : baris mutasi rekening di sekitar tanggal yang diperiksa,
//               plus baris yang dipegang vonis walau tanggalnya di luar itu;
//   - verdik  : vonis Lapis 2 TERBARU per klaim (cek_inputs) — klaim yang
//               tanggal resinya di sekitar, yang memegang baris di tanggal
//               diperiksa, ATAU yang tgl_transaksi-nya (tertanam di id TFK)
//               termasuk tanggal diperiksa;
//   - ftIndex : semua token FT di mutasi ±2 bulan — supaya "ref di resi tidak
//               ada di mutasi" bisa diuji tanpa mengirim ribuan baris utuh.
//
// MURNI & BACA-SAJA. Hanya SELECT, tanpa efek samping, dan TANPA impor apa
// pun yang cuma hidup di dalam Next (server-only, next/headers, cookies,
// alias "@/"). Berkas ini juga diimpor skrip ujian gadai
// (scripts/ujian-periksa-ai.mts) lewat tsx dengan klien supabase-js polos —
// satu impor yang salah di sini mematahkan ujian itu. Karena itu berkas ini
// sengaja tidak mengimpor apa pun.
//
// Batas 1000 baris PostgREST: SETIAP bacaan banyak-baris dipaging
// (.order('id').range()), dan daftar .in() dipecah ≤150. Bacaan yang gagal
// MELEMPAR — bundel yang diam-diam kurang separuh lebih berbahaya daripada
// tidak ada bundel, karena AI akan menilai "tidak ada di mutasi" dari data
// yang memang tidak dikirim.
// ============================================================

/**
 * Cukup "sesuatu yang punya .from()". Sengaja BUKAN SupabaseClient: skrip
 * ujian gadai memberi klien dari salinan @supabase/supabase-js MILIKNYA
 * sendiri, dan kelas dari dua salinan paket tidak dianggap sama oleh
 * TypeScript (anggota protected membuatnya nominal).
 */
export interface DbBaca {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(tabel: string): any;
}

/** Satu baris mutasi rekening — bentuk persis kontrak POST periksa-ai. */
export interface BarisMutasi {
  id: string;
  tanggal: string;
  /** BSI menulis "HH.MM" (titik). */
  jam: string | null;
  no_ref: string | null;
  kredit: number;
  debet: number;
  nama_pengirim: string | null;
  deskripsi: string | null;
  claimed_by_input_id: string | null;
  manual_claim_reason: string | null;
}

/** Vonis Lapis 2 terbaru satu klaim (satu baris cek_inputs). */
export interface Verdik {
  input_id: string;
  gadai_klaim_id: string | null;
  gadai_no_faktur: string | null;
  jenis: "kredit" | "debet";
  tanggal_input: string;
  nominal: number;
  /** matched | manual_claimed | no_candidate | all_taken (diteruskan apa adanya). */
  match_status: string;
  matched_by: string | null;
  ref_issue: string | null;
  matched_tx_id: string | null;
  /** "DD-MM-YYYY". */
  conflict_dates: string[];
  manual_claim_reason: string | null;
  created_at: string;
}

export interface EntriFt {
  /** 12 karakter token FT setelah kanonik RINGAN (huruf besar, tanpa spasi). */
  ft: string;
  id: string;
  tanggal: string;
  nominal: number;
  arah: "K" | "D";
}

export interface Cakupan {
  dari: string;
  sampai: string;
}

export interface Bundel {
  mutasi: BarisMutasi[];
  verdik: Verdik[];
  ftIndex: EntriFt[];
  /** Rentang tanggal baris mutasi yang disertakan. null = tidak ada tanggal
   *  yang diminta (bundel kosong) — pemanggil yang mengisinya. */
  cakupan: Cakupan | null;
}

export interface OpsiBundel {
  /** Mundur dari tanggal terkecil untuk baris mutasi & vonis. Bawaan 7. */
  hariMundur?: number;
  /** Maju dari tanggal terbesar untuk baris mutasi & vonis. Bawaan 1. */
  hariMaju?: number;
  /** Mundur untuk indeks FT. Bawaan 60 — resi bekas bisa berumur 2 bulan. */
  hariMundurFt?: number;
  /** Maju untuk indeks FT. Bawaan 3. */
  hariMajuFt?: number;
}

// ── Pembantu tanggal (tanggal kalender polos, dihitung di UTC) ──────────────

export const POLA_TGL = /^\d{4}-\d{2}-\d{2}$/;
const HARI_MS = 86_400_000;

/** "2026-09-30" + n hari. */
export function tambahHari(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * HARI_MS).toISOString().slice(0, 10);
}

/** Tanggal hari ini menurut jam WIB (UTC+7, tanpa musim panas). */
export function hariIniWib(sekarangMs: number = Date.now()): string {
  return new Date(sekarangMs + 7 * 3_600_000).toISOString().slice(0, 10);
}

// ── Pembantu baca ───────────────────────────────────────────────────────────

/** Ukuran halaman. Di bawah max-rows PostgREST (1000) dengan sengaja: kalau
 *  halaman > max-rows, halaman penuh terlihat "kurang dari HAL" dan paging
 *  berhenti terlalu dini tanpa galat. */
const HAL = 500;
/** Rem darurat — bukan batas kerja. Melewatinya = galat, bukan dipotong. */
const BATAS_DARURAT = 50_000;
/** Panjang daftar .in() per permintaan (URL). */
const POTONG_IN = 150;

/**
 * Baca SEMUA baris sebuah kueri, berhalaman `.order('id').range()`.
 * `buat` wajib membuat kueri BARU tiap dipanggil (builder sekali pakai).
 * Melempar bila ada halaman yang gagal.
 */
export async function ambilSemuaHalaman<T>(
  label: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buat: () => any,
): Promise<T[]> {
  const kumpul: T[] = [];
  for (let ofs = 0; ; ofs += HAL) {
    const { data, error } = await buat().order("id", { ascending: true }).range(ofs, ofs + HAL - 1);
    if (error) throw new Error(`${label}: ${error.message ?? String(error)}`);
    const b = (data ?? []) as T[];
    kumpul.push(...b);
    if (b.length < HAL) break;
    if (kumpul.length >= BATAS_DARURAT) {
      throw new Error(`${label}: melebihi ${BATAS_DARURAT} baris — dihentikan, bukan dipotong`);
    }
  }
  return kumpul;
}

function potongan<T>(arr: T[], n = POTONG_IN): T[][] {
  const hasil: T[][] = [];
  for (let i = 0; i < arr.length; i += n) hasil.push(arr.slice(i, i + n));
  return hasil;
}

/** Token FT 12 karakter dari no_ref mutasi, kanonik RINGAN (huruf besar,
 *  spasi dibuang). Kanonik penuh O→0 dsb. dikerjakan PEMBACA di gadai —
 *  indeks ini menyimpan apa yang benar-benar ditulis bank. */
export function tokenFt(noRef: unknown): string | null {
  const s = String(noRef ?? "").toUpperCase().replace(/\s+/g, "");
  const m = s.match(/FT[0-9A-Z]{10}/);
  return m ? m[0] : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Baris = Record<string, any>;

const KOLOM_MUTASI =
  "id, tanggal, jam, no_ref, nominal_kredit, nominal_debet, nama_pengirim, deskripsi, claimed_by_input_id, manual_claim_reason";
const KOLOM_INPUT =
  "id, gadai_klaim_id, gadai_no_faktur, jenis, tanggal_input, nominal, match_status, matched_by, ref_issue, matched_tx_id, conflict_dates, manual_claim_reason, created_at";

const teksAtauNull = (v: unknown): string | null => {
  const s = v == null ? "" : String(v);
  return s.trim() ? s : null;
};

function keMutasi(r: Baris): BarisMutasi {
  return {
    id: String(r.id),
    tanggal: String(r.tanggal),
    jam: teksAtauNull(r.jam),
    no_ref: teksAtauNull(r.no_ref),
    kredit: Number(r.nominal_kredit ?? 0) || 0,
    debet: Number(r.nominal_debet ?? 0) || 0,
    nama_pengirim: teksAtauNull(r.nama_pengirim),
    deskripsi: teksAtauNull(r.deskripsi),
    claimed_by_input_id: r.claimed_by_input_id ? String(r.claimed_by_input_id) : null,
    manual_claim_reason: teksAtauNull(r.manual_claim_reason),
  };
}

function isoAtauAsli(v: unknown): string {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : String(v ?? "");
}

function keVerdik(r: Baris): Verdik {
  return {
    input_id: String(r.id),
    gadai_klaim_id: teksAtauNull(r.gadai_klaim_id),
    gadai_no_faktur: teksAtauNull(r.gadai_no_faktur),
    jenis: String(r.jenis ?? "").toLowerCase() === "debet" ? "debet" : "kredit",
    tanggal_input: String(r.tanggal_input),
    nominal: Number(r.nominal ?? 0) || 0,
    match_status: String(r.match_status ?? ""),
    matched_by: teksAtauNull(r.matched_by),
    ref_issue: teksAtauNull(r.ref_issue),
    matched_tx_id: r.matched_tx_id ? String(r.matched_tx_id) : null,
    conflict_dates: Array.isArray(r.conflict_dates) ? r.conflict_dates.map((x: unknown) => String(x)) : [],
    manual_claim_reason: teksAtauNull(r.manual_claim_reason),
    created_at: isoAtauAsli(r.created_at),
  };
}

/** Lebih baru = created_at lebih besar; seri dipecah id supaya pasti. */
function lebihBaru(a: Baris, b: Baris): boolean {
  const ta = Date.parse(String(a.created_at ?? "")) || 0;
  const tb = Date.parse(String(b.created_at ?? "")) || 0;
  if (ta !== tb) return ta > tb;
  return String(a.id) > String(b.id);
}

/**
 * Susun bundel data mutasi untuk tanggal-tanggal yang akan diperiksa AI.
 *
 * @param db        klien Supabase (service role) — hanya dipakai untuk SELECT
 * @param accountId akun cektransfer; SEMUA bacaan dikunci ke akun ini
 * @param tanggal   tanggal (YYYY-MM-DD) yang diperiksa; kosong = bundel kosong
 * @throws bila ada bacaan yang gagal atau tanggal tidak sah
 */
export async function susunBundel(
  db: DbBaca,
  accountId: string,
  tanggal: string[],
  opsi: OpsiBundel = {},
): Promise<Bundel> {
  if (!accountId) throw new Error("accountId kosong");
  const tgl = [...new Set(tanggal)].sort();
  for (const t of tgl) if (!POLA_TGL.test(t)) throw new Error(`tanggal tidak sah: ${t}`);
  if (tgl.length === 0) return { mutasi: [], verdik: [], ftIndex: [], cakupan: null };

  const min = tgl[0];
  const maks = tgl[tgl.length - 1];
  const dari = tambahHari(min, -(opsi.hariMundur ?? 7));
  const sampai = tambahHari(maks, opsi.hariMaju ?? 1);
  const ftDari = tambahHari(min, -(opsi.hariMundurFt ?? 60));
  const ftSampai = tambahHari(maks, opsi.hariMajuFt ?? 3);

  // ── 1. Empat bacaan yang saling lepas, sekaligus ──
  // (iad1 ↔ Singapura: tiap putaran mahal, jadi yang bisa paralel diparalelkan.)
  //
  // Bacaan ke-4 (klaim BERTANGGAL TRANSAKSI D) tidak ada di rancangan awal
  // dan wajib ada. Gadai memeriksa per tgl_transaksi, sedangkan tanggal_input
  // di sini = tanggal RESI. Resi lama memegang baris lama: SBR-10-4595
  // (transaksi 30 Sep) memakai uang 1 Sep, SJB-10-1386 (transaksi 1 Sep)
  // memakai resi 29 Jun. Keduanya lolos dari bacaan rentang DAN dari bacaan
  // pemegang baris — padahal justru merekalah yang paling perlu dilihat AI.
  // Id klaim KREDIT (TFK-/TFKM-<outlet>-YYYYMMDD-…) menanam tgl_transaksi
  // persis (diuji ke DB gadai 1 Okt 2026: 2.389/2.389 cocok). Klaim DEBET
  // (TFKD-n) tidak bertanggal, tapi tgl_transfer = tgl_transaksi pada
  // seluruh 681 klaim DEBET sejak lantai — sudah tertangkap bacaan rentang.
  const polaKlaimTgl = tgl
    .map((t) => `gadai_klaim_id.like.TFK*-${t.replace(/-/g, "")}-*`)
    .join(",");
  const [mutasiRentang, inputRentang, inputKlaimTgl, barisFt] = await Promise.all([
    ambilSemuaHalaman<Baris>("mutasi", () =>
      db.from("parsed_transactions")
        .select(KOLOM_MUTASI)
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .gte("tanggal", dari)
        .lte("tanggal", sampai)),
    ambilSemuaHalaman<Baris>("vonis (rentang)", () =>
      db.from("cek_inputs")
        .select(KOLOM_INPUT)
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .gte("tanggal_input", dari)
        .lte("tanggal_input", sampai)),
    ambilSemuaHalaman<Baris>("vonis (klaim bertanggal transaksi)", () =>
      db.from("cek_inputs")
        .select(KOLOM_INPUT)
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .or(polaKlaimTgl)),
    ambilSemuaHalaman<Baris>("indeks FT", () =>
      db.from("parsed_transactions")
        .select("id, no_ref, tanggal, nominal_kredit, nominal_debet")
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .gte("tanggal", ftDari)
        .lte("tanggal", ftSampai)
        .ilike("no_ref", "%FT%")),
  ]);

  // ── 2. Vonis yang memegang baris di tanggal yang DIPERIKSA ──
  // tanggal_input = tanggal RESI, jadi resi lama yang memegang uang hari ini
  // tidak tertangkap bacaan rentang di atas. Justru itu yang paling perlu
  // dilihat (resi bekas / uang lama).
  const idBarisDiperiksa = mutasiRentang
    .filter((m) => String(m.tanggal) >= min && String(m.tanggal) <= maks)
    .map((m) => String(m.id));
  const inputPemegang = (
    await Promise.all(
      potongan(idBarisDiperiksa).map((ids) =>
        ambilSemuaHalaman<Baris>("vonis (pemegang baris)", () =>
          db.from("cek_inputs")
            .select(KOLOM_INPUT)
            .eq("account_id", accountId)
            .is("deleted_at", null)
            .in("matched_tx_id", ids)),
      ),
    )
  ).flat();

  // ── 3. TERBARU per klaim — dari SELURUH riwayat klaim itu ──
  // Satu klaim bisa punya beberapa baris (dinilai ulang tiap unggahan). Yang
  // terbaru bisa saja di luar rentang (mis. penutupan /belum-cocok menulis
  // tanggal baris mutasi, bukan tanggal resi), jadi riwayat klaim yang
  // tersentuh dibaca utuh lalu dipilih yang terbaru — sama seperti
  // lib/laporan/tolakLintasHari.ts.
  const tersentuh = new Map<string, Baris>();
  for (const r of [...inputRentang, ...inputKlaimTgl, ...inputPemegang]) tersentuh.set(String(r.id), r);
  const klaimIds = [
    ...new Set(
      [...tersentuh.values()].map((r) => teksAtauNull(r.gadai_klaim_id)).filter((x): x is string => !!x),
    ),
  ];
  const riwayatKlaim = (
    await Promise.all(
      potongan(klaimIds).map((ids) =>
        ambilSemuaHalaman<Baris>("vonis (riwayat klaim)", () =>
          db.from("cek_inputs")
            .select(KOLOM_INPUT)
            .eq("account_id", accountId)
            .is("deleted_at", null)
            .in("gadai_klaim_id", ids)),
      ),
    )
  ).flat();
  const terbaru = new Map<string, Baris>();
  for (const r of riwayatKlaim) {
    const k = String(r.gadai_klaim_id);
    const ada = terbaru.get(k);
    if (!ada || lebihBaru(r, ada)) terbaru.set(k, r);
  }
  // Baris tanpa gadai_klaim_id (sebelum 25 Jul, atau penutupan tanpa klaim)
  // ikut apa adanya.
  const tanpaKlaim = [...tersentuh.values()].filter((r) => !teksAtauNull(r.gadai_klaim_id));

  const verdik = [...terbaru.values(), ...tanpaKlaim].map(keVerdik).sort((a, b) =>
    a.tanggal_input !== b.tanggal_input
      ? (a.tanggal_input < b.tanggal_input ? -1 : 1)
      : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );

  // ── 4. Baris mutasi yang dipegang vonis tapi di luar rentang ──
  const petaMutasi = new Map<string, BarisMutasi>();
  for (const r of mutasiRentang) petaMutasi.set(String(r.id), keMutasi(r));
  const idLuar = [
    ...new Set(verdik.map((v) => v.matched_tx_id).filter((x): x is string => !!x && !petaMutasi.has(x))),
  ];
  const barisLuar = (
    await Promise.all(
      potongan(idLuar).map((ids) =>
        ambilSemuaHalaman<Baris>("mutasi (dipegang, di luar rentang)", () =>
          db.from("parsed_transactions")
            .select(KOLOM_MUTASI)
            .eq("account_id", accountId)
            .is("deleted_at", null)
            .in("id", ids)),
      ),
    )
  ).flat();
  for (const r of barisLuar) petaMutasi.set(String(r.id), keMutasi(r));

  const mutasi = [...petaMutasi.values()].sort((a, b) =>
    a.tanggal !== b.tanggal
      ? (a.tanggal < b.tanggal ? -1 : 1)
      : String(a.jam ?? "") !== String(b.jam ?? "")
        ? (String(a.jam ?? "") < String(b.jam ?? "") ? -1 : 1)
        : a.id < b.id ? -1 : 1,
  );

  // ── 5. Indeks FT ──
  // Ditambah token FT dari SEMUA baris `mutasi` (termasuk baris lama yang
  // dipegang resi lama, di luar jendela 60 hari) — tanpa itu resi lama yang
  // FT-nya justru ADA di mutasi akan tampak "ref tidak ada di mutasi".
  const ftIndex: EntriFt[] = [];
  const sudahFt = new Set<string>();
  const tambahFt = (id: string, tanggal: string, noRef: unknown, kredit: number, debet: number) => {
    const ft = tokenFt(noRef);
    if (!ft || sudahFt.has(id)) return;
    sudahFt.add(id);
    ftIndex.push({ ft, id, tanggal, nominal: kredit > 0 ? kredit : debet, arah: kredit > 0 ? "K" : "D" });
  };
  for (const r of barisFt) {
    tambahFt(String(r.id), String(r.tanggal), r.no_ref,
      Number(r.nominal_kredit ?? 0) || 0, Number(r.nominal_debet ?? 0) || 0);
  }
  for (const m of mutasi) tambahFt(m.id, m.tanggal, m.no_ref, m.kredit, m.debet);
  ftIndex.sort((a, b) =>
    a.tanggal !== b.tanggal ? (a.tanggal < b.tanggal ? -1 : 1) : a.ft < b.ft ? -1 : a.ft > b.ft ? 1 : 0,
  );

  return { mutasi, verdik, ftIndex, cakupan: { dari, sampai } };
}
