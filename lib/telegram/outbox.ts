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
): Promise<{ terkirim: number; tertahan: number; menyerah: number; rusak: string | null }> {
  const db = createAdminClient();
  const hasil = { terkirim: 0, tertahan: 0, menyerah: 0, rusak: null as string | null };

  const { data, error } = await db
    .from("mutasi_laporan_outbox")
    .select("id, chat_id, teks, balas_ke, percobaan")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
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

  for (const row of ((data ?? []) as any[])) {
    const kirim = await kirimPesan(String(row.chat_id), String(row.teks), {
      balasKe: row.balas_ke ? Number(row.balas_ke) : undefined,
    });
    await tandai(db, Number(row.id), kirim.ok, kirim.ok ? null : ("error" in kirim ? kirim.error : "gagal"));
    if (kirim.ok) hasil.terkirim++;
    else if (Number(row.percobaan) + 1 >= MAKS_PERCOBAAN) hasil.menyerah++;
    else hasil.tertahan++;
  }
  return hasil;
}
