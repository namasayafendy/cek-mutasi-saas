// ============================================================
// KANAL MASUK MUTASI — Antrean laporan Telegram (Fase 3)
// File: lib/telegram/outbox.ts
//
// ATURAN: CATAT DULU, BARU KIRIM.
//
// Mengirim langsung terasa lebih sederhana, dan itulah jebakannya: kalau
// panggilan ke Telegram gagal — jaringan, rate limit, gangguan di sana —
// laporannya hilang permanen dan tidak ada seorang pun yang tahu. Bukan
// kekhawatiran teoretis: 12 Juli lalu di aplikasi gadai, 10 alert RAGU
// lenyap persis begini, dan baru ketahuan jauh belakangan.
//
// Dengan mencatat lebih dulu, kegagalan kirim hanya menunda — tidak
// menghapus. Cron berikutnya mengambil yang masih PENDING.
//
// SERVER-ONLY: memakai service_role.
// ============================================================

import { createAdminClient } from "@/lib/supabase/admin";
import { kirimPesan } from "@/lib/telegram/bot";

const MAKS_PERCOBAAN = 6;

export interface AntreLaporanInput {
  accountId: string;
  chatId: string | number;
  teks: string;
  balasKe?: number | null;
  jobId?: string | null;
}

/**
 * Catat laporan lalu coba kirim sekali. Tidak pernah melempar:
 * gagal mengabari tidak boleh menggagalkan pekerjaan yang sudah selesai.
 *
 * @returns terkirim = berhasil sampai sekarang juga; false = masuk antrean.
 */
export async function antreLaporan(input: AntreLaporanInput): Promise<{ terkirim: boolean; id: number | null }> {
  const db = createAdminClient();

  let id: number | null = null;
  try {
    const { data, error } = await db
      .from("mutasi_laporan_outbox")
      .insert({
        account_id: input.accountId,
        chat_id: String(input.chatId),
        teks: input.teks,
        balas_ke: input.balasKe ?? null,
        job_id: input.jobId ?? null,
        status: "PENDING",
      })
      .select("id")
      .single();
    if (error) throw error;
    id = Number((data as any).id);
  } catch (e) {
    // Bahkan pencatatannya pun gagal. Jangan menelan: coba kirim langsung
    // supaya laporannya tetap punya kesempatan sampai.
    console.error("[outbox] gagal mencatat, kirim langsung:", e);
    const r = await kirimPesan(input.chatId, input.teks, { balasKe: input.balasKe ?? undefined });
    return { terkirim: r.ok, id: null };
  }

  const kirim = await kirimPesan(input.chatId, input.teks, { balasKe: input.balasKe ?? undefined });
  await tandai(db, id, kirim.ok, kirim.ok ? null : ("error" in kirim ? kirim.error : "gagal"));
  return { terkirim: kirim.ok, id };
}

/** Jeda di antara bagian laporan ke chat yang sama — Telegram meminta tidak
 *  lebih dari satu pesan per detik per chat; yang melanggar ditolak 429. */
const JEDA_ANTAR_BAGIAN_MS = 1_100;
const jeda = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pengganti DB / pengirim / jeda — HANYA untuk skrip uji (DB tiruan). Jalur
 *  produksi tidak pernah mengisinya: service_role + Telegram sungguhan. */
export interface AlatOutbox {
  db?: any;
  kirim?: typeof kirimPesan;
  jedaMs?: number;
}

/**
 * Antre BEBERAPA pesan yang harus sampai BERURUTAN — laporan Lapis 2 yang
 * dipecah karena melewati batas Telegram (pecahPesanLapis2). Tidak pernah
 * melempar. Satu bagian saja = antreLaporan apa adanya.
 *
 * SEMUA bagian dicatat dalam SATU insert sebelum ada yang dikirim. Fungsi
 * yang mati di tengah (batas waktu) tidak boleh meninggalkan bagian ekor yang
 * tidak pernah tercatat — justru di ekor itulah baris tanpa pemilik yang
 * sudah distempel berada. Yang sudah tercatat dikirim penguras antrean.
 *
 * Dikirim satu per satu menurut urutan, BERHENTI pada kegagalan pertama:
 * bagian sesudahnya tetap PENDING dan dikirim penguras sesuai urutan id,
 * bukan mendahului bagian yang tertahan.
 *
 * @returns berapa bagian yang terkirim seketika, dan id antreannya.
 */
export async function antreLaporanBerurutan(
  input: Omit<AntreLaporanInput, "teks"> & { teks: string[] },
  alat: AlatOutbox = {},
): Promise<{ terkirim: number; ids: number[] }> {
  const bagian = input.teks.filter((t) => typeof t === "string" && t.length > 0);
  if (bagian.length === 0) return { terkirim: 0, ids: [] };
  if (bagian.length === 1) {
    const r = await antreLaporan({ ...input, teks: bagian[0] });
    return { terkirim: r.terkirim ? 1 : 0, ids: r.id === null ? [] : [r.id] };
  }
  const db = alat.db ?? createAdminClient();
  const kirimSatu = alat.kirim ?? kirimPesan;
  const jedaMs = alat.jedaMs ?? JEDA_ANTAR_BAGIAN_MS;
  const balasKe = input.balasKe ?? undefined;

  let ids: number[] = [];
  try {
    const { data, error } = await db
      .from("mutasi_laporan_outbox")
      .insert(bagian.map((teks) => ({
        account_id: input.accountId,
        chat_id: String(input.chatId),
        teks,
        balas_ke: input.balasKe ?? null,
        job_id: input.jobId ?? null,
        status: "PENDING",
      })))
      .select("id");
    if (error) throw error;
    // bigserial dibagikan menurut urutan baris VALUES — id terkecil = bagian 1.
    ids = ((data ?? []) as any[]).map((d) => Number(d.id)).sort((a, b) => a - b);
  } catch (e) {
    // Pencatatan gagal: jangan menelan — kirim langsung, tetap berurutan.
    console.error("[outbox] gagal mencatat laporan berurutan, kirim langsung:", e);
    let n = 0;
    for (let i = 0; i < bagian.length; i++) {
      if (i > 0) await jeda(jedaMs);
      const r = await kirimSatu(input.chatId, bagian[i], { balasKe });
      if (!r.ok) break;
      n++;
    }
    return { terkirim: n, ids: [] };
  }

  // Insert berhasil tapi id tidak bisa dipasangkan ke bagiannya: barisnya
  // SUDAH tercatat PENDING, jadi biarkan penguras yang mengirim — mengirim
  // langsung di sini akan menggandakan setiap bagian.
  if (ids.length !== bagian.length) {
    console.error(`[outbox] ${ids.length} id untuk ${bagian.length} bagian — diserahkan ke penguras antrean`);
    return { terkirim: 0, ids };
  }
  let terkirim = 0;
  for (let i = 0; i < bagian.length; i++) {
    if (i > 0) await jeda(jedaMs);
    const kirim = await kirimSatu(input.chatId, bagian[i], { balasKe });
    await tandai(db, ids[i], kirim.ok, kirim.ok ? null : ("error" in kirim ? kirim.error : "gagal"));
    if (!kirim.ok) break;
    terkirim++;
  }
  return { terkirim, ids };
}

async function tandai(db: any, id: number, berhasil: boolean, error: string | null) {
  try {
    if (berhasil) {
      await db
        .from("mutasi_laporan_outbox")
        .update({ status: "TERKIRIM", terkirim_at: new Date().toISOString(), error_text: null })
        .eq("id", id);
    } else {
      // percobaan dinaikkan lewat RPC-less read-modify-write; cukup karena
      // hanya satu cron yang menyentuh antrean ini.
      const { data } = await db
        .from("mutasi_laporan_outbox")
        .select("percobaan")
        .eq("id", id)
        .maybeSingle();
      const n = Number((data as any)?.percobaan ?? 0) + 1;
      await db
        .from("mutasi_laporan_outbox")
        .update({
          percobaan: n,
          error_text: String(error ?? "").slice(0, 300),
          status: n >= MAKS_PERCOBAAN ? "GAGAL" : "PENDING",
        })
        .eq("id", id);
    }
  } catch (e) {
    console.error("[outbox] gagal menandai:", e);
  }
}

/**
 * Kirim ulang yang masih tertahan. Dipanggil cron.
 * @returns jumlah terkirim, masih tertahan, dan yang menyerah.
 */
export async function kurasOutbox(
  batas = 20,
  alat: AlatOutbox = {},
): Promise<{ terkirim: number; tertahan: number; menyerah: number; rusak: string | null }> {
  const db = alat.db ?? createAdminClient();
  const kirimSatu = alat.kirim ?? kirimPesan;
  const jedaMs = alat.jedaMs ?? JEDA_ANTAR_BAGIAN_MS;
  const hasil = { terkirim: 0, tertahan: 0, menyerah: 0, rusak: null as string | null };

  // `id` sebagai pemecah seri: bagian laporan yang dicatat antreLaporanBerurutan
  // lahir dalam SATU insert, jadi created_at-nya sama persis — tanpa id,
  // urutan kirim bagian 1/3, 2/3, 3/3 diserahkan pada untung-untungan.
  const { data, error } = await db
    .from("mutasi_laporan_outbox")
    .select("id, chat_id, teks, balas_ke, percobaan, job_id")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(batas);

  // Antrean yang TIDAK BISA DIBACA jangan dilaporkan sebagai "0 tertahan" —
  // nol karena tidak terbaca dan nol karena memang kosong terlihat sama persis
  // di ringkasan harian, padahal yang satu berarti laporan sedang menumpuk
  // tanpa ada yang tahu.
  if (error) {
    console.error("[outbox] gagal membaca antrean:", error);
    hasil.rusak = error.message;
    return hasil;
  }

  // Job+chat yang salah satu pesannya gagal di putaran ini: pesan berikutnya
  // dari job yang sama ditahan sampai putaran berikut, supaya bagian 3/3 tidak
  // pernah mendahului bagian 2/3 yang masih tertahan.
  const macet = new Set<string>();
  let sebelumnya: string | null = null;
  for (const row of ((data ?? []) as any[])) {
    const kunci = row.job_id ? `${row.chat_id}|${row.job_id}` : null;
    if (kunci && macet.has(kunci)) { hasil.tertahan++; continue; }
    // Jeda hanya di antara pesan job yang SAMA (bagian laporan yang dipecah)
    // — antrean campuran tidak diperlambat.
    if (kunci && kunci === sebelumnya) await jeda(jedaMs);
    const kirim = await kirimSatu(String(row.chat_id), String(row.teks), {
      balasKe: row.balas_ke ? Number(row.balas_ke) : undefined,
    });
    await tandai(db, Number(row.id), kirim.ok, kirim.ok ? null : ("error" in kirim ? kirim.error : "gagal"));
    sebelumnya = kunci;
    if (!kirim.ok && kunci) macet.add(kunci);
    if (kirim.ok) hasil.terkirim++;
    else if (Number(row.percobaan) + 1 >= MAKS_PERCOBAAN) hasil.menyerah++;
    else hasil.tertahan++;
  }
  return hasil;
}
