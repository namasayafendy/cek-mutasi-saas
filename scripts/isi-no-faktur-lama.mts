// Mengisi `cek_inputs.gadai_no_faktur` untuk baris LAMA.
//
// Kolomnya baru ada 13 Agustus 2026, jadi 850 input klaim gadai yang sudah
// tersimpan tidak punya nomor kontrak — layar History > Mutasi hanya bisa
// menampilkan id klaimnya. Nomor kontraknya ada di sisi gadai, dan dua
// database ini terpisah sehingga tidak bisa di-JOIN lewat SQL.
//
// Hanya MENGISI kolom yang masih NULL. Tidak menyentuh kolom lain, tidak
// menghapus apa pun, dan bisa dijalankan ulang tanpa efek ganda.
//   npx tsx scripts/isi-no-faktur-lama.mts [--tulis]
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function env(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = b.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const ck = env(".env.local");
const gd = env("D:/aceh-gadai-syariah/.env.local");
const tulis = process.argv.includes("--tulis");

const dbCk = createClient(ck.NEXT_PUBLIC_SUPABASE_URL, ck.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const dbGd = createClient(gd.NEXT_PUBLIC_SUPABASE_URL, gd.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 1) Input yang belum punya nomor kontrak.
const perlu: { id: string; klaim: string }[] = [];
for (let ofs = 0; ; ofs += 500) {
  const { data, error } = await dbCk.from("cek_inputs")
    .select("id, gadai_klaim_id")
    .not("gadai_klaim_id", "is", null)
    .is("gadai_no_faktur", null)
    .order("id").range(ofs, ofs + 499);
  if (error) throw new Error("baca cek_inputs: " + error.message);
  const b = (data ?? []) as any[];
  perlu.push(...b.map((r) => ({ id: String(r.id), klaim: String(r.gadai_klaim_id) })));
  if (b.length < 500) break;
}
console.log(`input tanpa nomor kontrak : ${perlu.length}`);

// 2) Nomor kontraknya dari gadai.
const peta = new Map<string, string>();
const klaimIds = [...new Set(perlu.map((p) => p.klaim))];
for (let i = 0; i < klaimIds.length; i += 200) {
  const { data, error } = await dbGd.from("transfer_klaim")
    .select("id, no_faktur, jenis").in("id", klaimIds.slice(i, i + 200));
  if (error) throw new Error("baca transfer_klaim: " + error.message);
  for (const k of ((data ?? []) as any[])) {
    const nf = String(k.no_faktur ?? "").trim() || String(k.jenis ?? "").trim();
    if (nf) peta.set(String(k.id), nf);
  }
}
console.log(`ketemu nomor kontraknya   : ${peta.size} dari ${klaimIds.length} klaim`);

const bisa = perlu.filter((p) => peta.has(p.klaim));
const tidakBisa = perlu.length - bisa.length;
console.log(`akan diisi                : ${bisa.length}`);
console.log(`tidak bisa (klaim hilang) : ${tidakBisa}`);
console.log(`\ncontoh:`);
for (const p of bisa.slice(0, 5)) console.log(`  ${p.klaim} -> ${peta.get(p.klaim)}`);

if (!tulis) { console.log(`\n(uji-kering — tambahkan --tulis untuk mengisi)`); process.exit(0); }

// 3) Isi. Satu per satu supaya kegagalan satu baris tidak menjatuhkan sisanya.
let isi = 0, gagal = 0;
for (const p of bisa) {
  const { error } = await dbCk.from("cek_inputs")
    .update({ gadai_no_faktur: peta.get(p.klaim) })
    .eq("id", p.id)
    .is("gadai_no_faktur", null);        // idempoten: yang sudah terisi dilewati
  if (error) { gagal++; if (gagal <= 3) console.error("  gagal", p.id, error.message); }
  else isi++;
}
console.log(`\nterisi ${isi} baris, gagal ${gagal}.`);
