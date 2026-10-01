// ============================================================
// CEKTRANSFER - Tanggal mana yang perlu diperiksa AI
// File: lib/periksaAi/tanggal.ts
//
// Satu unggahan mutasi mencakup 2–4 hari, dan export saling tumpang-tindih:
// satu tanggal bisa dicakup beberapa unggahan. Yang diperiksa AI bukan
// "tanggal di berkas ini", melainkan SEMUA tanggal yang sudah diproses
// Lapis 2 tapi belum diperiksa AI dengan data yang sama segarnya.
//
// FINAL vs SEMENTARA. Klaim tanggal D baru lahir pada D+1 (cron keluar
// 01:25 WIB, cron masuk 02:30–06:30 WIB). Jadi tanggal D baru FINAL kalau ada
// unggahan yang mencakup D dan dibuat ≥ 07:00 WIB hari D+1 — 07:00 WIB D+1
// itu persis 00:00 UTC D+1. Unggahan yang dibuat 00:00–07:00 WIB hari D+1
// menjadikan D SEMENTARA: diperiksa, tapi akan diperiksa ulang begitu
// unggahan berikutnya mencakupnya.
//
// Unggahan yang dibuat PADA hari D sendiri (WIB) TIDAK menjadikan D kandidat:
// klaim D belum lahir sama sekali (data hidup: 0 dari 1.234 klaim sejak 1 Sep
// lahir di hari transaksinya sebelum 21:00), jadi pemeriksaannya hanya
// membayar AI untuk "masuk 0 resi — ✅ beres" palsu.
//
// Job SELESAI_RAGU yang salah satu pass-nya batal SEBELUM mencocokkan
// (TARIK_GAGAL, KIRIM_GAGAL sungguhan, MUTASI_TIDAK_UTUH, RANTAI_PUTUS, …)
// tetap menjadikan tanggalnya kandidat, tapi TIDAK BOLEH menjadikannya FINAL:
// vonis Lapis 2 arah itu basi/kosong. Unggahan bersih berikutnya yang
// memfinalkannya.
//
// Kandidat dihitung dari mutasi_jobs SELESAI/SELESAI_RAGU (bukan
// mutasi_coverage — cakupan dicatat SEBELUM pass berjalan, jadi tidak
// membuktikan pencocokan sudah jalan). Rentang per job = min/max
// ringkasan.pass[].periodStart/periodEnd, sama dengan SQL di peta survei.
//
// BACA-SAJA. Gagal membaca = melempar; pemanggil yang berbunyi.
// ============================================================

import { ambilSemuaHalaman, hariIniWib, tambahHari, POLA_TGL, type DbBaca } from "./bundel";

/** Satu tanggal di jawaban GET {gadai}/api/transfer-klaim/periksa-ai. */
export interface StatusTanggalGadai {
  tgl: string;
  status: "FINAL" | "SEMENTARA";
  diperiksa_at: string | null;
  dasar_proses_at: string | null;
}

/** Jawaban GET {gadai}/api/transfer-klaim/periksa-ai (kontrak SPEK). */
export interface StatusPeriksaGadai {
  ok: true;
  /** Tanggal < lantai tidak pernah diperiksa otomatis. */
  lantai: string;
  /** Maksimum tanggal per pemeriksaan. */
  maksTanggal: number;
  /** 120 hari terakhir. */
  tanggal: StatusTanggalGadai[];
  /** job_ref yang sudah pernah dikirim (14 hari terakhir). */
  jobRefs: string[];
  runAktif: { id: number; status: string; dibuat_at: string } | null;
}

export interface TanggalPerlu {
  tgl: string;
  final: boolean;
  /** max(selesai_at) unggahan yang mencakup tanggal ini. */
  dasar_proses_at: string;
}

export interface OpsiTanggal {
  /** Pengganti "hari ini" (YYYY-MM-DD, WIB) — untuk uji. */
  hariIni?: string;
}

/**
 * Jendela belakang. Gadai hanya mengembalikan status 120 hari terakhir;
 * tanggal yang lebih tua dari itu akan tampak "belum pernah diperiksa"
 * dan tersangkut selamanya di daftar "tidak diperiksa". 100 < 120 memberi
 * jarak aman. Tanggal setua itu toh sudah lama dibereskan tangan.
 */
const JENDELA_HARI = 100;
/** Rem kalau ringkasan sebuah job memuat rentang yang tak masuk akal. */
const MAKS_RENTANG_JOB_HARI = 62;

type Kandidat = { final: boolean; dasarMs: number };

/** Batal yang tidak merusak vonis: memang tidak ada yang perlu dicocokkan. */
const BATAL_JINAK = new Set(["TIDAK_ADA_KLAIM", "PERIODE_KOSONG"]);

/** Pass ini boleh ikut memfinalkan tanggal? (tidak batal, atau batalnya jinak) */
function batalJinak(kode: unknown, pesan: unknown): boolean {
  const k = String(kode ?? "");
  if (!k || k === "null") return true; // pass tidak batal
  if (BATAL_JINAK.has(k)) return true;
  // "sudah pernah dikirim" = vonisnya sudah sampai di jalan sebelumnya.
  return k === "KIRIM_GAGAL" && /sudah pernah dikirim/i.test(String(pesan ?? ""));
}

/**
 * @returns `perlu` (≤ maksTanggal tanggal TERBARU, urut naik) dan
 *   `tertinggal` (sisanya, urut naik — dilaporkan gadai, tidak diperiksa).
 * @throws bila mutasi_jobs gagal dibaca atau status gadai tidak sah
 */
export async function tanggalPerluDiperiksa(
  db: DbBaca,
  accountId: string,
  statusGadai: StatusPeriksaGadai,
  opsi: OpsiTanggal = {},
): Promise<{ perlu: TanggalPerlu[]; tertinggal: string[] }> {
  if (!accountId) throw new Error("accountId kosong");
  if (!POLA_TGL.test(String(statusGadai?.lantai ?? ""))) {
    throw new Error(`lantai dari Aceh Gadai tidak sah: ${String(statusGadai?.lantai)}`);
  }
  const maksTanggal = Math.max(1, Math.floor(Number(statusGadai.maksTanggal) || 0));

  const hariIni = opsi.hariIni ?? hariIniWib();
  const batasJendela = tambahHari(hariIni, -JENDELA_HARI);
  const lantai = statusGadai.lantai > batasJendela ? statusGadai.lantai : batasJendela;

  // Job yang dibuat sebelum 00:00 WIB hari lantai tidak mungkin memuat
  // transaksi bertanggal ≥ lantai (export tidak memuat hari esok).
  const sejak = new Date(Date.parse(`${lantai}T00:00:00+07:00`)).toISOString();

  const jobs = await ambilSemuaHalaman<Record<string, unknown>>("mutasi_jobs", () =>
    db.from("mutasi_jobs")
      .select(
        "id, created_at, selesai_at, " +
          "ps0:ringkasan->pass->0->>periodStart, pe0:ringkasan->pass->0->>periodEnd, " +
          "ps1:ringkasan->pass->1->>periodStart, pe1:ringkasan->pass->1->>periodEnd, " +
          "ps2:ringkasan->pass->2->>periodStart, pe2:ringkasan->pass->2->>periodEnd, " +
          "bk0:ringkasan->pass->0->batal->>kode, bm0:ringkasan->pass->0->batal->>pesan, " +
          "bk1:ringkasan->pass->1->batal->>kode, bm1:ringkasan->pass->1->batal->>pesan, " +
          "bk2:ringkasan->pass->2->batal->>kode, bm2:ringkasan->pass->2->batal->>pesan",
      )
      .eq("account_id", accountId)
      .in("status", ["SELESAI", "SELESAI_RAGU"])
      .not("selesai_at", "is", null)
      .gte("created_at", sejak),
  );

  const kandidat = new Map<string, Kandidat>();
  for (const j of jobs) {
    const dibuatMs = Date.parse(String(j.created_at ?? ""));
    const selesaiMs = Date.parse(String(j.selesai_at ?? ""));
    if (!Number.isFinite(dibuatMs) || !Number.isFinite(selesaiMs)) continue;

    const awal = [j.ps0, j.ps1, j.ps2].map(String).filter((s) => POLA_TGL.test(s)).sort();
    const akhir = [j.pe0, j.pe1, j.pe2].map(String).filter((s) => POLA_TGL.test(s)).sort();
    if (!awal.length || !akhir.length) continue;
    let d0 = awal[0];
    const d1 = akhir[akhir.length - 1];
    if (d1 < d0) continue;
    if (d0 < tambahHari(d1, -MAKS_RENTANG_JOB_HARI)) d0 = tambahHari(d1, -MAKS_RENTANG_JOB_HARI);
    const bolehFinal = batalJinak(j.bk0, j.bm0) && batalJinak(j.bk1, j.bm1) && batalJinak(j.bk2, j.bm2);

    for (let d = d0 < lantai ? lantai : d0; d <= d1 && d <= hariIni; d = tambahHari(d, 1)) {
      // Klaim D belum lahir sebelum 00:00 WIB D+1 — unggahan hari D bukan dasar
      // pemeriksaan D (tidak jadi kandidat, tidak menggeser dasar_proses_at).
      if (dibuatMs < Date.parse(`${tambahHari(d, 1)}T00:00:00+07:00`)) continue;
      const k = kandidat.get(d) ?? { final: false, dasarMs: 0 };
      // ≥ 07:00 WIB hari D+1  ⇔  ≥ 00:00 UTC hari D+1.
      if (bolehFinal && dibuatMs >= Date.parse(`${tambahHari(d, 1)}T00:00:00Z`)) k.final = true;
      if (selesaiMs > k.dasarMs) k.dasarMs = selesaiMs;
      kandidat.set(d, k);
    }
  }

  const diGadai = new Map<string, StatusTanggalGadai>();
  for (const t of statusGadai.tanggal ?? []) if (t && POLA_TGL.test(String(t.tgl))) diGadai.set(String(t.tgl), t);

  const calon: TanggalPerlu[] = [];
  for (const [tgl, k] of kandidat) {
    const g = diGadai.get(tgl);
    // FINAL di gadai = selesai, tidak diperiksa lagi.
    if (g?.status === "FINAL") continue;
    // SEMENTARA di gadai: lewati kalau pemeriksaannya sudah memakai data
    // yang sama segarnya DAN kandidatnya pun belum final. Kandidat yang KINI
    // final selalu diperiksa ulang.
    //
    // Patokan "segar" = dasar_proses_at pemeriksaan itu (data yang benar-
    // benar ia baca) bila ada; diperiksa_at hanya cadangan. diperiksa_at
    // saja bisa menipu: unggahan yang selesai SELAMA AI bekerja punya
    // selesai_at < diperiksa_at, padahal datanya tidak pernah dibaca AI.
    if (g?.status === "SEMENTARA" && !k.final) {
      const patokan = Date.parse(String(g.dasar_proses_at ?? "")) || Date.parse(String(g.diperiksa_at ?? ""));
      if (Number.isFinite(patokan) && patokan >= k.dasarMs) continue;
    }
    calon.push({ tgl, final: k.final, dasar_proses_at: new Date(k.dasarMs).toISOString() });
  }

  // Yang terbaru didahulukan: tanggal paling segar paling berguna dibaca
  // pagi ini. Sisanya disebut, tidak didiamkan.
  calon.sort((a, b) => (a.tgl < b.tgl ? 1 : a.tgl > b.tgl ? -1 : 0));
  const perlu = calon.slice(0, maksTanggal).sort((a, b) => (a.tgl < b.tgl ? -1 : 1));
  const tertinggal = calon.slice(maksTanggal).map((c) => c.tgl).sort();
  return { perlu, tertinggal };
}
