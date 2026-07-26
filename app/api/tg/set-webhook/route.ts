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

export async function GET(request: NextRequest) {
  const t = tolak(request);
  if (t) return t;
  const info = await infoWebhook();
  return NextResponse.json(info.ok ? { ok: true, webhook: info.hasil } : { ok: false, error: info.error });
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
  // .trim() BUKAN hiasan: satu spasi atau baris baru yang ikut ter-paste saat
  // mengisi env di Vercel membuat URL-nya cacat, dan Telegram menolaknya dengan
  // "Failed to resolve host" — pesan yang sama sekali tidak menunjuk ke sebabnya.
  const situs = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (!situs) {
    return NextResponse.json({ ok: false, error: "NEXT_PUBLIC_SITE_URL belum di-set" }, { status: 503 });
  }

  const url = `${situs}/api/tg/webhook`;

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
        error: "NEXT_PUBLIC_SITE_URL tidak berbentuk https://host yang sah",
        nilaiTerbaca: situs,
        urlDicoba: url,
      },
      { status: 400 },
    );
  }

  const hasil = await pasangWebhook(url, rahasiaWebhook);
  if (!hasil.ok) {
    // Sertakan URL yang DICOBA. Tanpa ini, kegagalan dari sisi Telegram tidak
    // bisa didiagnosis dari luar sama sekali — dan itu persis yang terjadi.
    return NextResponse.json({ ok: false, error: hasil.error, urlDicoba: url }, { status: 502 });
  }

  const info = await infoWebhook();
  return NextResponse.json({
    ok: true,
    dipasang: url,
    webhook: info.ok ? info.hasil : null,
  });
}

export async function DELETE(request: NextRequest) {
  const t = tolak(request);
  if (t) return t;
  const hasil = await copotWebhook();
  return NextResponse.json(hasil.ok ? { ok: true } : { ok: false, error: hasil.error });
}
