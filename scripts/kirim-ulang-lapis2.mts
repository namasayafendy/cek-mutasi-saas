// Susun ULANG laporan LAPIS 2 sebuah job yang sudah selesai, memakai kode
// penyusun yang SEKARANG — lalu (opsional) antre-kan ke Telegram.
//
// TIDAK memproses mutasi, TIDAK menyentuh vonis, TIDAK menutup job apa pun.
// Yang dibaca: ringkasan job yang tersimpan + sandingan/tunggakan hidup dari
// Aceh Gadai. Yang ditulis (hanya dengan --kirim): satu baris antrean laporan.
//
//   npx tsx scripts/kirim-ulang-lapis2.mts <jobId> [--kirim]
//
// Tanpa --kirim ia mencetak teksnya dan MEMBANDINGKAN dengan teks laporan asli
// yang tersimpan di outbox. Perbandingan itu yang membuktikan susunan ulangnya
// setia: seluruh baris di luar blok yang memang diperbaiki harus sama persis.
import { readFileSync } from "node:fs";
// .env.local dibaca sendiri — repo ini tidak memasang dotenv, dan menambah
// ketergantungan hanya untuk sebuah skrip manual tidak sepadan.
for (const b of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = b.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { createClient } from "@supabase/supabase-js";
import { susunLapis2, type IsiLapis2 } from "../lib/laporan/lapis2.ts";
import { hitungCakupan, type BarisCakupan } from "../lib/coverage/celah.ts";

const LANTAI = "2026-07-22";
const jobId = process.argv[2];
const kirim = process.argv.includes("--kirim");
if (!jobId) { console.error("pakai: npx tsx scripts/kirim-ulang-lapis2.mts <jobId> [--kirim]"); process.exit(1); }

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data: job } = await db.from("mutasi_jobs")
  .select("id, account_id, bank_id, file_name, status, tg_chat_id, ringkasan, selesai_at")
  .eq("id", jobId).maybeSingle();
if (!job) { console.error("job tidak ditemukan"); process.exit(1); }

const berkas = (job as any).ringkasan?.berkas ?? {};
const pass: any[] = (job as any).ringkasan?.pass ?? [];
const kredit = pass.find((p) => p.jenis === "kredit");
const debet = pass.find((p) => p.jenis === "debet");

// Sama persis dengan jalur produksi: label dibaca ULANG dari DB, disaring
// `jinak`, dan disaring account_id — bukan diambil dari ringkasan yang tersimpan.
const jinak = (s: unknown, maks = 120) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, maks);
let bankLabel = "Rekening";
if ((job as any).bank_id) {
  const { data: bk } = await db.from("banks").select("label, kode")
    .eq("id", (job as any).bank_id).eq("account_id", (job as any).account_id).maybeSingle();
  if (bk) bankLabel = String((bk as any).label || (bk as any).kode || "Rekening");
}
bankLabel = jinak(bankLabel, 60);

// ── Patokan "baru": selesainya job SEBELUM job ini (persis aturan produksi) ──
const { data: sblm } = await db.from("mutasi_jobs")
  .select("selesai_at")
  .eq("account_id", (job as any).account_id)
  .in("status", ["SELESAI", "SELESAI_RAGU"])
  .neq("id", jobId)
  .lt("selesai_at", (job as any).selesai_at)
  .not("selesai_at", "is", null)
  .order("selesai_at", { ascending: false })
  .limit(1).maybeSingle();
const sejak = (sblm as any)?.selesai_at ? new Date((sblm as any).selesai_at).toISOString() : null;

// ── Rekap per tanggal, gabung dua arah (salinan aturan produksi) ──
const petaTgl = new Map<string, any>();
for (const p of pass) for (const x of (p.perTanggal ?? [])) {
  if (x.tgl < LANTAI) continue;
  let a = petaTgl.get(x.tgl);
  if (!a) { a = { tgl: x.tgl, jml: 0, rp: 0, masukJml: 0, masukRp: 0, keluarJml: 0, keluarRp: 0 }; petaTgl.set(x.tgl, a); }
  a.jml += x.jml; a.rp += x.rp;
  a.masukJml += Number(x.masukJml ?? 0); a.masukRp += Number(x.masukRp ?? 0);
  a.keluarJml += Number(x.keluarJml ?? 0); a.keluarRp += Number(x.keluarRp ?? 0);
}
const perTanggal = [...petaTgl.values()].sort((a, b) => (a.tgl < b.tgl ? -1 : 1));
const tidakKetemu = pass.flatMap((p) => p.tidakKetemu ?? []).filter((x: any) => x.tgl >= LANTAI)
  .sort((a: any, b: any) => (a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0));
const rowsK = (kredit?.unclaimedRows ?? []).filter((x: any) => x.tgl >= LANTAI);
const rowsD = (debet?.unclaimedRows ?? []).filter((x: any) => x.tgl >= LANTAI);

// ── Sandingan + tunggakan dari Aceh Gadai ──
const { data: cfg } = await db.from("account_settings")
  .select("gadai_sync_enabled, gadai_api_url, gadai_api_key")
  .eq("account_id", (job as any).account_id).maybeSingle();
const c: any = cfg;
let sandingan: IsiLapis2["sandingan"] = null;
let sandinganGagal: string | null = null;
let tunggakan: IsiLapis2["tunggakan"] = [];
const gagal: string[] = [];
for (const p of pass) if (p.batal) gagal.push(`${p.jenis}: ${p.batal.pesan}`);

const sDari = kredit?.periodStart ?? debet?.periodStart ?? null;
const sSampai = kredit?.periodEnd ?? debet?.periodEnd ?? null;
if (c?.gadai_sync_enabled && c.gadai_api_url && c.gadai_api_key) {
  const base = String(c.gadai_api_url).replace(/\/+$/, "");
  const H = { Authorization: `Bearer ${c.gadai_api_key}` };
  if (sDari && sSampai) {
    try {
      const res = await fetch(`${base}/api/transfer-klaim/sandingan?dari=${sDari}&sampai=${sSampai}` +
        (sejak ? `&sejak=${encodeURIComponent(sejak)}` : ""), { headers: H, cache: "no-store" });
      const j = await res.json();
      if (res.ok && j?.ok) sandingan = j; else sandinganGagal = String(j?.msg ?? `HTTP ${res.status}`);
    } catch (e) { sandinganGagal = e instanceof Error ? e.message : String(e); }
  }
  try {
    const res = await fetch(`${base}/api/transfer-klaim/tunggakan?sejak=${LANTAI}` +
      (sSampai ? `&tercakup=${sSampai}` : ""), { headers: H, cache: "no-store" });
    const j = await res.json();
    if (res.ok && j?.ok) {
      tunggakan = (j.items ?? []);
      for (const t of tunggakan as any[]) {
        try {
          const kol = String(t.arah ?? "KREDIT").toUpperCase() === "DEBET" ? "nominal_debet" : "nominal_kredit";
          const geser = (n: number) => { const d = new Date(`${t.tgl}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
          const { count } = await db.from("parsed_transactions").select("id", { count: "exact", head: true })
            .eq("account_id", (job as any).account_id).is("claimed_by_input_id", null)
            .gte("tanggal", geser(-4)).lte("tanggal", geser(4))
            .gte(kol, Math.max(1, t.nominal - 50_000)).lte(kol, t.nominal + 50_000);
          t.calonBebas = Number(count ?? 0);
        } catch { (t as any).calonBebas = null; }
      }
    } else gagal.push(`tunggakan tidak bisa dibaca: ${j?.msg ?? res.status}`);
  } catch (e) { gagal.push(`tunggakan tidak bisa dibaca: ${e instanceof Error ? e.message : String(e)}`); }
}

// ── Cakupan ──
let cakupan: any = null;
if ((job as any).bank_id) {
  const batasBawah = new Date(Date.parse((job as any).selesai_at) - 60 * 86_400_000).toISOString().slice(0, 10);
  const { data: rows } = await db.from("mutasi_coverage")
    .select("tgl_awal, tgl_akhir, saldo_awal, saldo_akhir")
    .eq("account_id", (job as any).account_id).eq("bank_id", (job as any).bank_id)
    .gte("tgl_akhir", batasBawah).order("tgl_awal", { ascending: true }).limit(500);
  if (rows && rows.length) cakupan = hitungCakupan(rows as BarisCakupan[]);
}

const isi: IsiLapis2 = {
  bankLabel, namaFile: jinak((job as any).file_name, 120),
  berkasDari: sDari, berkasSampai: sSampai,
  nilaiDari: perTanggal[0]?.tgl ?? null,
  nilaiSampai: perTanggal[perTanggal.length - 1]?.tgl ?? null,
  utuh: berkas.utuh ?? null,
  rantaiPutus: Number(berkas.rantaiPutus ?? 0),
  nyambung: berkas.nyambung ?? null,
  selisihSambungan: Number(berkas.selisihSambungan ?? 0),
  perTanggal,
  nDiuji: perTanggal.reduce((s, x) => s + x.jml, 0),
  rpDiuji: perTanggal.reduce((s, x) => s + x.rp, 0),
  nCocok: pass.reduce((s, p) => s + Number(p.cocok ?? 0), 0),
  nManual: pass.reduce((s, p) => s + Number(p.manualDinilai ?? 0), 0),
  nManualCocok: pass.reduce((s, p) => s + Number(p.manualCocok ?? 0), 0),
  tertahanGerbang: (() => {
    const ada = pass.map((p) => p.tertahanGerbang).filter(Boolean) as any[];
    if (!ada.length) return null;
    const peta = new Map<string, any>();
    for (const x of ada) for (const s of (x.perSebab ?? [])) {
      const k = String(s.sebab);
      const kini = peta.get(k) ?? { sebab: k, teks: String(s.teks ?? k), n: 0, rp: 0 };
      kini.n += Number(s.n ?? 0); kini.rp += Number(s.rp ?? 0); peta.set(k, kini);
    }
    return {
      jml: ada.reduce((s, x) => s + Number(x.jml ?? 0), 0),
      rp: ada.reduce((s, x) => s + Number(x.rp ?? 0), 0),
      perSebab: [...peta.values()].sort((a, b) => b.rp - a.rp),
      gerbangError: ada.map((x) => x.gerbangError).find(Boolean) ?? null,
    };
  })(),
  tidakKetemu,
  ditahanLuarPeriode: pass.reduce((s, p) => s + Number(p.ditahanDiLuarPeriode ?? 0), 0),
  ditahanKonflik: pass.reduce((s, p) => s + Number(p.ditahanKonflik ?? 0), 0),
  kreditNganggur: rowsK,
  sisaKreditNganggur: Math.max(0, Number(kredit?.unclaimedBelumLapor ?? rowsK.length) - rowsK.length),
  rpKreditNganggur: rowsK.reduce((s: number, x: any) => s + Number(x.nominal || 0), 0),
  debetNganggur: rowsD,
  sisaDebetNganggur: Math.max(0, Number(debet?.unclaimedBelumLapor ?? rowsD.length) - rowsD.length),
  rpDebetNganggur: rowsD.reduce((s: number, x: any) => s + Number(x.nominal || 0), 0),
  nganggurBatas: [kredit?.unclaimedBatas, debet?.unclaimedBatas]
    .filter((x): x is string => typeof x === "string" && !!x).sort()[0] ?? null,
  nganggurDiperiksa: pass.length === 0 ? false : pass.every((p) => p.unclaimedDiperiksa !== false),
  sandingan, sandinganGagal, tunggakan, gagal,
};

const teksBaru = susunLapis2(isi, { nomor: null, sebelumNomor: null, sebelumKapan: null });

// ── Bandingkan dengan laporan ASLI yang tersimpan ──
const { data: asli } = await db.from("mutasi_laporan_outbox")
  .select("id, chat_id, balas_ke, teks").eq("job_id", jobId)
  .order("id", { ascending: false }).limit(1).maybeSingle();

if (asli) {
  const a = String((asli as any).teks).split("\n");
  const b = teksBaru.split("\n");
  const setA = new Set(a), setB = new Set(b);
  const hilang = a.filter((l) => !setB.has(l) && l.trim());
  const tambah = b.filter((l) => !setA.has(l) && l.trim());
  console.log(`\n=== BEDA vs laporan asli (outbox #${(asli as any).id}) ===`);
  console.log(`baris HILANG dari laporan lama: ${hilang.length}`);
  hilang.forEach((l) => console.log(`  - ${l}`));
  console.log(`baris BARU: ${tambah.length}`);
  tambah.forEach((l) => console.log(`  + ${l}`));
  console.log(`tujuan asli: chat ${(asli as any).chat_id}, balas ke ${(asli as any).balas_ke}\n`);
}

console.log("=== TEKS YANG AKAN DIKIRIM ===");
const kepala = [
  "🔁 KIRIM ULANG — laporan di bawah adalah laporan LAPIS 2 TERAKHIR yang disusun",
  "ULANG dengan penyusun versi baru. TIDAK ada mutasi baru yang diproses dan tidak",
  "ada vonis yang berubah; angkanya sama, bentuknya yang diperbaiki.",
  "",
];
const teksKirim = kepala.join("\n") + teksBaru;
console.log(teksKirim);

if (!kirim) { console.log("\n(dry-run — tambahkan --kirim untuk mengantre ke Telegram)"); process.exit(0); }

const tujuan = String((asli as any)?.chat_id ?? (job as any).tg_chat_id ?? "");
if (!tujuan) { console.error("tujuan chat tidak diketahui"); process.exit(1); }
const { data: baris, error } = await db.from("mutasi_laporan_outbox").insert({
  account_id: (job as any).account_id,
  chat_id: tujuan,
  teks: teksKirim,
  balas_ke: null,
  job_id: null,          // bukan laporan job ini — supaya tidak dikira laporan kedua
  status: "PENDING",
}).select("id").single();
if (error) { console.error("gagal mengantre:", error.message); process.exit(1); }
console.log(`\n✅ diantre sebagai outbox #${(baris as any).id} -> chat ${tujuan}`);
console.log("   akan dikirim penguras antrean (cron tiap 30 menit, 08.00-20.00 WIB).");
