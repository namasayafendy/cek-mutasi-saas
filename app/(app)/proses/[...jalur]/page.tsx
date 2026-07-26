// ============================================================
// KANAL MASUK MUTASI — Halaman proses bertoken (Fase 1)
// File: app/(app)/proses/[...jalur]/page.tsx
//
// Dibuka dari tombol di Telegram. Berada di bawah grup (app), jadi ia TETAP
// memerlukan sesi: kalau owner belum login, middleware melemparnya ke
// /login?next=/proses/<token> dan form login sudah membaca `next`, sehingga
// ia mendarat kembali persis di sini.
//
// KENAPA TOKEN DI PATH, BUKAN QUERY: middleware hanya menyalin PATHNAME ke
// parameter `next` (lib/supabase/middleware.ts:111,116). Token di query akan
// LENYAP setelah login dan halaman mati tanpa jejak. Segmen kedua (opsional)
// adalah id rekening, dipakai saat satu berkas bisa cocok ke lebih dari satu
// rekening — dengan alasan yang sama ia ikut di path.
//
// TOKEN INI BUKAN KREDENSIAL. Bocornya tautan tidak memberi akses apa pun:
// tanpa sesi, halaman ini melempar ke /login. Itu keputusan sadar — tautan
// ajaib yang langsung login akan menjadikan setiap pesan Telegram sebagai
// kunci penuh ke seluruh data mutasi.
// ============================================================

import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getParserSpec } from "@/lib/banks/registry";
import { sha256Hex } from "@/lib/telegram/bot";
import { AutoRunner } from "./auto-runner";
import type { Outlet, Bank, MatchRulePreset } from "@/lib/types";

export const dynamic = "force-dynamic";

function Kartu({ judul, isi }: { judul: string; isi: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Proses Mutasi</h1>
      <div className="card p-5 border-amber-200 bg-amber-50">
        <h2 className="font-medium text-amber-900">{judul}</h2>
        <div className="mt-1 text-sm text-amber-800">{isi}</div>
        <Link href="/check" className="btn-primary mt-3 inline-block">
          Buka cek mutasi manual
        </Link>
      </div>
    </div>
  );
}

export default async function ProsesPage({
  params,
}: {
  params: Promise<{ jalur?: string[] }>;
}) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const { jalur } = await params;
  const token = String(jalur?.[0] ?? "");
  const bankDipilih = jalur?.[1] ? String(jalur[1]) : null;

  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return <Kartu judul="Tautan tidak sah" isi={<p>Tautan ini tidak berbentuk token yang benar.</p>} />;
  }

  const tokenHash = await sha256Hex(new TextEncoder().encode(token));

  // Dibaca dengan klien BER-SESI: RLS yang menjamin job ini milik akun kita,
  // bukan filter yang saya tulis sendiri dan bisa terlupa.
  const supabase = await createClient();
  const { data: jobRow } = await supabase
    .from("mutasi_jobs")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!jobRow) {
    return <Kartu judul="Tugas tidak ditemukan" isi={<p>Tautan sudah tidak berlaku, atau berkasnya sudah dihapus.</p>} />;
  }
  const job = jobRow as any;

  if (new Date(job.token_exp).getTime() < Date.now()) {
    return (
      <Kartu
        judul="Tautan kedaluwarsa"
        isi={<p>Tautan berlaku 24 jam. Berkasnya masih tersimpan — kirim ulang ke bot untuk mendapat tautan baru.</p>}
      />
    );
  }

  if (job.status === "SELESAI" || job.status === "SELESAI_RAGU") {
    return (
      <Kartu
        judul="Berkas ini sudah diproses"
        isi={
          <p>
            Selesai pada{" "}
            {job.selesai_at
              ? new Date(job.selesai_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
              : "-"}
            . Laporannya sudah dikirim ke Telegram.
          </p>
        }
      />
    );
  }

  // ── Bekal yang sama seperti halaman /check ──
  const [outletsRes, banksRes, rulesRes] = await Promise.all([
    supabase.from("outlets").select("*").order("urutan_palette"),
    supabase.from("banks").select("*").eq("is_active", true).order("urutan").order("created_at"),
    // SENGAJA tanpa filter jenis: halaman ini menjalankan DUA pass sekaligus.
    // Halaman /check memfilter memakai jenis awal, dan itulah sebabnya preset
    // khusus debet bisa hilang di sana setelah pindah pass.
    supabase
      .from("match_rules")
      .select("*")
      .is("deleted_at", null)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  const outlets = (outletsRes.data ?? []) as Outlet[];
  const semuaBank = (banksRes.data ?? []) as Bank[];
  const rules = (rulesRes.data ?? []) as MatchRulePreset[];

  const bank =
    semuaBank.find((b) => b.id === (bankDipilih ?? job.bank_id)) ??
    (semuaBank.length === 1 ? semuaBank[0] : undefined);

  if (!bank) {
    return (
      <Kartu
        judul="Rekening belum jelas"
        isi={<p>Berkas ini belum bisa dipasangkan ke rekening mana pun. Proses lewat menu cek mutasi manual.</p>}
      />
    );
  }
  if (getParserSpec(bank.parser_id)?.status !== "ready") {
    return (
      <Kartu
        judul="Parser rekening ini belum siap"
        isi={<p>Rekening {bank.label} memakai parser {bank.parser_id} yang belum tersedia.</p>}
      />
    );
  }
  if (outlets.length === 0 || rules.length === 0) {
    return (
      <Kartu
        judul="Persiapan belum lengkap"
        isi={<p>Perlu minimal satu outlet dan satu aturan matching sebelum mutasi bisa dicocokkan.</p>}
      />
    );
  }

  // Signed URL dibuat SETELAH sesi diverifikasi, oleh service_role — bucket
  // `mutasi-inbox` privat total dan tidak punya satu pun policy untuk anon
  // maupun authenticated.
  const admin = createAdminClient();
  const { data: tautan, error: errTautan } = await admin.storage
    .from("mutasi-inbox")
    .createSignedUrl(job.storage_path, 600);

  if (errTautan || !tautan?.signedUrl) {
    return (
      <Kartu
        judul="Berkas tidak bisa dibuka"
        isi={<p>Berkasnya tidak ditemukan di penyimpanan ({errTautan?.message ?? "tanpa keterangan"}).</p>}
      />
    );
  }

  // Catat bahwa tautannya dipakai — untuk jejak, bukan untuk memblokir.
  // Sengaja TIDAK sekali-pakai keras: kalau halaman ini di-refresh atau HP
  // terkunci di tengah jalan, owner harus tetap bisa masuk lagi. Yang menahan
  // pengiriman ganda bukan token, melainkan kunci compare-and-set di DB.
  if (!job.token_dipakai_at) {
    await admin
      .from("mutasi_jobs")
      .update({ token_dipakai_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("account_id", ctx.account.id);
  }

  return (
    <AutoRunner
      jobId={job.id}
      namaFile={job.file_name}
      urlBerkas={tautan.signedUrl}
      bank={bank}
      outlets={outlets}
      rules={rules}
      accountId={ctx.account.id}
      userId={ctx.user.id}
      gadaiSyncEnabled={(ctx.settings as { gadai_sync_enabled?: boolean } | null)?.gadai_sync_enabled ?? false}
    />
  );
}
