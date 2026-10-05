// ============================================================
// CEKTRANSFER - Tautan LAPORAN WEB (lembar L2-n di aplikasi gadai)
// File: lib/laporan/lembarWeb.ts
//
// Sesudah laporan Lapis 2 disusun, gadai diminta membuat halaman beku untuk
// laporan itu (POST {gadai}/api/lembar/lapis2) dan tautannya disisipkan di
// BARIS KE-3 pesan — tepat di bawah dua baris kepala. Baris pertama WAJIB
// tetap diawali "🟢 LAPIS 2": itu jangkar LIKE patokan "sejak" laporan
// berikutnya (proses/actions.ts) dan cron periksa-ai.
//
// Dipakai tandaiSelesai (proses/actions.ts) dan scripts/kirim-ulang-lapis2.mts.
// Sengaja TIDAK di berkas "use server": setiap fungsi async yang diekspor dari
// berkas semacam itu menjadi endpoint publik.
//
// TIDAK PERNAH MELEMPAR dan TIDAK PERNAH DIAM: kegagalan apa pun (404 = gadai
// belum di-promote, kunci ditolak, waktu habis, jawaban aneh) menjadi baris
// "TIDAK BISA DIBUAT" beserta sebabnya. Pesan tanpa baris ini tidak bisa
// dibedakan dari pesan versi lama — pemilik akan mengira fiturnya belum ada,
// bukan rusak.
// ============================================================

import type { RingkasLapis2 } from "./lapis2";
import type { Tercakup } from "../coverage/tercakup";

/**
 * Batas menunggu POST /api/lembar/lapis2. Rute gadai sengaja menjawab seketika
 * (barisnya dibuat, isinya disusun SESUDAH jawaban terkirim), jadi 20 detik
 * sudah longgar — dan di tandaiSelesai panggilan ini terjadi SESUDAH job
 * ditutup, di depan antrean laporan: menunggu terlalu lama berarti
 * mempertaruhkan laporannya.
 */
export const BATAS_LEMBAR = 20_000;

/** Buang baris baru + potong — teks dari luar yang masuk pesan Telegram. */
function jinak(s: unknown, maks = 120): string {
  return String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, maks);
}

/**
 * Halaman /lembar terbuka TANPA login, dan sisi gadai menyimpan label bank
 * apa adanya. Nomor rekening di dalam label hanya boleh tampil 4 digit akhir
 * (RENCANA_WEB_KURUNGAN, "data tersamar").
 */
export function samarkanRekening(s: string): string {
  return s.replace(/\d(?:[\d .-]*\d)?/g, (m) => {
    const angka = m.replace(/\D/g, "");
    return angka.length >= 5 ? "••" + angka.slice(-4) : m;
  });
}

/**
 * Minta gadai membuat lembar L2-n, kembalikan SATU baris untuk pesannya.
 *
 * @param konfig {base, key} gadai, atau string sebab kalau belum siap
 *   (bentuk jawaban bacaKonfigGadai).
 * @param o.tercakup patokan dari bacaTercakupAkun — HARUS objek yang sama
 *   dengan yang dikirim ke /tunggakan untuk laporan ini, supaya isi kurungan
 *   di halaman web = daftar BELUM BERES di pesannya. null = tidak dikirim.
 */
export async function buatLembarLapis2(
  konfig: { base: string; key: string } | string,
  o: { jobId: string; dari: string | null; sampai: string | null; tercakup: Tercakup | null;
       bankLabel: string; ringkas: RingkasLapis2 },
  batasMs: number = BATAS_LEMBAR,
): Promise<string> {
  const gagal = (sebab: string) => `📊 Laporan web TIDAK BISA DIBUAT (${jinak(sebab, 160)})`;
  try {
    if (typeof konfig === "string") return gagal(konfig);
    const res = await fetch(`${konfig.base}/api/lembar/lapis2`, {
      method: "POST",
      headers: { Authorization: `Bearer ${konfig.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: o.jobId,
        periodeDari: o.dari,
        periodeSampai: o.sampai,
        tercakup: o.tercakup?.tercakup ?? null,
        tercakupAt: o.tercakup?.tercakupAt ?? null,
        ringkas: { bank: samarkanRekening(o.bankLabel), ...o.ringkas },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(batasMs),
    });
    const j = (await res.json().catch(() => null)) as { ok?: unknown; kode?: unknown; url?: unknown; msg?: unknown } | null;
    if (!res.ok) {
      const pesan = j?.msg ? ` — ${jinak(j.msg, 100)}` : "";
      if (res.status === 404) return gagal("HTTP 404, endpoint belum ada di Aceh Gadai — kemungkinan belum di-promote");
      if (res.status === 401) return gagal(`HTTP 401, kunci sinkron ditolak Aceh Gadai${pesan}`);
      if (res.status === 503) return gagal(`HTTP 503, Aceh Gadai belum dikonfigurasi${pesan}`);
      return gagal(`HTTP ${res.status}${pesan}`);
    }
    // URL & kode masuk pesan Telegram apa adanya — bentuknya diperiksa dulu.
    const kode = String(j?.kode ?? "");
    const url = String(j?.url ?? "");
    if (j?.ok !== true || !/^L2-\d+$/.test(kode) || !/^https?:\/\/\S+$/.test(url) || url.length > 300) {
      return gagal(`jawaban Aceh Gadai tidak dikenali${j?.msg ? ` — ${jinak(j.msg, 100)}` : ""}`);
    }
    return `📊 Laporan web ${kode}: ${url}`;
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      return gagal(`Aceh Gadai tidak menjawab dalam ${Math.round(batasMs / 1000)} detik`);
    }
    return gagal(`gagal menghubungi Aceh Gadai: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Sisipkan baris tautan di BARIS KE-3 teks laporan Lapis 2 (sesudah dua
 *  baris kepala). Pesan yang terpotong 4000 karakter tetap membawanya. */
export function sisipkanBarisLembar(teksLapis2: string, baris: string): string {
  const L = teksLapis2.split("\n");
  L.splice(2, 0, baris);
  return L.join("\n");
}
