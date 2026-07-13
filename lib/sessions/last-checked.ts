// Tanggal transaksi terakhir yang sudah tercakup sesi cek, per jenis.
// Dipakai dashboard (kartu "Data Terakhir Dicek") + halaman Cek (pengingat
// lanjut upload). Sumber: max(period_mutasi_end) cek_sessions — yaitu tanggal
// AKHIR periode mutasi yang dicek, bukan tanggal user membuka aplikasi.

import type { SupabaseClient } from "@supabase/supabase-js";

export type LastCheckedDates = {
  kredit: string | null; // YYYY-MM-DD
  debet: string | null;
};

export async function getLastCheckedDates(
  supabase: SupabaseClient,
): Promise<LastCheckedDates> {
  const q = (jenis: "kredit" | "debet") =>
    supabase
      .from("cek_sessions")
      .select("period_mutasi_end")
      .eq("jenis", jenis)
      .not("period_mutasi_end", "is", null)
      .order("period_mutasi_end", { ascending: false })
      .limit(1)
      .maybeSingle();

  const [k, d] = await Promise.all([q("kredit"), q("debet")]);
  return {
    kredit: (k.data as { period_mutasi_end: string } | null)?.period_mutasi_end ?? null,
    debet: (d.data as { period_mutasi_end: string } | null)?.period_mutasi_end ?? null,
  };
}

/** Tanggal hari ini di WIB sebagai "YYYY-MM-DD" (server jalan di UTC). */
export function todayISOWIB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}
