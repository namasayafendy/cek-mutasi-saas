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

  // DUA sebab kegagalan yang berbeda dibedakan dengan sengaja.
  //
  // Versi pertama menjawab 401 untuk keduanya, dan akibatnya persis cacat yang
  // sama seperti yang ditutup di tempat lain hari ini: dari luar, "kunci belum
  // dipasang" dan "kunci salah" terlihat identik, sehingga penyebabnya harus
  // ditebak. Menyebut bahwa cron BELUM DIKONFIGURASI tidak membocorkan apa pun
  // — tidak ada rahasia untuk dibocorkan — tapi menghemat satu jam penelusuran.
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

  const accountId = process.env.CEKMUTASI_ACCOUNT_ID;
  const chatId = String(process.env.TG_MUTASI_CHAT_ID ?? "").trim();
  if (!accountId || !chatId) {
    return NextResponse.json(
      { ok: false, error: "CEKMUTASI_ACCOUNT_ID / TG_MUTASI_CHAT_ID belum di-set" },
      { status: 503 },
    );
  }

  // Mode "kuras": HANYA mengosongkan antrean, tanpa menyusun ringkasan.
  // Dipanggil tiap 30 menit di jam kerja. Tanpa ini, satu laporan yang gagal
  // terkirim baru dicoba lagi 24 jam kemudian, dan siklus 6 percobaan memakan
  // enam HARI — laporan rekonsiliasi yang datang enam hari terlambat sama
  // tidak bergunanya dengan yang hilang.
  if (request.nextUrl.searchParams.get("mode") === "kuras") {
    const hasilKuras = await kurasOutbox(30);
    return NextResponse.json({ ok: true, mode: "kuras", outbox: hasilKuras });
  }

  const db = createAdminClient();
  const hariIni = hariIniWIB();

  // Kalau ada SATU saja bacaan yang gagal, vonis hijau haram terbit.
  // "Semua mutakhir. Tidak ada tunggakan." yang terkirim padahal query-nya
  // error adalah bentuk kebohongan terburuk di sini: ia melatih pembacanya
  // untuk percaya pada pesan yang tidak memeriksa apa pun.
  const gagalBaca: string[] = [];

  // ── 1. Kuras antrean laporan ──
  const outbox = await kurasOutbox(20);

  // ── 2. Jemput job menggantung ──
  const batasGantung = new Date(Date.now() - JAM_MENGGANTUNG * 3600 * 1000).toISOString();
  const { data: gantung, error: errGantung } = await db
    .from("mutasi_jobs")
    .select("id, file_name, created_at, status, langkah")
    .eq("account_id", accountId)
    .in("status", ["ANTRI", "DIBUKA"])
    .lt("created_at", batasGantung)
    .order("created_at", { ascending: true })
    .limit(10);
  if (errGantung) gagalBaca.push(`daftar berkas menggantung (${errGantung.message})`);
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
  const { data: bankRows, error: errBank } = await db
    .from("banks")
    .select("id, kode, label")
    .eq("account_id", accountId)
    .eq("is_active", true)
    .order("urutan");
  if (errBank) gagalBaca.push(`daftar rekening (${errBank.message})`);

  const barisRekening: string[] = [];
  let adaYangPerluDitindak = false;

  // Nol rekening aktif BUKAN keadaan sehat — itu berarti tidak ada apa pun
  // yang bisa diperiksa, dan laporan hijau akan menyesatkan total.
  if (!errBank && (bankRows ?? []).length === 0) {
    gagalBaca.push("tidak ada rekening aktif sama sekali");
  }

  for (const b of ((bankRows ?? []) as any[])) {
    const batasBawah = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const { data: cov, error: errCov } = await db
      .from("mutasi_coverage")
      .select("tgl_awal, tgl_akhir, saldo_awal, saldo_akhir")
      .eq("account_id", accountId)
      .eq("bank_id", b.id)
      .gte("tgl_akhir", batasBawah)
      .order("tgl_awal", { ascending: true })
      .limit(500);

    const nama = String(b.label || b.kode || "Rekening");
    if (errCov) {
      gagalBaca.push(`cakupan ${nama} (${errCov.message})`);
      continue;
    }
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
    // Jendela yang belum penuh WAJIB disebut. Tanpa ini, hari pertama fitur
    // ini hidup akan langsung berbunyi "Tidak ada tunggakan" padahal yang
    // diketahui baru beberapa hari — dan itu jaminan palsu yang paling awal
    // dibaca pemilik.
    if (h.hariTercakup < h.jendelaHari) {
      potongan.push(`baru ${h.hariTercakup}/${h.jendelaHari} hari pernah diperiksa`);
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
      // Timeout WAJIB. Tanpa ini, gadai yang lambat menghabiskan maxDuration 60
      // detik dan seluruh cron mati SEBELUM sempat mengantre laporan apa pun —
      // bagian yang paling wajib sampai digagalkan oleh bagian yang paling
      // mungkin gagal.
      const res = await fetch(`${base}/api/transfer-klaim/coverage`, {
        headers: { Authorization: `Bearer ${c.gadai_api_key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
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
          // ── YANG DITAHAN GERBANG LAPIS 1 ──
          //
          // Bagian DARI angka "menunggu" di atas, tapi menunggunya hal yang
          // sama sekali berbeda: bukan mutasi yang belum diunggah, melainkan
          // baris Lapis 1 yang belum beres. Mengunggah PDF tidak akan
          // menyelesaikannya. Tanpa baris ini, pengingat harian menyuruh
          // mengerjakan hal yang tidak akan menggerakkan angkanya sedikit pun.
          const th = j.tertahan;
          if (th?.gerbangError) {
            adaYangPerluDitindak = true;
            barisKlaim.push(
              `🚨 Gerbang Lapis 1 di Aceh Gadai TIDAK BISA MENILAI (${String(th.gerbangError).slice(0, 120)}). ` +
                `Semua resi dilepas apa adanya — jangan anggap sudah tersaring.`,
            );
          } else if (th && !th.tidakDinilai && Number(th.jml ?? 0) > 0) {
            adaYangPerluDitindak = true;
            const sebab = (th.perSebab ?? [])
              .slice(0, 3)
              .map((s: any) => `${s.teks} ${s.n}`)
              .join(", ");
            barisKlaim.push(
              `🚧 ${th.jml} resi (${rpJt(th.rp ?? 0)}) DITAHAN Lapis 1 — tidak akan diuji ke rekening ` +
                `sampai barisnya dibereskan di Aceh Gadai${sebab ? `. Sebab: ${sebab}` : ""}.`,
            );
          }

          if (Number(j.diLuarJendela ?? 0) > 0) {
            adaYangPerluDitindak = true;
            barisKlaim.push(
              `🚨 ${j.diLuarJendela} klaim sudah TERLANJUR di luar jangkauan — ia tidak akan pernah ditarik lagi dan harus dibereskan manual.`,
            );
          }
          if (j.alarmMenua) {
            adaYangPerluDitindak = true;
            barisKlaim.push(
              `🚨 Klaim tertua sudah ${j.tarikTertuaHari} hari sejak dicatat` +
                (j.tertua?.tgl ? ` (transfer ${tglID(String(j.tertua.tgl))})` : "") +
                `. Sisa ${j.sisaHariSebelumLenyap} hari sebelum ia TIDAK ditarik lagi dan hilang dari pandangan.`,
            );
          }

          // ── PENGAWAS SILANG: apakah laporan LAPIS 1 masih hidup? ──
          //
          // Laporan Lapis 1 di aplikasi gadai adalah pembawa alarm "cron lain
          // mati". Tapi ia tidak bisa melaporkan kematiannya sendiri — dan
          // kalau seluruh aplikasi gadai tumbang, tidak ada satu pun cron di
          // sana yang bisa berteriak. Pengawas yang berada DI DALAM sistem
          // yang diawasi bukan pengawas; ia bagian dari hal yang ikut mati.
          //
          // Karena itu penilaiannya dikerjakan DI SINI, di aplikasi seberang,
          // dari angka mentah yang dikirim gadai — bukan dari vonis gadai.
          const L1 = j.lapis1 ?? {};
          if (!L1.adaDenyut) {
            adaYangPerluDitindak = true;
            barisKlaim.push(
              `🚨 Laporan LAPIS 1 BELUM PERNAH tercatat berjalan. Selama ini tidak jalan, ` +
                `tidak ada satu pun yang memeriksa apakah transaksi bank cocok dengan slipnya.`,
            );
          } else if (Number(L1.jamDiam ?? 0) > 30) {
            adaYangPerluDitindak = true;
            barisKlaim.push(
              `🚨 Laporan LAPIS 1 DIAM ${L1.jamDiam} jam` +
                (L1.nomorTerakhir ? ` (terakhir #${L1.nomorTerakhir}, periode ${L1.periodeTerakhir})` : "") +
                `. Ia yang membawa alarm cron lain — kalau ia mati, alarmnya ikut mati.`,
            );
          } else if (L1.terakhirOk === false) {
            adaYangPerluDitindak = true;
            barisKlaim.push(
              `⚠️ Laporan LAPIS 1 berjalan tapi GAGAL terkirim` +
                (L1.nomorTerakhir ? ` (terakhir sukses #${L1.nomorTerakhir})` : "") +
                `. Periksa grup Telegram-nya.`,
            );
          }
        }
      } else {
        adaYangPerluDitindak = true;
        // 404 hampir selalu berarti repo gadai belum di-promote. Menyebutnya
        // apa adanya menghemat satu jam penelusuran.
        barisKlaim.push(
          res.status === 404
            ? "⚠️ Endpoint cakupan Aceh Gadai belum ada (HTTP 404) — kemungkinan besar deploy gadai belum di-promote"
            : `⚠️ Tidak bisa menghubungi Aceh Gadai (HTTP ${res.status})`,
        );
      }
    }
  } catch (e) {
    console.error("[nudge] gagal membaca cakupan klaim gadai:", e);
    adaYangPerluDitindak = true;
    const sebab = e instanceof Error && e.name === "TimeoutError" ? "tidak menjawab dalam 8 detik" : "gagal dihubungi";
    barisKlaim.push(`⚠️ Daftar klaim di Aceh Gadai ${sebab} — jumlah tunggakan TIDAK diperiksa hari ini`);
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
  if (outbox.rusak) {
    gagalBaca.push(`antrean laporan (${outbox.rusak})`);
  } else if (outbox.tertahan > 0 || outbox.menyerah > 0) {
    adaYangPerluDitindak = true;
    b.push(`⚠️ Laporan tertahan: ${outbox.tertahan} menunggu, ${outbox.menyerah} menyerah`);
  }
  b.push("────────────");
  if (gagalBaca.length > 0) {
    // Vonis hijau HANYA boleh keluar kalau semua bacaan berhasil. Kalau
    // pemeriksaannya sendiri gagal, katakan begitu — jangan pernah menyamarkan
    // "saya tidak bisa memeriksa" jadi "tidak ada masalah".
    b.push(`⛔ SAYA TIDAK BISA MEMERIKSA SEPENUHNYA: ${gagalBaca.join("; ")}`);
    b.push("Jangan anggap laporan ini sebagai jaminan.");
  } else {
    b.push(adaYangPerluDitindak ? "Ada yang perlu ditindak di atas." : "Semua mutakhir. Tidak ada tunggakan.");
  }

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
