// Uji query patokan `sejak` PERSIS seperti yang dipakai produksi (lewat
// supabase-js, bukan SQL mentah) — pola LIKE dengan emoji gampang gagal senyap,
// dan patokan yang gagal senyap membuat laporan menjabarkan ulang semuanya.
//   npx tsx scripts/uji-patokan-sejak.mts
import { readFileSync } from "node:fs";
for (const b of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = b.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data: akun } = await db.from("mutasi_jobs").select("account_id").limit(1).maybeSingle();
const accountId = (akun as any).account_id;

const { data, error } = await db
  .from("mutasi_laporan_outbox")
  .select("id, created_at, status")
  .eq("account_id", accountId)
  .eq("status", "TERKIRIM")
  .like("teks", "🟢 LAPIS 2%")
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();

console.log("error :", error?.message ?? "-");
console.log("dapat :", data ? `outbox #${(data as any).id} · ${(data as any).created_at}` : "TIDAK ADA (sejak = null)");

// Pembanding: seluruh baris yang cocok pola, supaya kelihatan kalau polanya
// terlalu longgar (mis. ikut menangkap laporan KIRIM ULANG).
const { data: semua } = await db
  .from("mutasi_laporan_outbox")
  .select("id, status, teks")
  .eq("account_id", accountId)
  .like("teks", "🟢 LAPIS 2%")
  .order("id", { ascending: false });
console.log(`cocok pola: ${(semua ?? []).length} baris -> ${(semua ?? []).map((x: any) => "#" + x.id).join(", ")}`);
const { data: sekalian } = await db.from("mutasi_laporan_outbox")
  .select("id, teks").eq("account_id", accountId).order("id", { ascending: false }).limit(4);
console.log("\n4 baris terakhir di antrean (apa pun isinya):");
for (const x of (sekalian ?? []) as any[]) console.log(`  #${x.id} ${String(x.teks).slice(0, 45).replace(/\n/g, " ⏎ ")}`);
