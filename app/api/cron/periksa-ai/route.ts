// ============================================================
// CEKTRANSFER - Cron cadangan PEMERIKSAAN AI
// File: app/api/cron/periksa-ai/route.ts
//
// Pemicu utama ada di tandaiSelesai (proses/actions.ts) lewat after(). Pemicu
// itu BISA hilang: browser ditutup, fungsi dihentikan platform, gadai sedang
// tumbang. Tanpa cron ini, satu unggahan yang pemicunya hilang berarti
// tanggal-tanggalnya tidak pernah diperiksa AI — dan tidak ada yang tahu,
// karena grup yang sunyi terlihat sama dengan "bersih".
//
// Tiap 20 menit: cari job SELESAI/SELESAI_RAGU yang selesai dalam 48 jam
// terakhir (dan > 5 menit lalu — beri pemicu utama waktu dulu), yang laporan
// LAPIS 2-nya ada di outbox, tapi id-nya BELUM ada di `jobRefs` gadai.
// Picu SATU per panggilan, tertua dulu. Gadai idempoten per job_id, jadi
// tumpang-tindih dengan pemicu utama tidak menggandakan pemeriksaan.
//
// Auth: Bearer CRON_SECRET (fail-closed), sama dengan mutasi-nudge.
// /api/cron/ sudah publik di middleware (lib/supabase/middleware.ts).
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ambilStatusGadai, bacaKonfigGadai, picuPeriksaAi, CADANGAN } from "@/lib/periksaAi/pemicu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const rahasia = process.env.CRON_SECRET;
  const dibawa = request.headers.get("authorization");
  // "Belum dikonfigurasi" dan "kunci salah" sengaja dibedakan — lihat
  // catatan yang sama di mutasi-nudge.
  if (!rahasia) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "CRON_SECRET belum terbaca oleh deployment ini. Isi env-nya di Vercel " +
          "lalu REDEPLOY — env baru tidak terbaca oleh deployment yang sudah jalan.",
      },
      { status: 503 },
    );
  }
  if (dibawa !== `Bearer ${rahasia}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const accountId = String(process.env.CEKMUTASI_ACCOUNT_ID ?? "").trim();
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "CEKMUTASI_ACCOUNT_ID belum di-set" }, { status: 503 });
  }

  const db = createAdminClient();
  const kini = Date.now();

  // ── 1. Job yang selesai dalam jendela ──
  // Paling banyak satu-dua job per hari; 48 jam tidak mendekati batas 1000.
  const { data: jobRows, error: errJob } = await db
    .from("mutasi_jobs")
    .select("id, selesai_at")
    .eq("account_id", accountId)
    .in("status", ["SELESAI", "SELESAI_RAGU"])
    .not("selesai_at", "is", null)
    .gte("selesai_at", new Date(kini - CADANGAN.jamMaks * 3_600_000).toISOString())
    .lte("selesai_at", new Date(kini - CADANGAN.menitTunggu * 60_000).toISOString())
    .order("selesai_at", { ascending: true })
    .limit(200);
  if (errJob) {
    console.error("[cron periksa-ai] gagal membaca mutasi_jobs:", errJob.message);
    return NextResponse.json({ ok: false, error: `mutasi_jobs: ${errJob.message}` }, { status: 500 });
  }
  const jobs = (jobRows ?? []) as { id: string; selesai_at: string }[];
  if (jobs.length === 0) return NextResponse.json({ ok: true, dipicu: null, alasan: "tidak ada job baru" });

  // ── 2. Hanya job yang laporan LAPIS 2-nya ada ──
  // (tandaiGagal tidak menerbitkan Lapis 2 — job itu bukan urusan cron ini.)
  const { data: lapRows, error: errLap } = await db
    .from("mutasi_laporan_outbox")
    .select("job_id")
    .eq("account_id", accountId)
    .in("job_id", jobs.map((j) => j.id))
    .like("teks", "🟢 LAPIS 2%")
    .limit(1000);
  if (errLap) {
    console.error("[cron periksa-ai] gagal membaca outbox:", errLap.message);
    return NextResponse.json({ ok: false, error: `outbox: ${errLap.message}` }, { status: 500 });
  }
  const adaLapis2 = new Set(((lapRows ?? []) as { job_id: string | null }[]).map((r) => String(r.job_id)));
  const calon = jobs.filter((j) => adaLapis2.has(j.id));
  if (calon.length === 0) return NextResponse.json({ ok: true, dipicu: null, alasan: "tidak ada job ber-Lapis 2" });

  // ── 3. Status di gadai ──
  const konfig = await bacaKonfigGadai(db, accountId);
  const st = typeof konfig === "string" ? ({ ok: false, sebab: konfig } as const) : await ambilStatusGadai(konfig);
  if (!st.ok) {
    // Pengaturan / status tak terbaca = tidak tahu mana yang sudah dikirim.
    // Job TUA tidak dipicu atas namanya: kemungkinan besar ia sudah diperiksa
    // & dilaporkan, dan alarm "belum jalan / akan dicoba lagi" untuknya palsu.
    // Hanya job TERBARU yang masih mungkin kehilangan pemicu after()-nya (≤ 60
    // menit) yang dipicu — pemicu membaca ulang semuanya, dan kalau tetap gagal
    // ia mengabari grup (sekali per job per 6 jam). Selebihnya cukup dicatat;
    // putaran berikut yang statusnya terbaca menyusul job yang belum terkirim.
    const terbaru = calon[calon.length - 1];
    const umurMenit = (kini - Date.parse(terbaru.selesai_at)) / 60_000;
    if (!(umurMenit <= 60)) {
      console.error(`[cron periksa-ai] status gadai tak terbaca (${st.sebab}); tidak memicu job lama — putaran berikut menyusul`);
      return NextResponse.json({ ok: false, dipicu: null, statusGagal: st.sebab }, { status: 503 });
    }
    const hasil = await picuPeriksaAi({ jobId: terbaru.id, sumber: "CRON_CADANGAN" });
    return NextResponse.json({ ok: hasil.ok, dipicu: terbaru.id, statusGagal: st.sebab, hasil });
  }

  // Pemeriksaan lain masih berjalan: tunggu putaran berikut supaya tanggal
  // yang sama tidak diperiksa (dan dibayar) dua kali. Run yang macet lebih
  // dari satu jam tidak ditunggu — gadai punya cron sendiri untuk itu.
  const ra = st.status.runAktif;
  if (ra) {
    const umurMenit = (kini - (Date.parse(ra.dibuat_at) || 0)) / 60_000;
    if (umurMenit < CADANGAN.menitRunMacet) {
      return NextResponse.json({ ok: true, dipicu: null, alasan: `menunggu run ${ra.id} (${ra.status})` });
    }
  }

  const sudah = new Set(st.status.jobRefs);
  const pilih = calon.find((j) => !sudah.has(j.id));
  if (!pilih) return NextResponse.json({ ok: true, dipicu: null, alasan: "semua job sudah dikirim" });

  const hasil = await picuPeriksaAi({ jobId: pilih.id, sumber: "CRON_CADANGAN", statusGadai: st.status });
  return NextResponse.json({ ok: hasil.ok, dipicu: pilih.id, sisa: calon.filter((j) => !sudah.has(j.id)).length - 1, hasil });
}
