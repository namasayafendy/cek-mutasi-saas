// ============================================================
// CEKTRANSFER - Pemicu PEMERIKSAAN AI (di aplikasi gadai)
// File: lib/periksaAi/pemicu.ts
//
// Setelah Lapis 2 selesai, cektransfer TIDAK memeriksa apa pun sendiri — ia
// tidak punya AI dan tidak perlu kunci AI. Tugasnya hanya:
//   1. GET status pemeriksaan di gadai (tanggal mana yang sudah diperiksa);
//   2. hitung tanggal yang perlu diperiksa (lib/periksaAi/tanggal.ts);
//   3. susun bundel data mutasi (lib/periksaAi/bundel.ts);
//   4. POST ke gadai — SELALU, walau tidak ada tanggal baru (gadai yang
//      mengirim pesan "tidak ada tanggal baru", supaya grup tidak sunyi).
//
// WAJIB BUNYI BILA GAGAL. Grup yang sunyi tidak boleh tampak sama dengan
// "bersih". Setiap kegagalan (jaringan, 404 = gadai belum di-promote,
// 401/503, 5xx, data tak terbaca) diantre ke grup laporan berbunyi
// "🤖 PEMERIKSAAN AI tidak bisa dimulai ❌". JANGAN PERNAH diawali
// "🟢 LAPIS 2" — itu jangkar "sejak" laporan Lapis 2 (proses/actions.ts).
//
// Cron cadangan (/api/cron/periksa-ai) mengulang tiap 20 menit sampai 48 jam,
// jadi pesan gagal untuk job yang sama cukup sekali per 6 jam — jejaknya
// baris mutasi_laporan_outbox itu sendiri (TANPA migrasi baru).
//
// TIDAK PERNAH MELEMPAR. Dipanggil dari after() sesudah laporan Lapis 2;
// galat di sini tidak boleh menyentuh pekerjaan yang sudah selesai.
//
// SERVER-ONLY: memakai service_role.
// ============================================================
/* eslint-disable @typescript-eslint/no-explicit-any -- jawaban JSON gadai & baris DB tanpa tipe, sama seperti outbox.ts */

import { createAdminClient } from "@/lib/supabase/admin";
import { antreLaporan } from "@/lib/telegram/outbox";
import { susunBundel, hariIniWib, POLA_TGL, type Cakupan } from "./bundel";
import { tanggalPerluDiperiksa, type StatusPeriksaGadai, type TanggalPerlu } from "./tanggal";

export type SumberPeriksa = "MUTASI" | "CRON_CADANGAN" | "MANUAL";

/** Awalan pesan gagal. Dipakai juga untuk mencari jejak de-dup di outbox. */
export const AWALAN_GAGAL = "🤖 PEMERIKSAAN AI tidak bisa dimulai ❌";
/** Pesan gagal untuk job yang sama tidak diulang dalam rentang ini. */
const JEDA_KABAR_GAGAL_JAM = 6;

const BATAS_STATUS_MS = 20_000;
const BATAS_KIRIM_MS = 25_000;

export interface KonfigGadai {
  base: string;
  key: string;
}

export interface HasilPicu {
  ok: boolean;
  /** Tahap terakhir yang dicapai (untuk log). */
  tahap: "awal" | "konfigurasi" | "status" | "tanggal" | "bundel" | "kirim" | "selesai";
  runId: number | null;
  /** ANTRI | SUDAH_ADA dari gadai. */
  statusRun: string | null;
  tanggal: string[];
  tertinggal: string[];
  sebab: string | null;
  /** true = pesan gagal diantre; false = dilewati (de-dup) / tak ada chat. */
  dikabari: boolean | null;
}

/** Buang baris baru + potong, untuk teks dari luar yang masuk pesan. */
function jinak(s: unknown, maks = 200): string {
  return String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, maks);
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function tglPendek(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1] ?? m[2]}` : iso;
}

function sebabGalat(e: unknown, detik: number): string {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return `Aceh Gadai tidak menjawab dalam ${detik} detik`;
  }
  return `gagal menghubungi Aceh Gadai (${jinak(e instanceof Error ? e.message : e, 120)})`;
}

async function bacaJawaban(res: Response): Promise<{ json: any; teks: string }> {
  const teks = await res.text().catch(() => "");
  try {
    return { json: JSON.parse(teks), teks };
  } catch {
    return { json: null, teks };
  }
}

/** Kalimat sebab untuk jawaban HTTP yang bukan sukses. */
function sebabHttp(status: number, json: any, teks: string, apa: string): string {
  const pesan = jinak(json?.msg ?? json?.error ?? json?.pesan ?? (json ? "" : teks), 160);
  const ekor = pesan ? ` — ${pesan}` : "";
  if (status === 404) {
    return `${apa}: HTTP 404 — endpoint pemeriksaan AI belum ada di Aceh Gadai (kemungkinan besar deploy gadai belum di-promote)`;
  }
  if (status === 401) return `${apa}: HTTP 401 — kunci sinkron ditolak Aceh Gadai${ekor}`;
  if (status === 503) return `${apa}: HTTP 503 — Aceh Gadai belum siap / belum dikonfigurasi${ekor}`;
  if (status === 400) return `${apa}: HTTP 400 — isi kiriman ditolak Aceh Gadai${ekor}`;
  if (status === 413) return `${apa}: HTTP 413 — kiriman terlalu besar${ekor}`;
  if (status >= 500) return `${apa}: HTTP ${status} — Aceh Gadai sedang bermasalah${ekor}`;
  return `${apa}: HTTP ${status}${ekor}`;
}

/** Periksa bentuk jawaban GET status sesuai kontrak. */
function sahkanStatus(j: any): StatusPeriksaGadai | string {
  if (!j || j.ok !== true) return `jawaban status ditolak (${jinak(j?.msg ?? j?.error ?? "ok bukan true", 120)})`;
  if (!POLA_TGL.test(String(j.lantai ?? ""))) return "jawaban status tidak sah: lantai";
  const maks = Number(j.maksTanggal);
  if (!Number.isInteger(maks) || maks < 1) return "jawaban status tidak sah: maksTanggal";
  if (!Array.isArray(j.tanggal)) return "jawaban status tidak sah: tanggal";
  if (!Array.isArray(j.jobRefs)) return "jawaban status tidak sah: jobRefs";
  const ra = j.runAktif;
  return {
    ok: true,
    lantai: String(j.lantai),
    maksTanggal: Math.min(maks, 31),
    tanggal: (j.tanggal as any[])
      .filter((t) => t && POLA_TGL.test(String(t.tgl)) && (t.status === "FINAL" || t.status === "SEMENTARA"))
      .map((t) => ({
        tgl: String(t.tgl),
        status: t.status,
        diperiksa_at: t.diperiksa_at ? String(t.diperiksa_at) : null,
        dasar_proses_at: t.dasar_proses_at ? String(t.dasar_proses_at) : null,
      })),
    jobRefs: (j.jobRefs as unknown[]).map((x) => String(x)),
    runAktif: ra && typeof ra === "object"
      ? { id: Number(ra.id), status: String(ra.status ?? ""), dibuat_at: String(ra.dibuat_at ?? "") }
      : null,
  };
}

/**
 * Baca url + kunci gadai dari account_settings (lewat admin client — pemicu
 * ini jalan tanpa sesi: dari after() dan dari cron).
 * @returns konfigurasi, atau string sebab bila belum siap. Tidak melempar.
 */
export async function bacaKonfigGadai(db: any, accountId: string): Promise<KonfigGadai | string> {
  try {
    const { data, error } = await db
      .from("account_settings")
      .select("gadai_sync_enabled, gadai_api_url, gadai_api_key")
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) return `pengaturan sinkron tidak terbaca (${jinak(error.message, 120)})`;
    const c = data as any;
    if (!c?.gadai_sync_enabled) return "sinkron Aceh Gadai tidak aktif di pengaturan cektransfer";
    if (!c.gadai_api_url || !c.gadai_api_key) return "alamat / kunci Aceh Gadai belum diisi di pengaturan cektransfer";
    return { base: String(c.gadai_api_url).replace(/\/+$/, ""), key: String(c.gadai_api_key) };
  } catch (e) {
    return `pengaturan sinkron tidak terbaca (${jinak(e instanceof Error ? e.message : e, 120)})`;
  }
}

/**
 * GET status pemeriksaan AI di gadai (timeout 20 dtk). Tidak melempar.
 */
export async function ambilStatusGadai(
  konfig: KonfigGadai,
): Promise<{ ok: true; status: StatusPeriksaGadai } | { ok: false; sebab: string }> {
  try {
    const res = await fetch(`${konfig.base}/api/transfer-klaim/periksa-ai`, {
      headers: { Authorization: `Bearer ${konfig.key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(BATAS_STATUS_MS),
    });
    const { json, teks } = await bacaJawaban(res);
    if (!res.ok) return { ok: false, sebab: sebabHttp(res.status, json, teks, "baca status") };
    const s = sahkanStatus(json);
    if (typeof s === "string") return { ok: false, sebab: s };
    return { ok: true, status: s };
  } catch (e) {
    return { ok: false, sebab: sebabGalat(e, BATAS_STATUS_MS / 1000) };
  }
}

/** Rentang tanggal job (min periodStart … max periodEnd), atau null. */
function rentangJob(job: any): Cakupan | null {
  const pass = Array.isArray(job?.ringkasan?.pass) ? job.ringkasan.pass : [];
  const awal = pass.map((p: any) => String(p?.periodStart ?? "")).filter((s: string) => POLA_TGL.test(s)).sort();
  const akhir = pass.map((p: any) => String(p?.periodEnd ?? "")).filter((s: string) => POLA_TGL.test(s)).sort();
  if (!awal.length || !akhir.length) return null;
  return { dari: awal[0], sampai: akhir[akhir.length - 1] };
}

/**
 * Antre pesan gagal ke grup laporan — sekali per job per 6 jam.
 * @returns true bila diantre, false bila dilewati. Tidak melempar.
 */
async function kabariGagal(
  db: any,
  arg: {
    accountId: string;
    jobId: string | null;
    chatId: string;
    sumber: SumberPeriksa;
    sebab: string;
    tanggal: TanggalPerlu[] | null;
    namaFile: string | null;
  },
): Promise<boolean> {
  if (!arg.chatId) {
    console.error("[periksa-ai] tidak ada chat untuk mengabari kegagalan:", arg.sebab);
    return false;
  }
  try {
    // De-dup: job yang sama sudah dikabari gagal dalam 6 jam terakhir →
    // diam. Cron cadangan mengulang tiap 20 menit; tanpa ini grup dibanjiri
    // pesan yang sama 18 kali sehari. Bacaan yang GAGAL tidak dianggap
    // "sudah dikabari" — lebih baik dua pesan daripada nol.
    if (arg.jobId) {
      const sejak = new Date(Date.now() - JEDA_KABAR_GAGAL_JAM * 3_600_000).toISOString();
      const { data, error } = await db
        .from("mutasi_laporan_outbox")
        .select("id")
        .eq("account_id", arg.accountId)
        .eq("job_id", arg.jobId)
        .gte("created_at", sejak)
        .like("teks", "🤖 PEMERIKSAAN AI tidak bisa dimulai%")
        .limit(1);
      if (!error && Array.isArray(data) && data.length > 0) return false;
    }

    const asal =
      arg.sumber === "MUTASI"
        ? `unggahan mutasi${arg.namaFile ? ` ${arg.namaFile}` : ""}`
        : arg.sumber === "CRON_CADANGAN"
          ? `pemeriksa cadangan (cron)${arg.namaFile ? ` untuk ${arg.namaFile}` : ""}`
          : "pemicu manual";
    const b: string[] = [AWALAN_GAGAL, `sebab: ${arg.sebab}`, `dipicu: ${asal}`];
    if (arg.tanggal && arg.tanggal.length) {
      b.push(`tanggal yang menunggu diperiksa: ${arg.tanggal.map((t) => tglPendek(t.tgl)).join(", ")}`);
    }
    b.push(
      arg.jobId
        ? "↻ akan dicoba lagi otomatis tiap 20 menit (sampai 48 jam setelah unggahan)."
        : "↻ tidak diulang otomatis — picu ulang secara manual.",
      "Laporan LAPIS 2 tetap berlaku; yang belum jalan hanya pemeriksaan ulang oleh AI.",
    );
    await antreLaporan({ accountId: arg.accountId, chatId: arg.chatId, teks: b.join("\n"), jobId: arg.jobId });
    return true;
  } catch (e) {
    console.error("[periksa-ai] gagal mengantre kabar gagal:", e);
    return false;
  }
}

/**
 * Picu PEMERIKSAAN AI di gadai. Tidak pernah melempar.
 *
 * @param jobId       mutasi_jobs.id pemicu (null untuk pemicu manual)
 * @param sumber      MUTASI (sesudah Lapis 2) | CRON_CADANGAN | MANUAL
 * @param statusGadai status yang sudah dibaca pemanggil (cron) — supaya tidak
 *                    GET dua kali. Kosong = dibaca di sini.
 */
export async function picuPeriksaAi(input: {
  jobId: string | null;
  sumber: SumberPeriksa;
  statusGadai?: StatusPeriksaGadai;
}): Promise<HasilPicu> {
  const hasil: HasilPicu = {
    ok: false, tahap: "awal", runId: null, statusRun: null,
    tanggal: [], tertinggal: [], sebab: null, dikabari: null,
  };
  const jobId = input.jobId && /^[0-9a-f-]{36}$/i.test(input.jobId) ? input.jobId : null;
  const accountId = String(process.env.CEKMUTASI_ACCOUNT_ID ?? "").trim();
  if (!accountId) {
    // Tanpa akun, outbox pun tak bisa dicatat. Satu-satunya yang bisa
    // dilakukan: tinggalkan jejak di log.
    hasil.sebab = "CEKMUTASI_ACCOUNT_ID belum di-set";
    console.error("[periksa-ai]", hasil.sebab);
    return hasil;
  }

  let db: any;
  try {
    db = createAdminClient();
  } catch (e) {
    hasil.sebab = `klien database tidak bisa dibuat (${jinak(e instanceof Error ? e.message : e, 120)})`;
    console.error("[periksa-ai]", hasil.sebab);
    return hasil;
  }

  let chatId = String(process.env.TG_LAPORAN_CHAT_ID ?? "").trim();
  let namaFile: string | null = null;
  let perlu: TanggalPerlu[] | null = null;

  const gagal = async (sebab: string): Promise<HasilPicu> => {
    hasil.ok = false;
    hasil.sebab = sebab;
    console.error(`[periksa-ai] ${input.sumber} job=${jobId ?? "-"} tahap=${hasil.tahap}: ${sebab}`);
    hasil.dikabari = await kabariGagal(db, {
      accountId, jobId, chatId, sumber: input.sumber, sebab, tanggal: perlu, namaFile,
    });
    return hasil;
  };

  try {
    // ── Job pemicu (milik akun ini) ──
    let rentang: Cakupan | null = null;
    if (input.jobId && !jobId) return await gagal("id tugas tidak sah");
    if (jobId) {
      const { data: job, error } = await db
        .from("mutasi_jobs")
        .select("id, file_name, tg_chat_id, ringkasan")
        .eq("id", jobId)
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) return await gagal(`tugas unggahan tidak terbaca (${jinak(error.message, 120)})`);
      if (!job) return await gagal("tugas unggahan tidak ditemukan di akun ini");
      namaFile = job.file_name ? jinak(job.file_name, 80) : null;
      // Sama dengan laporan Lapis 2: grup laporan, kalau tidak ada → chat unggahan.
      if (!chatId && job.tg_chat_id) chatId = String(job.tg_chat_id);
      rentang = rentangJob(job);
    }

    hasil.tahap = "konfigurasi";
    const konfig = await bacaKonfigGadai(db, accountId);
    if (typeof konfig === "string") return await gagal(konfig);

    hasil.tahap = "status";
    let status = input.statusGadai;
    if (!status) {
      const s = await ambilStatusGadai(konfig);
      if (!s.ok) return await gagal(s.sebab);
      status = s.status;
    }

    // Pemeriksaan lain masih ANTRI/JALAN: status tanggal di gadai belum
    // memuat hasilnya (ditandai baru sesudah laporannya terkirim). Menghitung
    // tanggal sekarang = memeriksa ulang tanggal SEMENTARA yang sama (biaya
    // dobel) dan menyebut tanggal lama "tertinggal" padahal tidak. Tunda —
    // TANPA POST dan TANPA alarm: job ini belum ada di jobRefs, jadi cron
    // cadangan menjemputnya sesudah run itu selesai, dengan status segar.
    // Sama dengan penjaga di cron; run yang macet > menitRunMacet tidak ditunggu.
    const ra = status.runAktif;
    if (ra && input.sumber !== "MANUAL") {
      const umurMenit = (Date.now() - (Date.parse(ra.dibuat_at) || 0)) / 60_000;
      if (umurMenit < CADANGAN.menitRunMacet) {
        hasil.ok = true;
        hasil.tahap = "selesai";
        hasil.statusRun = "DITUNDA";
        console.log(`[periksa-ai] ${input.sumber} job=${jobId ?? "-"} ditunda: run ${ra.id} (${ra.status}) masih aktif`);
        return hasil;
      }
    }

    hasil.tahap = "tanggal";
    let tertinggal: string[];
    try {
      const t = await tanggalPerluDiperiksa(db, accountId, status);
      perlu = t.perlu;
      tertinggal = t.tertinggal;
    } catch (e) {
      return await gagal(`daftar tanggal tidak bisa dihitung (${jinak(e instanceof Error ? e.message : e, 160)})`);
    }
    hasil.tanggal = perlu.map((t) => t.tgl);
    hasil.tertinggal = tertinggal;

    hasil.tahap = "bundel";
    let bundel;
    try {
      bundel = await susunBundel(db, accountId, hasil.tanggal);
    } catch (e) {
      return await gagal(`data mutasi tidak bisa dibaca (${jinak(e instanceof Error ? e.message : e, 160)})`);
    }
    // Bundel kosong (tidak ada tanggal baru) tetap butuh rentang: gadai
    // menyebutnya di pesan "tidak ada tanggal baru (… sudah diperiksa)".
    // Pakai rentang unggahan pemicu; tanpa job, hari ini. Dipangkas ke lantai:
    // tanggal di bawah lantai tidak pernah diperiksa AI, jadi tidak boleh
    // disebut "sudah diperiksa". Seluruhnya di bawah lantai → null (gadai
    // menulis "semua tanggal mutasi sudah diperiksa").
    let fallback: Cakupan | null = rentang ?? (jobId ? null : { dari: hariIniWib(), sampai: hariIniWib() });
    if (fallback && fallback.sampai < fallback.dari) fallback = { dari: fallback.sampai, sampai: fallback.dari };
    if (fallback && fallback.dari < status.lantai) {
      fallback = fallback.sampai < status.lantai ? null : { dari: status.lantai, sampai: fallback.sampai };
    }
    const cakupan: Cakupan | null = bundel.cakupan ?? fallback;

    hasil.tahap = "kirim";
    const body = {
      job_id: jobId,
      sumber: input.sumber,
      tanggal: perlu.map((t) => ({ tgl: t.tgl, final: t.final, dasar_proses_at: t.dasar_proses_at })),
      tertinggal,
      cakupan,
      mutasi: bundel.mutasi,
      verdik: bundel.verdik,
      ftIndex: bundel.ftIndex,
      dibuat_at: new Date().toISOString(),
    };
    const teksBody = JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(`${konfig.base}/api/transfer-klaim/periksa-ai`, {
        method: "POST",
        headers: { Authorization: `Bearer ${konfig.key}`, "Content-Type": "application/json" },
        body: teksBody,
        cache: "no-store",
        signal: AbortSignal.timeout(BATAS_KIRIM_MS),
      });
    } catch (e) {
      const dasar = sebabGalat(e, BATAS_KIRIM_MS / 1000);
      // Waktu habis ≠ pasti gagal: kirimannya bisa sudah diterima. Ulangan
      // dengan job_id sama tidak menggandakan (gadai menjawab SUDAH_ADA).
      return await gagal(
        e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") && jobId
          ? `${dasar} saat mengirim data (${Math.round(teksBody.length / 1024)} KB) — mungkin sudah diterima; ulangan tidak menggandakan`
          : dasar,
      );
    }
    const { json, teks } = await bacaJawaban(res);
    if (!res.ok || json?.ok !== true) {
      return await gagal(
        res.ok
          ? `kiriman ditolak Aceh Gadai (${jinak(json?.msg ?? json?.error ?? teks, 160)})`
          : sebabHttp(res.status, json, teks, `kirim data ${Math.round(teksBody.length / 1024)} KB`),
      );
    }

    hasil.tahap = "selesai";
    hasil.ok = true;
    hasil.runId = Number.isFinite(Number(json.run_id)) ? Number(json.run_id) : null;
    hasil.statusRun = json.status ? String(json.status) : null;
    console.log(
      `[periksa-ai] ${input.sumber} job=${jobId ?? "-"} → run ${hasil.runId ?? "?"} ${hasil.statusRun ?? ""}` +
        ` · tanggal [${hasil.tanggal.join(", ")}] · tertinggal ${tertinggal.length}` +
        ` · ${bundel.mutasi.length} mutasi · ${bundel.verdik.length} vonis · ${bundel.ftIndex.length} FT` +
        ` · ${Math.round(teksBody.length / 1024)} KB`,
    );
    return hasil;
  } catch (e) {
    return await gagal(`galat tak terduga (${jinak(e instanceof Error ? e.message : e, 160)})`);
  }
}

/** Rentang hari untuk cron cadangan — diekspor supaya cron & pesan seiya. */
export const CADANGAN = {
  /** Job yang selesai lebih lama dari ini tidak dijemput lagi. */
  jamMaks: 48,
  /** Beri pemicu utama (after()) waktu dulu sebelum cron mengambil alih. */
  menitTunggu: 5,
  /** runAktif lebih tua dari ini dianggap macet — tidak ditunggu lagi. */
  menitRunMacet: 60,
} as const;
