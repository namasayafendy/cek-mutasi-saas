// ============================================================
// KANAL MASUK MUTASI — Webhook penerima berkas (Fase 1)
// File: app/api/tg/webhook/route.ts
//
// Owner share PDF mutasi dari BSINet ke chat pribadi bot. Route ini
// menyimpan berkasnya dan membuat SATU TUGAS. Ia tidak mem-parse apa pun
// dan TIDAK PERNAH menulis ke parsed_transactions.
//
// PRINSIP KEAMANAN YANG MENENTUKAN:
//   Seandainya seluruh gerbang di bawah jebol dan seseorang berhasil
//   menyuntikkan PDF palsu, yang ia dapat hanyalah sebuah baris tugas
//   menganggur. Tugas itu tidak akan pernah dieksekusi tanpa owner login
//   dan menekan tombol — dan tombolnya menampilkan nama berkas, rekening,
//   serta periode sebelum jalan. Tidak ada jalur "Telegram → data mutasi"
//   yang tidak melewati mata dan sesi owner.
//
// GERBANG:
//   1. Header X-Telegram-Bot-Api-Secret-Token cocok (FAIL-CLOSED: env kosong
//      = tolak semuanya).
//   2. chat.type = 'private' DAN chat.id = TG_MUTASI_CHAT_ID.
//   3. from.id = chat.id. Di chat pribadi keduanya memang sama; kalau suatu
//      hari bot dimasukkan ke grup, gerbang 2 sudah menolak lebih dulu dan
//      gerbang ini menjadi lapis kedua.
//   4. Hanya PDF/HTML, <= 20 MB, dan sha256 yang sudah pernah masuk ditolak.
//
// Chat lain: DICATAT ke log, TIDAK dibalas — jangan memberi tahu penyerang
// bahwa endpoint ini hidup.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  kirimPesan,
  tombolBaris,
  unduhBerkas,
  sha256Hex,
  ukuranManusiawi,
  tgSiap,
  tokenWebhookTg,
  BATAS_UNDUH_BYTE,
} from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "mutasi-inbox";
const JAM_TOKEN_HIDUP = 24;
/** Batas kiriman per hari per chat — jaring anti banjir. */
const MAKS_BERKAS_PER_HARI = 20;

/** Selalu 200 supaya Telegram tidak mengulang kiriman yang sama berulang kali. */
function sudah(catatan?: string) {
  return NextResponse.json({ ok: true, catatan: catatan ?? null });
}

function tanggalWIB(iso: string | null | undefined): string {
  if (!iso) return "belum ada";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function berkasSah(namaFile: string, mime: string): boolean {
  const n = namaFile.toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || m === "text/html") return true;
  // Sebagian klien Telegram mengirim octet-stream; jangan tolak berkas yang
  // benar hanya karena kliennya malas menebak mime.
  if (m === "application/octet-stream" || m === "") {
    return n.endsWith(".pdf") || n.endsWith(".html") || n.endsWith(".htm");
  }
  return false;
}

export async function POST(request: NextRequest) {
  // ── Gerbang 1: secret token (FAIL-CLOSED) ──
  // Dibandingkan dengan bentuk yang SAMA seperti saat didaftarkan — lihat
  // tokenWebhookTg(). Kalau di sini memakai env mentah sementara pendaftaran
  // memakai bentuk turunan, pendaftaran akan berhasil tapi setiap kiriman
  // ditolak 401 dan kanalnya mati tanpa satu pun pesan galat.
  const rahasia = await tokenWebhookTg();
  const dibawa = request.headers.get("x-telegram-bot-api-secret-token");
  if (!rahasia || dibawa !== rahasia) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: any = null;
  try {
    update = await request.json();
  } catch {
    return sudah("bukan JSON");
  }

  // Fase 1 belum punya tombol callback (tombolnya bertipe tautan). Diabaikan
  // secara SADAR dan dicatat — bukan diam-diam hilang.
  if (update?.callback_query) {
    console.warn("[tg] callback_query diabaikan (Fase 1 belum memakainya)");
    return sudah("callback diabaikan");
  }

  const msg = update?.message;
  if (!msg) return sudah("bukan pesan");

  // ── Gerbang 2 & 3: chat pribadi milik owner ──
  const chatDiizinkan = String(process.env.TG_MUTASI_CHAT_ID ?? "").trim();
  const chatId = String(msg.chat?.id ?? "");
  const dariId = String(msg.from?.id ?? "");
  if (
    !chatDiizinkan ||
    msg.chat?.type !== "private" ||
    chatId !== chatDiizinkan ||
    dariId !== chatId
  ) {
    console.warn("[tg] pesan ditolak", {
      chatId, dariId, tipe: msg.chat?.type, adaDoc: !!msg.document,
    });
    return sudah("chat tidak diizinkan");
  }

  if (!tgSiap()) {
    console.error("[tg] TG_MUTASI_BOT_TOKEN belum di-set — tidak bisa membalas");
    return sudah("bot belum dikonfigurasi");
  }

  const accountId = process.env.CEKMUTASI_ACCOUNT_ID;
  if (!accountId) {
    await kirimPesan(chatId, "⚠️ CEKMUTASI_ACCOUNT_ID belum di-set di server. Mutasi tidak bisa diproses.", {
      balasKe: msg.message_id,
    });
    return sudah("account belum dikonfigurasi");
  }

  const doc = msg.document;

  // ── Bukan dokumen ──
  if (!doc) {
    if (msg.photo) {
      await kirimPesan(
        chatId,
        "❌ Itu tangkapan layar. Kirim BERKAS PDF-nya (di BSINet: Export → PDF, lalu bagikan file-nya ke sini).",
        { balasKe: msg.message_id },
      );
      return sudah("foto ditolak");
    }
    const teks = String(msg.text ?? "").trim().toLowerCase();
    if (teks === "/start" || teks === "/mutasi" || teks === "/help") {
      await kirimPesan(
        chatId,
        "Kirim berkas mutasi ke sini (PDF dari BSINet, atau HTML dari KlikBCA).\n" +
          "Saya simpan, lalu balas dengan satu tombol untuk memprosesnya.\n\n" +
          "Yang saya periksa otomatis: keutuhan mutasi, sambungan saldo, lalu cocokkan transfer MASUK dan KELUAR dengan Aceh Gadai.",
        { balasKe: msg.message_id },
      );
    }
    return sudah("bukan dokumen");
  }

  const namaFile = String(doc.file_name ?? "mutasi");
  const mime = String(doc.mime_type ?? "");
  const ukuran = Number(doc.file_size ?? 0);

  // ── Gerbang 4a: jenis berkas ──
  if (!berkasSah(namaFile, mime)) {
    await kirimPesan(
      chatId,
      `❌ "${namaFile}" bukan berkas mutasi yang saya kenal (${mime || "tanpa tipe"}).\n\n` +
        "Yang bisa dibaca: BSI BSINet (PDF), BSI Byond, BNI, Mandiri, BCA e-Statement, BCA KlikBCA (HTML).",
      { balasKe: msg.message_id },
    );
    return sudah("mime ditolak");
  }

  // ── Gerbang 4b: ukuran — DIPERIKSA SEBELUM MENGUNDUH ──
  if (ukuran > BATAS_UNDUH_BYTE) {
    await kirimPesan(
      chatId,
      `❌ Berkas ${ukuranManusiawi(ukuran)} — batas bot Telegram 20 MB.\n\n` +
        "Export per bulan (misal 01-07 s/d 31-07) lalu kirim satu per satu.",
      { balasKe: msg.message_id },
    );
    return sudah("terlalu besar");
  }

  const db = createAdminClient();

  // ── Gerbang 4c: batas harian (anti banjir) ──
  const sejak24Jam = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: jmlHariIni } = await db
    .from("mutasi_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("created_at", sejak24Jam);
  if ((jmlHariIni ?? 0) >= MAKS_BERKAS_PER_HARI) {
    await kirimPesan(
      chatId,
      `⚠️ Sudah ${jmlHariIni} berkas dalam 24 jam terakhir — batasnya ${MAKS_BERKAS_PER_HARI}. Coba lagi besok.`,
      { balasKe: msg.message_id },
    );
    return sudah("batas harian");
  }

  // ── Unduh + sidik jari ──
  const unduh = await unduhBerkas(String(doc.file_id));
  if (!unduh.ok) {
    await kirimPesan(chatId, `❌ Gagal mengambil berkas dari Telegram: ${unduh.error}`, {
      balasKe: msg.message_id,
    });
    return sudah("gagal unduh");
  }
  const isi = Buffer.from(unduh.hasil.buffer);
  const sha = await sha256Hex(unduh.hasil.buffer);

  // ── Gerbang 4d: berkas yang sama tidak diproses dua kali ──
  const { data: kembar } = await db
    .from("mutasi_jobs")
    .select("id, created_at, status, bank_id")
    .eq("account_id", accountId)
    .eq("sha256", sha)
    .maybeSingle();
  if (kembar) {
    const k = kembar as any;

    // Sudah benar-benar selesai: jangan diproses ulang.
    if (k.status === "SELESAI" || k.status === "SELESAI_RAGU") {
      await kirimPesan(
        chatId,
        `ℹ️ Berkas ini sudah diproses (${tanggalWIB(String(k.created_at))}). Tidak saya ulang.`,
        { balasKe: msg.message_id },
      );
      return sudah("sha kembar, sudah selesai");
    }

    // BELUM selesai (gagal di tengah, tautannya kedaluwarsa, atau tombolnya
    // tidak pernah diketuk) — TERBITKAN TAUTAN BARU.
    //
    // Ini menutup jalan buntu yang dibuat oleh dedup itu sendiri: sekali sha256
    // tercatat, kiriman ulang berkas yang sama akan ditolak selamanya, padahal
    // mengirim ulang berkas adalah persis yang dilakukan orang ketika sesuatu
    // gagal. Lebih sederhana daripada tombol "Ulangi" di chat, dan cocok dengan
    // kebiasaan nyata pemakainya.
    const tokenBaru = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const { error: errPerbarui } = await db
      .from("mutasi_jobs")
      .update({
        token_hash: await sha256Hex(new TextEncoder().encode(tokenBaru)),
        token_exp: new Date(Date.now() + JAM_TOKEN_HIDUP * 3600 * 1000).toISOString(),
        token_dipakai_at: null,
        status: "ANTRI",
        error_text: null,
        langkah: null,
        tg_chat_id: Number(chatId),
        tg_message_id: Number(msg.message_id),
      })
      .eq("id", k.id)
      .eq("account_id", accountId);

    const situsUlang = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
    if (errPerbarui || !situsUlang) {
      await kirimPesan(chatId, `⚠️ Berkas ini sudah pernah masuk tapi belum selesai, dan saya gagal membuat tautan baru${errPerbarui ? `: ${errPerbarui.message}` : ""}.`, {
        balasKe: msg.message_id,
      });
      return sudah("gagal terbitkan ulang");
    }

    // Penanda "sudah dikirim" SENGAJA tidak direset: kalau pass kredit sudah
    // mendarat di Aceh Gadai sebelum gagal, ia tidak boleh dikirim dua kali.
    // Kalau rekeningnya belum pasti (bank_id null), tombol tunggal akan
    // mendarat di halaman yang menolak dengan "Rekening belum jelas" — jalan
    // buntu. Tawarkan satu tombol per rekening, sama seperti jalur berkas baru.
    let tombolUlang = [[{ text: "▶️ Proses sekarang", url: `${situsUlang}/proses/${tokenBaru}` }]];
    if (!k.bank_id) {
      const { data: bankUlang } = await db
        .from("banks")
        .select("id, kode, label")
        .eq("account_id", accountId)
        .eq("is_active", true)
        .order("urutan");
      const daftar = (bankUlang ?? []) as any[];
      if (daftar.length > 1) {
        tombolUlang = daftar.map((x) => [
          { text: `▶️ Proses sebagai ${x.label || x.kode}`, url: `${situsUlang}/proses/${tokenBaru}/${x.id}` },
        ]);
      }
    }

    await kirimPesan(
      chatId,
      `🔁 Berkas ini pernah masuk (${tanggalWIB(String(k.created_at))}) tapi belum selesai.\nTautan barunya di bawah — yang sudah terkirim ke Aceh Gadai tidak akan dikirim dua kali.`,
      { balasKe: msg.message_id, tombol: tombolBaris(tombolUlang) },
    );
    return sudah("tautan diterbitkan ulang");
  }

  // ── Tebak rekening ──
  const { data: bankRows } = await db
    .from("banks")
    .select("id, kode, label, parser_id, recon_last_date")
    .eq("account_id", accountId)
    .eq("is_active", true)
    .order("urutan");
  const banks = (bankRows ?? []) as any[];
  if (banks.length === 0) {
    await kirimPesan(chatId, "❌ Belum ada rekening aktif di cektransfer. Tambahkan dulu lewat menu Bank.", {
      balasKe: msg.message_id,
    });
    return sudah("tanpa bank");
  }

  const nl = namaFile.toLowerCase();
  const cocokNama = banks.filter(
    (b) =>
      (b.kode && nl.includes(String(b.kode).toLowerCase())) ||
      (b.label && nl.includes(String(b.label).toLowerCase())),
  );
  // Satu rekening = tidak ada yang perlu ditebak. Kalau lebih dari satu dan
  // nama berkas tidak menolong, owner yang memilih lewat tombol — itu MENAMBAH
  // satu ketukan, dan disebut apa adanya alih-alih ditebak diam-diam.
  const kandidat = banks.length === 1 ? banks : cocokNama.length === 1 ? cocokNama : banks;
  const bankTunggal = kandidat.length === 1 ? kandidat[0] : null;

  // ── Buat tugas ──
  const jobId = crypto.randomUUID();
  const bulan = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" }).slice(0, 7);
  const ekstensi = nl.endsWith(".html") || nl.endsWith(".htm") ? "html" : "pdf";
  const storagePath = `${accountId}/${bulan}/${jobId}.${ekstensi}`;

  const tokenMentah = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const tokenHash = await sha256Hex(new TextEncoder().encode(tokenMentah));

  const { error: errInsert } = await db.from("mutasi_jobs").insert({
    id: jobId,
    account_id: accountId,
    bank_id: bankTunggal?.id ?? null,
    sumber: "telegram",
    tg_chat_id: Number(chatId),
    tg_message_id: Number(msg.message_id),
    tg_file_id: String(doc.file_id),
    file_name: namaFile.slice(0, 200),
    file_size: isi.byteLength,
    sha256: sha,
    storage_path: storagePath,
    token_hash: tokenHash,
    token_exp: new Date(Date.now() + JAM_TOKEN_HIDUP * 3600 * 1000).toISOString(),
    status: "ANTRI",
  });
  if (errInsert) {
    console.error("[tg] gagal membuat tugas:", errInsert);
    await kirimPesan(chatId, `❌ Gagal mencatat tugas: ${errInsert.message}`, { balasKe: msg.message_id });
    return sudah("insert gagal");
  }

  // Baris dibuat lebih dulu supaya berkas kembar tertangkap tanpa mengunggah
  // apa pun. Kalau unggahannya gagal, barisnya dibuang lagi — jangan tinggalkan
  // tugas yang menunjuk berkas yang tidak ada.
  const { error: errUpload } = await db.storage
    .from(BUCKET)
    .upload(storagePath, isi, {
      contentType: ekstensi === "html" ? "text/html" : "application/pdf",
      upsert: false,
    });
  if (errUpload) {
    console.error("[tg] gagal menyimpan berkas:", errUpload);
    await db.from("mutasi_jobs").delete().eq("id", jobId);
    await kirimPesan(chatId, `❌ Gagal menyimpan berkas: ${errUpload.message}`, { balasKe: msg.message_id });
    return sudah("upload gagal");
  }

  // ── Balas dengan tombol ──
  // .trim() sama pentingnya di sini: kalau env-nya kemasukan spasi, tautan
  // tombolnya cacat dan ketukan owner mendarat di halaman yang tidak ada.
  const situs = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (!situs) {
    await kirimPesan(
      chatId,
      "⚠️ Berkas tersimpan, tapi NEXT_PUBLIC_SITE_URL belum di-set jadi saya tidak bisa membuat tautannya. Buka cektransfer lalu proses manual.",
      { balasKe: msg.message_id },
    );
    return sudah("site url kosong");
  }

  // Rekening ikut di PATH, bukan query. Alasannya nyata: middleware hanya
  // membawa PATHNAME ke `?next=` saat sesi mati (lib/supabase/middleware.ts:111,116),
  // jadi `?bank=...` akan lenyap sesudah owner login dan halaman kehilangan
  // pilihannya tanpa jejak.
  const barisTombol = bankTunggal
    ? [[{ text: "▶️ Proses sekarang", url: `${situs}/proses/${tokenMentah}` }]]
    : kandidat.map((b) => [
        { text: `▶️ Proses sebagai ${b.label || b.kode}`, url: `${situs}/proses/${tokenMentah}/${b.id}` },
      ]);

  const garisRekening = bankTunggal
    ? `Rekening: ${bankTunggal.label || bankTunggal.kode}\nTerakhir tercatat: ${tanggalWIB(bankTunggal.recon_last_date)}`
    : `Rekening: belum pasti — pilih di bawah`;

  // Berkas yang tombolnya tidak pernah diketuk tidak mengabari siapa pun, dan
  // diamnya terasa persis seperti "tidak ada masalah". Tidak ada cron penyapu
  // di Fase 1, jadi saat ada kiriman BARU sekalian sebutkan yang menggantung —
  // murah, dan menghapus satu bentuk kesenyapan yang menipu.
  let garisGantung = "";
  {
    const sejamLalu = new Date(Date.now() - 3600 * 1000).toISOString();
    const { data: gantung } = await db
      .from("mutasi_jobs")
      .select("file_name")
      .eq("account_id", accountId)
      .in("status", ["ANTRI", "DIBUKA"])
      .neq("id", jobId)
      .lt("created_at", sejamLalu)
      .order("created_at", { ascending: true })
      .limit(5);
    const n = (gantung ?? []).length;
    if (n > 0) {
      const nama = (gantung as any[]).map((g) => String(g.file_name)).join(", ");
      garisGantung = `\n\n⏳ Masih menggantung (belum diproses): ${nama}${n >= 5 ? ", …" : ""}`;
    }
  }

  const balasan = await kirimPesan(
    chatId,
    `📥 Diterima: ${namaFile} (${ukuranManusiawi(isi.byteLength)})\n${garisRekening}${garisGantung}`,
    { balasKe: msg.message_id, tombol: tombolBaris(barisTombol) },
  );

  // Kalau balasannya gagal terkirim, tombolnya tidak pernah sampai — dan
  // karena sha256 sudah tercatat, kiriman ULANG berkas yang sama akan ditolak
  // sebagai kembar. Berkasnya jadi jalan buntu permanen. Jadi kalau kabar
  // gagal, buang jejaknya supaya owner bisa kirim ulang.
  if (!balasan.ok) {
    console.error("[tg] balasan gagal terkirim, tugas dibatalkan:", balasan.error);
    await db.storage.from(BUCKET).remove([storagePath]);
    await db.from("mutasi_jobs").delete().eq("id", jobId);
    return sudah("balasan gagal, tugas dibatalkan");
  }

  return sudah("tugas dibuat");
}
