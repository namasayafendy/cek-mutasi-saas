"use server";

// ============================================================
// KANAL MASUK MUTASI — Server action halaman proses (Fase 1)
// File: app/(app)/proses/[...jalur]/actions.ts
//
// SEMUA penulisan ke mutasi_jobs lewat sini, memakai service_role.
// Bukan karena malas mengatur RLS, tapi karena disengaja: peran
// `authenticated` hanya diberi SELECT atas mutasi_jobs, supaya klien nakal
// tidak bisa menandai sebuah job "SELESAI" atau memalsukan penanda
// "sudah dikirim". Kalau browser mencoba .update() sendiri, ia gagal SENYAP
// (0 baris, tanpa error) — dan kegagalan senyap persis yang ingin dihindari.
//
// "use server" TIDAK memberi otorisasi apa pun: setiap action di bawah ini
// adalah endpoint yang bisa dipanggil siapa saja. Karena itu masing-masing
// memanggil getAccountContext() sendiri, dan SETIAP query admin menyertakan
// .eq("account_id", ...) secara eksplisit — service_role mem-bypass RLS,
// jadi lupa satu baris itu berarti kebocoran lintas-akun.
// ============================================================

import { getAccountContext } from "@/lib/supabase/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { antreLaporan } from "@/lib/telegram/outbox";
import { hitungCakupan, saranExport, tglID, type BarisCakupan, type HasilCakupan } from "@/lib/coverage/celah";

export type Balasan = { ok: boolean; error?: string };

/**
 * Ambil konteks + pastikan job memang milik akun pemanggil.
 *
 * Peran DIPERIKSA di sini, bukan hanya kepemilikan akun. Alasannya: RLS
 * memberi SELECT atas mutasi_jobs kepada seluruh anggota akun, sehingga id job
 * bisa dibaca siapa pun di dalam tim — dan action ini berkunci pada id, bukan
 * pada token dari Telegram. Tanpa cek peran, seorang staf bisa menutup sebuah
 * job dan mengirim laporan "tidak ada yang perlu ditindak" ke chat pribadi
 * pemilik. Hari ini semua akun hanya berisi satu orang berperan owner, jadi ini
 * senjata yang belum bisa ditembakkan — tapi fitur undang staf sudah aktif,
 * dan lubang ini akan hidup pada hari pertama ada staf.
 */
async function jobMilikku(jobId: string) {
  const ctx = await getAccountContext();
  if (!ctx) return { error: "Sesi tidak valid. Silakan login ulang." as const };
  if (ctx.member.role !== "owner") {
    return { error: "Hanya pemilik yang boleh memproses mutasi." as const };
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(jobId))) return { error: "Job tidak sah." as const };

  const db = createAdminClient();
  const { data } = await db
    .from("mutasi_jobs")
    .select(
      "id, account_id, bank_id, file_name, status, tg_chat_id, tg_message_id, dikirim_kredit_at, dikirim_debet_at",
    )
    .eq("id", jobId)
    .eq("account_id", ctx.account.id)
    .maybeSingle();
  if (!data) return { error: "Tugas tidak ditemukan." as const };
  return { ctx, db, job: data as any };
}

/** Buang baris baru + potong. Dipakai untuk teks apa pun yang datang dari
 *  klien sebelum masuk pesan Telegram, supaya tidak bisa menyulap satu baris
 *  keterangan menjadi laporan berbaris-baris yang tampak resmi. */
function jinak(s: unknown, maks = 120): string {
  return String(s ?? "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, maks);
}

/** Tandai tahap terakhir. Supaya job yang mati di tengah bisa dikenali —
 *  dan supaya "setengah jadi" tidak pernah terlihat seperti "selesai". */
export async function catatLangkah(jobId: string, langkah: string): Promise<Balasan> {
  const r = await jobMilikku(jobId);
  if ("error" in r) return { ok: false, error: r.error };
  await r.db
    .from("mutasi_jobs")
    .update({
      langkah: String(langkah).slice(0, 200),
      status: r.job.status === "ANTRI" ? "DIBUKA" : r.job.status,
      dibuka_at: r.job.status === "ANTRI" ? new Date().toISOString() : undefined,
    })
    .eq("id", jobId)
    .eq("account_id", r.ctx.account.id);
  return { ok: true };
}

/**
 * Kunci sekali-kirim (compare-and-set di DB).
 *
 * useRef di React TIDAK cukup: StrictMode menjalankan efek dua kali di dev,
 * dan tautan yang sama bisa dibuka di dua HP sekaligus. Yang menahan hanyalah
 * satu baris UPDATE bersyarat yang hanya berhasil sekali.
 *
 * Endpoint /api/transfer-klaim/result di sisi gadai BERAT — ia memicu
 * rekonsiliasi penuh + alert Telegram. Terkirim dua kali berarti owner
 * menerima dua laporan yang saling bertentangan.
 */
export async function kunciKirim(jobId: string, arah: "kredit" | "debet"): Promise<Balasan> {
  const r = await jobMilikku(jobId);
  if ("error" in r) return { ok: false, error: r.error };
  const kolom = arah === "debet" ? "dikirim_debet_at" : "dikirim_kredit_at";

  const { data } = await r.db
    .from("mutasi_jobs")
    .update({ [kolom]: new Date().toISOString() })
    .eq("id", jobId)
    .eq("account_id", r.ctx.account.id)
    .is(kolom, null)
    .select("id");

  if (!data || data.length === 0) {
    return { ok: false, error: `Hasil ${arah} sudah pernah dikirim untuk berkas ini.` };
  }
  return { ok: true };
}

/** Lepas kunci kalau pengiriman gagal — kunci yang tidak pernah dilepas
 *  membuat job terkunci selamanya dan tidak bisa diulang. */
export async function lepasKunci(jobId: string, arah: "kredit" | "debet"): Promise<Balasan> {
  const r = await jobMilikku(jobId);
  if ("error" in r) return { ok: false, error: r.error };
  const kolom = arah === "debet" ? "dikirim_debet_at" : "dikirim_kredit_at";
  await r.db
    .from("mutasi_jobs")
    .update({ [kolom]: null })
    .eq("id", jobId)
    .eq("account_id", r.ctx.account.id);
  return { ok: true };
}

export interface RingkasPass {
  jenis: "kredit" | "debet";
  periodStart: string | null;
  periodEnd: string | null;
  klaimDitarik: number;
  klaimDibuang: number;
  outletTakDikenal: string[];
  klaimDinilai: number;
  cocok: number;
  belumKetemu: number;
  ditahanDiLuarPeriode: number;
  ditahanKonflik: number;
  sudahTerbuktiSebelumnya: number;
  terkirim: { updated: number; unmatched: number; recheck: number; alarm: number; alertSent: boolean } | null;
  batal: { kode: string; pesan: string } | null;
  unclaimedCount: number;
  unclaimedTotal: number;
}

export interface RingkasBerkas {
  /** Diabaikan — nama berkas dan label rekening dibaca ulang dari DB di server.
   *  Ikut di tipe hanya supaya pemanggil tidak perlu diubah. */
  namaFile?: string;
  bankLabel?: string;
  barisTerbaca: number;
  barisBaru: number;
  barisSudahAda: number;
  /** null = total tercetak tak terbaca (bank selain BSI). BUKAN "tidak lengkap". */
  utuh: boolean | null;
  /** null = belum ada titik terakhir tersimpan. */
  nyambung: boolean | null;
  selisihSambungan: number;
  rantaiPutus: number;
  sampaiTanggal: string | null;
}

function rp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function tgl(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

/**
 * Susun teks laporan DI SERVER, bukan di browser.
 *
 * Action ini adalah endpoint publik. Kalau ia menerima teks jadi, pemanggilnya
 * bisa mengirim kalimat apa pun ke Telegram pribadi pemilik — dan kalimat itu
 * akan terlihat resmi.
 *
 * Versi pertama fungsi ini mengklaim "yang bisa dipalsukan paling jauh hanyalah
 * angkanya". Itu TIDAK benar: nama berkas, label rekening, dan daftar outlet
 * semuanya string milik klien. Sekarang nama berkas dan label rekening dibaca
 * ULANG dari database, dan sisa string dijinakkan sebelum dipakai.
 */
function susunLaporan(
  berkas: RingkasBerkas,
  pass: RingkasPass[],
  dariDb: { namaFile: string; bankLabel: string },
  cakupan: HasilCakupan | null,
): string {
  const b: string[] = [];
  b.push(`📥 Mutasi ${dariDb.bankLabel} — ${Math.max(0, Math.trunc(berkas.barisTerbaca || 0))} baris`);
  b.push(`Berkas: ${dariDb.namaFile}`);
  b.push(`Baru ${berkas.barisBaru} · sudah ada ${berkas.barisSudahAda} (dedup)`);

  if (berkas.utuh === true) b.push("✅ Utuh (cocok total tercetak bank)");
  else if (berkas.utuh === false) b.push("⛔ TIDAK UTUH — total tercetak bank tidak cocok dengan baris terbaca");
  else b.push("➖ Keutuhan tak bisa dibuktikan (bank ini tidak mencetak total)");

  if (berkas.rantaiPutus > 0) b.push(`⛔ Rantai saldo putus di ${berkas.rantaiPutus} tempat`);

  if (berkas.nyambung === true) b.push("✅ Nyambung dari catatan terakhir (saldo bertemu)");
  else if (berkas.nyambung === false)
    b.push(`⛔ TIDAK NYAMBUNG — selisih saldo ${rp(berkas.selisihSambungan)}; ada transaksi sebelum periode ini yang belum pernah masuk`);
  else b.push("➖ Belum ada titik terakhir untuk dibandingkan");

  // ── Uji CAKUPAN: apakah semua tanggal sudah pernah diperiksa ──
  // Inilah yang menjawab pertanyaan yang selama ini tidak pernah dijawab.
  // Celah yang saldo batasnya bertemu TIDAK disebut masalah — ia terbukti
  // kosong secara aritmetika, dan menyebutnya masalah akan melahirkan alarm
  // palsu tiap kali ada hari libur di ujung sebuah export.
  if (cakupan && cakupan.akhir) {
    if (cakupan.celah.length === 0) {
      // JANGAN berkata "60 hari bersih" kalau yang kita tahu cuma beberapa hari.
      // Nol celah bisa berarti nol pengetahuan — dan itu terbaca sebagai jaminan.
      const cukupPanjang = cakupan.hariTercakup >= cakupan.jendelaHari - 1;
      b.push(
        cukupPanjang
          ? `✅ Cakupan ${cakupan.jendelaHari} hari: tidak ada tanggal bolong`
          : `✅ Tidak ada tanggal bolong di ${tglID(cakupan.awal!)} s/d ${tglID(cakupan.akhir)}` +
              ` — baru ${cakupan.hariTercakup} dari ${cakupan.jendelaHari} hari terakhir yang pernah diperiksa`,
      );
    } else {
      for (const c of cakupan.celah.slice(0, 4)) {
        const rentang = c.dari === c.sampai ? tglID(c.dari) : `${tglID(c.dari)} s/d ${tglID(c.sampai)}`;
        b.push(
          `⛔ BOLONG: ${rentang} (${c.hari} hari) tidak tercakup mutasi mana pun` +
            (c.selisih > 0 ? ` — saldo tidak bertemu, selisih ${rp(c.selisih)}` : ""),
        );
      }
      if (cakupan.celah.length > 4) b.push(`   …dan ${cakupan.celah.length - 4} celah lain`);
    }
    if (cakupan.celahTerbuktiKosong.length > 0) {
      b.push(`   (${cakupan.celahTerbuktiKosong.length} celah lain terbukti kosong dari saldo — aman)`);
    }

    // Keterkinian: diam bukan berarti mutakhir.
    if ((cakupan.umurHari ?? 0) >= 1) {
      b.push(`⚠️ Mutasi baru sampai ${tglID(cakupan.akhir)} — ${cakupan.umurHari} hari terakhir BELUM dinilai`);
    } else {
      b.push(`✅ Mutakhir sampai ${tglID(cakupan.akhir)}`);
    }
  }

  b.push("────────────");

  for (const p of pass) {
    const nama = p.jenis === "kredit" ? "Masuk (kredit)" : "Keluar (debet)";
    if (p.batal) {
      b.push(`⚠️ ${nama}: TIDAK dikirim ke Aceh Gadai — ${jinak(p.batal.pesan, 200)}`);
      continue;
    }
    const t = p.terkirim;
    // Kalimatnya sengaja menyebut BERAPA YANG DINILAI, bukan hanya berapa yang
    // ditarik. Versi pertama menulis "60 klaim → 6 cocok, 54 belum ketemu"
    // padahal 52 di antaranya cuma belum tercakup berkas ini — angka yang
    // menakut-nakuti pembacanya tentang masalah yang tidak ada.
    b.push(
      `${nama}: ${p.klaimDitarik} klaim ditarik → ${p.klaimDinilai} bisa dinilai berkas ini` +
        ` → ${p.cocok} cocok, ${p.belumKetemu} belum ketemu` +
        (t && t.recheck > 0 ? ` (${t.recheck} menunggu mutasi berikutnya)` : ""),
    );
    if (p.ditahanDiLuarPeriode > 0) {
      b.push(`   ↳ ${p.ditahanDiLuarPeriode} klaim di luar jangkauan berkas ini — menunggu mutasi lain, bukan masalah`);
    }
    if (p.ditahanKonflik > 0) {
      b.push(`   ↳ ⚠️ ${p.ditahanKonflik} klaim berebut mutasi yang sama — perlu Bapak putuskan di Kotak Masuk Transfer`);
    }
    if (p.sudahTerbuktiSebelumnya > 0) {
      b.push(`   ↳ ${p.sudahTerbuktiSebelumnya} klaim sudah terbukti di sesi sebelumnya, dilaporkan ulang`);
    }
    if (p.klaimDibuang > 0) b.push(`   ↳ ⚠️ ${p.klaimDibuang} klaim dibuang (tanggal/nominal tidak sah)`);
    if (p.outletTakDikenal.length > 0) {
      b.push(`   ↳ ⚠️ outlet belum cocok: ${p.outletTakDikenal.slice(0, 8).map((o) => jinak(o, 40)).join(", ")}`);
    }
    if (t && t.alarm > 0) b.push(`   ↳ 🚨 ${t.alarm} alarm nomor referensi`);
    if (p.jenis === "kredit" && p.unclaimedCount > 0) {
      b.push(`   ↳ ${p.unclaimedCount} uang masuk tanpa transaksi tercatat (${rp(p.unclaimedTotal)})`);
    }
  }

  b.push("────────────");
  // "Di luar jangkauan" BUKAN masalah — itu keadaan normal, dan menyebutnya
  // masalah membuat setiap laporan berbunyi cemas sampai tidak ada yang
  // membacanya lagi. Yang masalah: mutasi tidak utuh, pass yang batal,
  // klaim yang benar-benar tidak ketemu, dan klaim yang berebut.
  const adaMasalah =
    berkas.utuh === false ||
    berkas.rantaiPutus > 0 ||
    berkas.nyambung === false ||
    (cakupan?.celah.length ?? 0) > 0 ||
    pass.some((p) => p.batal || p.belumKetemu > 0 || p.ditahanKonflik > 0);
  if (!adaMasalah) b.push("Tidak ada yang perlu ditindak.");
  else b.push("Yang belum ketemu bisa dibereskan di menu Kotak Masuk Transfer (aplikasi gadai).");

  // Perintah export yang tinggal disalin — supaya bot MENYURUH, bukan sekadar
  // menunggu. Selalu mundur satu hari: kelebihan dibuang dedup, kekurangan
  // tidak bisa ditambal siapa pun.
  if (cakupan && ((cakupan.umurHari ?? 0) >= 1 || cakupan.celah.length > 0)) {
    const s = saranExport(cakupan.akhir);
    b.push(`Export BSINet: ${tglID(s.dari)} s/d ${tglID(s.sampai)}`);
  } else if (berkas.sampaiTanggal) {
    b.push(`Mutasi terbaca s/d ${tgl(berkas.sampaiTanggal)}.`);
  }

  return b.join("\n");
}

/** Selesaikan job + kirim laporan ke utas Telegram yang sama. */
export async function tandaiSelesai(
  jobId: string,
  berkas: RingkasBerkas,
  pass: RingkasPass[],
): Promise<Balasan & { teks?: string }> {
  const r = await jobMilikku(jobId);
  if ("error" in r) return { ok: false, error: r.error };

  // Nama berkas + label rekening dibaca ULANG dari database. Keduanya sudah
  // tersimpan sejak webhook menerimanya, jadi tidak ada alasan mempercayai
  // versi yang dikirim balik oleh browser.
  let bankLabel = "Rekening";
  if (r.job.bank_id) {
    const { data: bk } = await r.db
      .from("banks")
      .select("label, kode")
      .eq("id", r.job.bank_id)
      .eq("account_id", r.ctx.account.id)
      .maybeSingle();
    if (bk) bankLabel = String((bk as any).label || (bk as any).kode || "Rekening");
  }
  const dariDb = { namaFile: jinak(r.job.file_name, 120), bankLabel: jinak(bankLabel, 60) };

  // Cakupan dihitung DI SERVER dari tabel, bukan diterima dari browser —
  // vonis "tidak ada tanggal bolong" terlalu penting untuk dipercayakan
  // kepada pihak yang bisa mengarang angkanya.
  let cakupan: HasilCakupan | null = null;
  if (r.job.bank_id) {
    const batasBawah = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
    const { data: rows } = await r.db
      .from("mutasi_coverage")
      .select("tgl_awal, tgl_akhir, saldo_awal, saldo_akhir")
      .eq("account_id", r.ctx.account.id)
      .eq("bank_id", r.job.bank_id)
      .gte("tgl_akhir", batasBawah)
      .order("tgl_awal", { ascending: true })
      .limit(500);
    if (rows && rows.length > 0) cakupan = hitungCakupan(rows as BarisCakupan[]);
  }

  const adaBatal = pass.some((p) => p.batal);
  const teks = susunLaporan(berkas, pass, dariDb, cakupan);

  await r.db
    .from("mutasi_jobs")
    .update({
      status: adaBatal ? "SELESAI_RAGU" : "SELESAI",
      langkah: "selesai",
      selesai_at: new Date().toISOString(),
      ringkasan: { berkas, pass } as any,
    })
    .eq("id", jobId)
    .eq("account_id", r.ctx.account.id);

  if (r.job.tg_chat_id) {
    // Lewat antrean, bukan kirim langsung: laporan hasil rekonsiliasi terlalu
    // mahal untuk hilang gara-gara satu panggilan jaringan yang gagal.
    await antreLaporan({
      accountId: r.ctx.account.id,
      chatId: String(r.job.tg_chat_id),
      teks,
      balasKe: r.job.tg_message_id ? Number(r.job.tg_message_id) : null,
      jobId,
    });
  }
  return { ok: true, teks };
}

/**
 * Tandai job gagal.
 *
 * `pesan` datang dari browser dan dijinakkan sebelum masuk Telegram: baris
 * barunya dibuang dan panjangnya dipotong, supaya satu keterangan tidak bisa
 * disulap jadi laporan berbaris-baris yang tampak resmi. Bunyinya juga menyebut
 * asalnya ("kata aplikasi") supaya jelas itu keterangan mesin, bukan vonis.
 *
 * `sudahTerkirim` menutup kebohongan yang lain: kalau pass KREDIT sudah mendarat
 * di gadai lalu DEBET yang gagal, pesan "gagal memproses" polos akan membuat
 * pembacanya mengira tidak ada apa pun yang berubah — padahal bukunya sudah
 * berubah. Itu justru bentuk kegagalan yang paling mahal.
 */
export async function tandaiGagal(
  jobId: string,
  pesan: string,
  sudahTerkirim?: string[],
): Promise<Balasan> {
  const r = await jobMilikku(jobId);
  if ("error" in r) return { ok: false, error: r.error };

  const sudah = (sudahTerkirim ?? []).filter((s) => s === "kredit" || s === "debet");
  await r.db
    .from("mutasi_jobs")
    .update({
      // Ada yang sudah mendarat = BUKAN "gagal" polos. Bedakan, supaya
      // penyapu mana pun nanti tidak memperlakukannya seperti nol perubahan.
      status: sudah.length > 0 ? "SELESAI_RAGU" : "GAGAL",
      error_text: jinak(pesan, 500),
      langkah: sudah.length > 0 ? `gagal sesudah kirim ${sudah.join("+")}` : "gagal",
      selesai_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("account_id", r.ctx.account.id);

  if (r.job.tg_chat_id) {
    const baris = [
      `❌ Gagal memproses ${jinak(r.job.file_name, 80)}`,
      `Kata aplikasi: ${jinak(pesan, 300)}`,
    ];
    if (sudah.length > 0) {
      baris.push(
        "",
        `⚠️ TAPI hasil ${sudah.join(" & ")} SUDAH terkirim ke Aceh Gadai sebelum gagal.`,
        "Bagian itu tidak akan dikirim dua kali kalau diulang.",
      );
    }
    await antreLaporan({
      accountId: r.ctx.account.id,
      chatId: String(r.job.tg_chat_id),
      teks: baris.join("\n"),
      balasKe: r.job.tg_message_id ? Number(r.job.tg_message_id) : null,
      jobId,
    });
  }
  return { ok: true };
}
