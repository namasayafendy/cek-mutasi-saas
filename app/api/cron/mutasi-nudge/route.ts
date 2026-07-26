// ============================================================
// KANAL MASUK MUTASI — Penyapu & pengingat harian (Fase 2 + 3)
// File: app/api/cron/mutasi-nudge/route.ts
//
// INI JAWABAN ATAS RISIKO TERBESAR SELURUH RANCANGAN.
//
// Rancangan ini memangkas 11 langkah jadi 2, tapi tidak mengeluarkan pemilik
// dari jalur. Kalau minggu depan sibuk, PDF-nya bisa juga tidak pernah
// dikirim — dan inilah bagian berbahayanya: tanpa upload tidak ada laporan
// buruk, sehingga sistem terasa tenang persis seperti 25 hari kemarin.
// Otomatisasi yang menyembunyikan KETIADAAN data lebih berbahaya daripada
// tidak ada otomatisasi sama sekali.
//
// Karena itu cron ini berbunyi berdasarkan USIA DATA, bukan berdasarkan
// adanya temuan. Diam bukan lagi tanda aman.
//
// Tiga tugasnya:
//   1. Kuras antrean laporan yang gagal terkirim.
//   2. Jemput job yang menggantung (tombolnya tidak pernah diketuk).
//   3. Kirim ringkasan harian yang menyebut usia data + rentang export siap
//      salin — TETAP dikirim walau semuanya beres, supaya bot yang mati
//      bisa ketahuan dari kesenyapannya.
//
// Auth: Bearer CRON_SECRET (fail-closed). Vercel Cron mengirim header itu.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { antreLaporan, kurasOutbox } from "@/lib/telegram/outbox";
import {
  hitungCakupan, saranExport, tglID, hariIniWIB, selisihHari,
  type BarisCakupan,
} from "@/lib/coverage/celah";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Job yang dibuat lebih lama dari ini tapi belum selesai = menggantung. */
const JAM_MENGGANTUNG = 6;
/** Usia mutasi yang masih dianggap wajar sebelum diingatkan. */
const HARI_WAJAR = 2;

export async function GET(request: NextRequest) {
  const rahasia = process.env.CRON_SECRET;
  const dibawa = request.headers.get("authorization");
  if (!rahasia || dibawa !== `Bearer ${rahasia}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const accountId = process.env.CEKMUTASI_ACCOUNT_ID;
  const chatId = String(process.env.TG_MUTASI_CHAT_ID ?? "").trim();
  if (!accountId || !chatId) {
    return NextResponse.json(
      { ok: false, error: "CEKMUTASI_ACCOUNT_ID / TG_MUTASI_CHAT_ID belum di-set" },
      { status: 503 },
    );
  }

  const db = createAdminClient();
  const hariIni = hariIniWIB();

  // ── 1. Kuras antrean laporan ──
  const outbox = await kurasOutbox(20);

  // ── 2. Jemput job menggantung ──
  const batasGantung = new Date(Date.now() - JAM_MENGGANTUNG * 3600 * 1000).toISOString();
  const { data: gantung } = await db
    .from("mutasi_jobs")
    .select("id, file_name, created_at, status, langkah")
    .eq("account_id", accountId)
    .in("status", ["ANTRI", "DIBUKA"])
    .lt("created_at", batasGantung)
    .order("created_at", { ascending: true })
    .limit(10);
  const jobGantung = (gantung ?? []) as any[];

  // Job yang sudah lewat masa berlaku tautannya ditandai KEDALUWARSA supaya
  // tidak ikut dihitung terus. Berkasnya TETAP disimpan — dengan tombol
  // Ulangi, ia masih bisa diproses tanpa kirim ulang dari BSINet.
  const batasToken = new Date().toISOString();
  await db
    .from("mutasi_jobs")
    .update({ status: "KEDALUWARSA" })
    .eq("account_id", accountId)
    .in("status", ["ANTRI", "DIBUKA"])
    .lt("token_exp", batasToken);

  // ── 3. Usia data per rekening ──
  const { data: bankRows } = await db
    .from("banks")
    .select("id, kode, label")
    .eq("account_id", accountId)
    .eq("is_active", true)
    .order("urutan");

  const barisRekening: string[] = [];
  let adaYangPerluDitindak = false;

  for (const b of ((bankRows ?? []) as any[])) {
    const batasBawah = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const { data: cov } = await db
      .from("mutasi_coverage")
      .select("tgl_awal, tgl_akhir, saldo_awal, saldo_akhir")
      .eq("account_id", accountId)
      .eq("bank_id", b.id)
      .gte("tgl_akhir", batasBawah)
      .order("tgl_awal", { ascending: true })
      .limit(500);

    const nama = String(b.label || b.kode || "Rekening");
    const rows = (cov ?? []) as BarisCakupan[];
    if (rows.length === 0) {
      barisRekening.push(`• ${nama}: belum ada mutasi tercatat sama sekali`);
      adaYangPerluDitindak = true;
      continue;
    }

    const h = hitungCakupan(rows, hariIni);
    const umur = h.umurHari ?? 0;
    const potongan: string[] = [`• ${nama}: terbaca s/d ${tglID(h.akhir!)}`];
    if (umur > HARI_WAJAR) {
      potongan.push(`sudah ${umur} hari`);
      adaYangPerluDitindak = true;
    }
    if (h.celah.length > 0) {
      const c = h.celah[0];
      potongan.push(
        `⛔ bolong ${tglID(c.dari)}${c.dari === c.sampai ? "" : ` s/d ${tglID(c.sampai)}`}` +
          (h.celah.length > 1 ? ` (+${h.celah.length - 1} lagi)` : ""),
      );
      adaYangPerluDitindak = true;
    }
    barisRekening.push(potongan.join(" · "));

    if (umur > HARI_WAJAR || h.celah.length > 0) {
      const s = saranExport(h.akhir, hariIni);
      barisRekening.push(`   Export BSINet: ${tglID(s.dari)} s/d ${tglID(s.sampai)}`);
    }
  }

  // ── 4. Klaim yang menunggu di sisi Aceh Gadai ──
  //
  // Tanpa langkah ini, ringkasan harian hanya tahu tentang mutasi — padahal
  // yang menentukan ada-tidaknya selisih justru klaim yang menunggu di
  // seberang. Dan ada batas keras yang mudah terlupa: penarik klaim hanya
  // melihat 60 hari ke belakang, jadi klaim yang lebih tua lenyap dari
  // pandangan sambil tetap PENDING selamanya.
  const barisKlaim: string[] = [];
  try {
    const { data: cfg } = await db
      .from("account_settings")
      .select("gadai_api_url, gadai_api_key, gadai_sync_enabled")
      .eq("account_id", accountId)
      .maybeSingle();
    const c = cfg as any;
    if (c?.gadai_sync_enabled && c.gadai_api_url && c.gadai_api_key) {
      const base = String(c.gadai_api_url).replace(/\/+$/, "");
      const res = await fetch(`${base}/api/transfer-klaim/coverage`, {
        headers: { Authorization: `Bearer ${c.gadai_api_key}` },
        cache: "no-store",
      });
      if (res.ok) {
        const j = await res.json();
        if (j?.ok) {
          const p = j.pending ?? {};
          const rpJt = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
          if ((p.total ?? 0) > 0) {
            barisKlaim.push(
              `• Menunggu di Aceh Gadai: ${p.kredit?.jml ?? 0} masuk (${rpJt(p.kredit?.total ?? 0)}), ` +
                `${p.debet?.jml ?? 0} keluar (${rpJt(p.debet?.total ?? 0)})`,
            );
          }
          if (j.alarmMenua) {
            adaYangPerluDitindak = true;
            barisKlaim.push(
              `🚨 Klaim tertua sudah ${j.tertua?.hari} hari (${tglID(String(j.tertua?.tgl ?? ""))}). ` +
                `Lewat ${j.batasTarikHari} hari ia TIDAK akan ditarik lagi dan hilang dari pandangan.`,
            );
          }
        }
      } else {
        barisKlaim.push(`⚠️ Tidak bisa menghubungi Aceh Gadai (HTTP ${res.status})`);
      }
    }
  } catch (e) {
    console.error("[nudge] gagal membaca cakupan klaim gadai:", e);
    barisKlaim.push("⚠️ Gagal membaca daftar klaim di Aceh Gadai");
  }

  // ── Susun pesan ──
  const b: string[] = [];
  if (jobGantung.length > 0) {
    adaYangPerluDitindak = true;
    b.push(`⏳ ${jobGantung.length} berkas belum selesai diproses:`);
    for (const j of jobGantung.slice(0, 5)) {
      const umurJam = Math.round((Date.now() - new Date(j.created_at).getTime()) / 3_600_000);
      b.push(`   • ${String(j.file_name).slice(0, 60)} (${umurJam} jam, tahap: ${j.langkah ?? "belum dibuka"})`);
    }
    b.push("   Buka lagi tautannya, atau kirim ulang berkasnya.");
    b.push("");
  }

  b.push(`📅 Ringkasan mutasi — ${tglID(hariIni)}`);
  b.push(...barisRekening);
  b.push(...barisKlaim);
  if (outbox.tertahan > 0 || outbox.menyerah > 0) {
    adaYangPerluDitindak = true;
    b.push(`⚠️ Laporan tertahan: ${outbox.tertahan} menunggu, ${outbox.menyerah} menyerah`);
  }
  b.push("────────────");
  b.push(adaYangPerluDitindak ? "Ada yang perlu ditindak di atas." : "Semua mutakhir. Tidak ada tunggakan.");

  // SELALU dikirim, walau semuanya beres. Kalau pesan ini yang hilang, itu
  // sendiri sudah jadi isyarat bahwa ada yang mati — dan itulah gunanya.
  const kirim = await antreLaporan({ accountId, chatId, teks: b.join("\n") });

  return NextResponse.json({
    ok: true,
    outbox,
    jobGantung: jobGantung.length,
    adaYangPerluDitindak,
    laporanTerkirim: kirim.terkirim,
  });
}
