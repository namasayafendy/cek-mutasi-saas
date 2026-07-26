// ============================================================
// KANAL MASUK MUTASI — Helper Telegram (Fase 1)
// File: lib/telegram/bot.ts
//
// MANDIRI: tidak mengimpor apa pun dari repo aceh-gadai. Polanya disalin
// dari sana (lib/telegram.ts) supaya perilakunya seragam, tapi kodenya
// berdiri sendiri — dua aplikasi yang saling impor akan saling mengunci
// saat salah satunya berubah.
//
// BOT YANG DIPAKAI: bot laporan pemilik (TG_MUTASI_BOT_TOKEN), chat pribadi.
// Aplikasi gadai memakai bot yang sama untuk MENGIRIM; di sini ia juga
// MENERIMA. Catatan jujur: token jadi berada di dua aplikasi, jadi permukaan
// bertambah. Rencana Fase 3 adalah bot penerima dengan tokennya sendiri.
//
// SEMUA fungsi di sini FAIL-CLOSED: kalau env belum diisi, ia mengembalikan
// kegagalan yang bisa dibaca — bukan melempar diam-diam di tengah webhook.
// ============================================================

const API = "https://api.telegram.org";

/** Batas keras Telegram Bot API untuk mengunduh berkas: 20 MB. */
export const BATAS_UNDUH_BYTE = 20 * 1024 * 1024;

export type HasilTg<T = unknown> = { ok: true; hasil: T } | { ok: false; error: string };

function ambilToken(): string | null {
  const t = process.env.TG_MUTASI_BOT_TOKEN;
  return t && t.trim() ? t.trim() : null;
}

/** Apakah kanal Telegram sudah dikonfigurasi? Dipakai untuk fail-closed di route. */
export function tgSiap(): boolean {
  return !!ambilToken();
}

async function tgCall<T = any>(method: string, payload: Record<string, unknown>): Promise<HasilTg<T>> {
  const token = ambilToken();
  if (!token) return { ok: false, error: "TG_MUTASI_BOT_TOKEN belum di-set" };
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      const desc = json?.description ? String(json.description) : `HTTP ${res.status}`;
      console.error(`[tg] ${method} gagal:`, desc);
      return { ok: false, error: desc };
    }
    return { ok: true, hasil: json.result as T };
  } catch (err) {
    console.error(`[tg] ${method} galat jaringan:`, err);
    return { ok: false, error: String(err) };
  }
}

// ── Tombol ────────────────────────────────────────────────────────────────
export interface TombolInline {
  text: string;
  /** Tombol tautan. Fase 1 HANYA memakai ini — tidak ada tombol callback,
   *  supaya tidak ada keputusan finansial yang bisa ditekan dari chat. */
  url?: string;
  callback_data?: string;
}

export function tombolBaris(baris: TombolInline[][]) {
  return { inline_keyboard: baris };
}

// ── Kirim pesan ───────────────────────────────────────────────────────────
export interface OpsiKirim {
  /** Balas ke pesan tertentu, supaya satu kiriman = satu utas. */
  balasKe?: number;
  tombol?: ReturnType<typeof tombolBaris>;
  tanpaNotifikasi?: boolean;
}

/**
 * Kirim pesan TEKS POLOS — sengaja tanpa parse_mode.
 *
 * Alasannya bukan kemalasan: isi pesan memuat NAMA BERKAS yang datang dari
 * luar (dinamai sendiri oleh pengirim). Dengan MarkdownV2, satu tanda kurung
 * atau garis bawah di nama berkas membuat Telegram menolak seluruh pesan —
 * artinya laporan bisa hilang gara-gara nama file. Teks polos tidak bisa gagal
 * karena isinya.
 */
export async function kirimPesan(
  chatId: number | string,
  teks: string,
  opsi: OpsiKirim = {},
): Promise<HasilTg<{ message_id: number }>> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    // Telegram menolak pesan > 4096 karakter.
    text: teks.length > 4000 ? teks.slice(0, 3990) + "\n… (dipotong)" : teks,
    disable_notification: opsi.tanpaNotifikasi ?? false,
    link_preview_options: { is_disabled: true },
  };
  if (opsi.balasKe) {
    payload.reply_parameters = { message_id: opsi.balasKe, allow_sending_without_reply: true };
  }
  if (opsi.tombol) payload.reply_markup = opsi.tombol;
  return tgCall<{ message_id: number }>("sendMessage", payload);
}

// ── Berkas ────────────────────────────────────────────────────────────────
export interface BerkasTg {
  buffer: ArrayBuffer;
  contentType: string;
  filePath: string;
}

/**
 * Unduh berkas dari Telegram.
 *
 * `batasByte` adalah jaring pengaman kedua: pemanggil WAJIB sudah memeriksa
 * `document.file_size` sebelum memanggil ini (supaya berkas raksasa ditolak
 * tanpa pernah diunduh). Pemeriksaan di sini menangkap kasus file_size bohong
 * atau tidak ada.
 */
export async function unduhBerkas(
  fileId: string,
  batasByte: number = BATAS_UNDUH_BYTE,
): Promise<HasilTg<BerkasTg>> {
  const token = ambilToken();
  if (!token) return { ok: false, error: "TG_MUTASI_BOT_TOKEN belum di-set" };

  const info = await tgCall<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!info.ok) return { ok: false, error: info.error };

  const filePath = info.hasil?.file_path;
  if (!filePath) return { ok: false, error: "Telegram tidak memberi file_path" };

  const ukuranLapor = Number(info.hasil?.file_size ?? 0);
  if (ukuranLapor > batasByte) {
    return { ok: false, error: `Berkas ${ukuranLapor} byte melebihi batas ${batasByte}` };
  }

  try {
    const res = await fetch(`${API}/file/bot${token}/${filePath}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `Gagal unduh berkas (HTTP ${res.status})` };

    // Jangan percaya Content-Length saja — periksa ukuran nyata setelah dibaca.
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > batasByte) {
      return { ok: false, error: `Berkas ${buffer.byteLength} byte melebihi batas ${batasByte}` };
    }
    return {
      ok: true,
      hasil: {
        buffer,
        contentType: res.headers.get("content-type") || "application/octet-stream",
        filePath,
      },
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Pengelolaan webhook (dipanggil sekali saat pemasangan) ────────────────
export async function pasangWebhook(url: string, secretToken: string): Promise<HasilTg> {
  return tgCall("setWebhook", {
    url,
    secret_token: secretToken,
    // 'callback_query' sudah diizinkan sejak sekarang supaya Fase 3 (tombol
    // Ulangi) tidak perlu memasang ulang webhook. Di Fase 1 webhook-nya
    // mengabaikannya secara sadar, bukan diam-diam.
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
}

export async function infoWebhook(): Promise<HasilTg> {
  return tgCall("getWebhookInfo", {});
}

export async function copotWebhook(): Promise<HasilTg> {
  return tgCall("deleteWebhook", { drop_pending_updates: false });
}

// ── Bantu-bantu ───────────────────────────────────────────────────────────

/** sha256 heksadesimal dari isi berkas — kunci anti kirim-ulang. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? new Uint8Array(data).buffer : data;
  const digest = await crypto.subtle.digest("SHA-256", buf as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Ukuran berkas yang enak dibaca manusia di pesan Telegram. */
export function ukuranManusiawi(byte: number): string {
  if (byte < 1024) return `${byte} B`;
  if (byte < 1024 * 1024) return `${(byte / 1024).toFixed(0)} KB`;
  return `${(byte / (1024 * 1024)).toFixed(1)} MB`.replace(".", ",");
}
