// ============================================================
// KANAL MASUK MUTASI — Pemasangan webhook (Fase 1, sekali pakai)
// File: app/api/tg/set-webhook/route.ts
//
// Telegram perlu diberi tahu ke mana mengirim pesan. Itu dilakukan sekali,
// lewat endpoint ini, bukan lewat skrip lokal — supaya URL yang didaftarkan
// selalu URL produksi yang sebenarnya, bukan URL yang ada di laptop.
//
// AUTH: x-internal-secret === AI_HUB_INTERNAL_SECRET (fail-closed).
//   Secret ini sudah ada dan sudah terpasang di produksi (dipakai endpoint
//   internal untuk AI Hub). Sengaja dipakai ulang alih-alih menambah satu
//   env admin lagi yang harus dijaga.
//
// GET  = lihat keadaan webhook sekarang (tidak mengubah apa pun)
// POST = pasang webhook
// DELETE = copot webhook
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { pasangWebhook, infoWebhook, copotWebhook, tgSiap, tokenWebhookTg } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tolak(request: NextRequest): NextResponse | null {
  // Route ini bisa MEMATIKAN kanal mutasi (DELETE mencopot webhook, dan
  // bot lalu berhenti membalas tanpa satu pun pesan galat). Kewenangan
  // sebesar itu tidak seharusnya menempel pada rahasia yang aslinya cuma
  // untuk membaca metrik. Kalau TG_ADMIN_SECRET diisi, ia yang dipakai;
  // AI_HUB_INTERNAL_SECRET hanya cadangan supaya pemasangan awal tidak macet.
  const rahasia = process.env.TG_ADMIN_SECRET || process.env.AI_HUB_INTERNAL_SECRET;
  const dibawa = request.headers.get("x-internal-secret");
  if (!rahasia || dibawa !== rahasia) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!tgSiap()) {
    return NextResponse.json({ ok: false, error: "TG_MUTASI_BOT_TOKEN belum di-set" }, { status: 503 });
  }
  return null;
}

/**
 * Alamat dasar yang dipakai MENDAFTARKAN webhook.
 *
 * Sengaja dipisah dari NEXT_PUBLIC_SITE_URL, dan itu bukan kerumitan yang
 * dicari-cari: resolver Telegram terbukti tidak bisa me-resolve
 * www.cektransfer.com (CNAME ke zona vercel-dns-017.com) walau seluruh
 * resolver publik bisa. Alamat domain Vercel bawaan dilayani DNS Vercel
 * sendiri dan selalu terjangkau.
 *
 * Webhook dan tautan tombol TIDAK harus sedomain: Telegram cukup bisa
 * menghubungi kita, sedangkan tombolnya dibuka manusia di browser.
 * Aplikasinya sama persis, jadi tidak ada perilaku yang berbeda.
 *
 * Urutan: TG_WEBHOOK_BASE_URL (kalau diisi) -> VERCEL_PROJECT_PRODUCTION_URL
 * (disuntik Vercel sendiri) -> NEXT_PUBLIC_SITE_URL.
 */
function alamatDasar(sumber?: string): { url: string; dari: string } | { error: string } {
  const rapikan = (v: string | undefined) => String(v ?? "").trim().replace(/\/+$/, "");
  const berskema = (v: string) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v);

  const pilihan: { dari: string; nilai: string }[] = [
    { dari: "TG_WEBHOOK_BASE_URL", nilai: berskema(rapikan(process.env.TG_WEBHOOK_BASE_URL)) },
    { dari: "VERCEL_PROJECT_PRODUCTION_URL", nilai: berskema(rapikan(process.env.VERCEL_PROJECT_PRODUCTION_URL)) },
    { dari: "NEXT_PUBLIC_SITE_URL", nilai: berskema(rapikan(process.env.NEXT_PUBLIC_SITE_URL)) },
  ];

  // Pemanggil boleh MEMILIH salah satu sumber, tapi tidak boleh MENGARANG
  // alamat. Kalau hostname datang dari badan permintaan, bocornya secret admin
  // berarti webhook bot bisa dialihkan ke server penyerang dan seluruh pesan
  // pemilik terbaca di sana.
  const daftar = sumber ? pilihan.filter((p) => p.dari === sumber) : pilihan;
  const kena = daftar.find((p) => p.nilai);
  if (!kena) {
    return { error: sumber ? `${sumber} kosong di server` : "Tidak ada satu pun alamat dasar yang terisi" };
  }
  return { url: kena.nilai, dari: kena.dari };
}

export async function GET(request: NextRequest) {
  const t = tolak(request);
  if (t) return t;
  const info = await infoWebhook();
  const dasar = alamatDasar();
  return NextResponse.json({
    ok: info.ok,
    webhook: info.ok ? info.hasil : null,
    error: info.ok ? undefined : info.error,
    // Diagnosa: nilai domain yang server benar-benar baca. Bukan rahasia,
    // dan tanpa ini kegagalan pendaftaran tidak bisa ditelusuri dari luar.
    alamat: {
      dipakai: "error" in dasar ? null : `${dasar.url}/api/tg/webhook`,
      dari: "error" in dasar ? null : dasar.dari,
      TG_WEBHOOK_BASE_URL: process.env.TG_WEBHOOK_BASE_URL ?? null,
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? null,
    },
  });
}

export async function POST(request: NextRequest) {
  const t = tolak(request);
  if (t) return t;

  // Bentuk yang diterima Telegram; kalau env-nya memuat karakter terlarang
  // (base64 misalnya), fungsi ini menurunkannya jadi hex. Nilai yang SAMA
  // dipakai webhook untuk memeriksa kiriman masuk.
  const rahasiaWebhook = await tokenWebhookTg();
  if (!rahasiaWebhook) {
    return NextResponse.json(
      { ok: false, error: "TG_WEBHOOK_SECRET belum di-set. Tanpa itu webhook akan menolak semua kiriman." },
      { status: 503 },
    );
  }
  // Pemanggil boleh menyebut sumber alamat ("vercel" / "situs"), bukan alamatnya.
  let sumber: string | undefined;
  try {
    const body = await request.json();
    const s = String(body?.sumber ?? "").trim();
    if (s === "vercel") sumber = "VERCEL_PROJECT_PRODUCTION_URL";
    else if (s === "situs") sumber = "NEXT_PUBLIC_SITE_URL";
    else if (s === "base") sumber = "TG_WEBHOOK_BASE_URL";
  } catch {
    /* tanpa badan permintaan = pakai urutan bawaan */
  }

  const dasar = alamatDasar(sumber);
  if ("error" in dasar) {
    return NextResponse.json({ ok: false, error: dasar.error }, { status: 503 });
  }

  const url = `${dasar.url}/api/tg/webhook`;

  // Diperiksa di sini supaya salahnya ketahuan SEBELUM Telegram, dengan kalimat
  // yang menyebut nilainya. Telegram hanya menerima https dan port 443/80/88/8443.
  let sah = false;
  try {
    const u = new URL(url);
    sah = u.protocol === "https:" && !!u.hostname && u.hostname.includes(".");
  } catch {
    sah = false;
  }
  if (!sah) {
    return NextResponse.json(
      {
        ok: false,
        error: `${dasar.dari} tidak berbentuk https://host yang sah`,
        nilaiTerbaca: dasar.url,
        urlDicoba: url,
      },
      { status: 400 },
    );
  }

  const hasil = await pasangWebhook(url, rahasiaWebhook);
  if (!hasil.ok) {
    // Sertakan URL yang DICOBA. Tanpa ini, kegagalan dari sisi Telegram tidak
    // bisa didiagnosis dari luar sama sekali — dan itu persis yang terjadi.
    return NextResponse.json(
      { ok: false, error: hasil.error, urlDicoba: url, dariEnv: dasar.dari },
      { status: 502 },
    );
  }

  const info = await infoWebhook();
  return NextResponse.json({
    ok: true,
    dipasang: url,
    dariEnv: dasar.dari,
    webhook: info.ok ? info.hasil : null,
  });
}

export async function DELETE(request: NextRequest) {
  const t = tolak(request);
  if (t) return t;
  const hasil = await copotWebhook();
  return NextResponse.json(hasil.ok ? { ok: true } : { ok: false, error: hasil.error });
}
