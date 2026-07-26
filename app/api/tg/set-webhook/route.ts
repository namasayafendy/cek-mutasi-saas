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
import { pasangWebhook, infoWebhook, copotWebhook, tgSiap } from "@/lib/telegram/bot";

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

  const rahasiaWebhook = process.env.TG_WEBHOOK_SECRET;
  if (!rahasiaWebhook) {
    return NextResponse.json(
      { ok: false, error: "TG_WEBHOOK_SECRET belum di-set. Tanpa itu webhook akan menolak semua kiriman." },
      { status: 503 },
    );
  }
  const situs = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (!situs) {
    return NextResponse.json({ ok: false, error: "NEXT_PUBLIC_SITE_URL belum di-set" }, { status: 503 });
  }

  const url = `${situs}/api/tg/webhook`;
  const hasil = await pasangWebhook(url, rahasiaWebhook);
  if (!hasil.ok) return NextResponse.json({ ok: false, error: hasil.error }, { status: 502 });

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
