// ============================================================
// CEK-MUTASI SAAS - Internal Daily Inbound API (READ-ONLY)
// File: app/api/internal/daily-inbound/route.ts
//
// Endpoint server-to-server (shared secret) untuk "AI Hub" — asisten
// Telegram pribadi owner gadai. Menjawab: berapa transfer MASUK (kredit)
// di rekening pada satu tanggal, per bank/rekening.
//
// READ-ONLY: hanya SELECT parsed_transactions + banks. TIDAK menulis.
//
// PENTING (multi-tenant): endpoint ini DIKUNCI ke SATU account via env
// CEKMUTASI_ACCOUNT_ID (akun owner sendiri). account_id TIDAK diterima
// dari request — mencegah akses lintas-tenant walau secret bocor.
//
// KESEGARAN DATA: mutasi masuk lewat upload PDF rekening koran manual,
// BUKAN real-time. Response menyertakan dataSampai per bank supaya
// pemanggil bisa jujur soal usia data.
//
// Auth: header x-internal-secret === env AI_HUB_INTERNAL_SECRET (fail-closed).
//
// GET /api/internal/daily-inbound?tgl=yyyy-MM-dd
//   - tgl : opsional, default HARI INI (WIB)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // ── Auth shared secret (fail-closed) ──
    const secret = process.env.AI_HUB_INTERNAL_SECRET;
    const got = request.headers.get("x-internal-secret");
    if (!secret || got !== secret) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ── Account terkunci via env (fail-closed) ──
    const accountId = process.env.CEKMUTASI_ACCOUNT_ID;
    if (!accountId) {
      return NextResponse.json({ ok: false, error: "CEKMUTASI_ACCOUNT_ID belum di-set." }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const tgl = (searchParams.get("tgl") || "").trim()
      || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) {
      return NextResponse.json({ ok: false, error: "Format tgl harus yyyy-MM-dd." }, { status: 400 });
    }

    const db = createAdminClient();

    // Semua query EKSPLISIT difilter account_id (jangan andalkan RLS — service role bypass)
    const [{ data: bankRows, error: bankErr }, { data: txRows, error: txErr }] = await Promise.all([
      db.from("banks")
        .select("id, kode, label, is_active, recon_last_date")
        .eq("account_id", accountId),
      db.from("parsed_transactions")
        .select("bank_id, tanggal, jam, nominal_kredit, nama_pengirim, deskripsi")
        .eq("account_id", accountId)
        .eq("tanggal", tgl)
        .gt("nominal_kredit", 0)
        .order("jam", { ascending: true }),
    ]);
    if (bankErr || txErr) {
      console.error("[internal/daily-inbound]", bankErr || txErr);
      return NextResponse.json({ ok: false, error: "Query gagal." }, { status: 500 });
    }

    const bankById = new Map<string, { kode: string; label: string; dataSampai: string | null }>();
    for (const b of bankRows ?? []) {
      bankById.set(String(b.id), {
        kode: String(b.kode || ""),
        label: String(b.label || b.kode || ""),
        dataSampai: b.recon_last_date ? String(b.recon_last_date) : null,
      });
    }

    // Rekap per bank + daftar transaksi (dibatasi 100 baris terbaru)
    const perBankMap = new Map<string, { bank: string; label: string; jumlahTransaksi: number; total: number; dataSampai: string | null }>();
    let totalMasuk = 0;
    const transaksi: Array<{ bank: string; jam: string | null; nominal: number; pengirim: string; deskripsi: string }> = [];

    for (const t of txRows ?? []) {
      const b = bankById.get(String(t.bank_id));
      const bankKode = b?.kode || "?";
      const nominal = Number(t.nominal_kredit || 0);
      totalMasuk += nominal;

      let agg = perBankMap.get(bankKode);
      if (!agg) {
        agg = { bank: bankKode, label: b?.label || bankKode, jumlahTransaksi: 0, total: 0, dataSampai: b?.dataSampai ?? null };
        perBankMap.set(bankKode, agg);
      }
      agg.jumlahTransaksi += 1;
      agg.total += nominal;

      if (transaksi.length < 100) {
        transaksi.push({
          bank: bankKode,
          jam: t.jam ? String(t.jam) : null,
          nominal,
          pengirim: String(t.nama_pengirim || ""),
          deskripsi: String(t.deskripsi || "").slice(0, 120),
        });
      }
    }

    // Info kesegaran: rekening aktif yang datanya belum sampai tgl diminta
    const rekeningAktif = (bankRows ?? []).filter((b) => b.is_active);
    const belumUpload = rekeningAktif
      .filter((b) => !b.recon_last_date || String(b.recon_last_date) < tgl)
      .map((b) => ({ bank: String(b.kode || ""), label: String(b.label || ""), dataSampai: b.recon_last_date ? String(b.recon_last_date) : null }));

    return NextResponse.json({
      ok: true,
      tgl,
      totalMasuk,
      jumlahTransaksi: (txRows ?? []).length,
      perBank: [...perBankMap.values()],
      transaksi,
      rekeningBelumUpload: belumUpload,
      catatan: "Data berasal dari upload mutasi (PDF rekening koran) — bukan real-time. Cek dataSampai/rekeningBelumUpload untuk usia data.",
    });
  } catch (err) {
    console.error("[internal/daily-inbound]", err);
    return NextResponse.json({ ok: false, error: "Server error." }, { status: 500 });
  }
}
