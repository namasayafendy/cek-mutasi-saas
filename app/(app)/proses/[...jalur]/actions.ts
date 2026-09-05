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

import { adalahBiayaAdmin } from "@/lib/bank/biayaAdmin";
import { getAccountContext } from "@/lib/supabase/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { antreLaporan } from "@/lib/telegram/outbox";
import { hitungCakupan, saranExport, tglID, type BarisCakupan, type HasilCakupan } from "@/lib/coverage/celah";
import { susunLapis2, type IsiLapis2 } from "@/lib/laporan/lapis2";

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
  unclaimedBelumLapor?: number;
  /** Rekap resi yang diuji per tanggal — alat sanding-menyanding dengan LAPIS 1. */
  perTanggal?: { tgl: string; jml: number; rp: number;
                 masukJml?: number; masukRp?: number; keluarJml?: number; keluarRp?: number }[];
  /** Resi yang tidak ada di rekening, lengkap dengan kontrak & outletnya. */
  tidakKetemu?: { no_faktur: string; outlet: string; tgl: string; nominal: number; sebab: string }[];
  /** Baris mutasi tanpa pemilik — kredit maupun DEBET. */
  unclaimedRows?: { tgl: string; jam: string; nominal: number; pihak: string; ket: string }[];
  /** Tanggal terakhir yang benar-benar diperiksa untuk "tanpa pemilik".
   *  Terisi = ada ekor tanggal yang sengaja dilewati (klaimnya belum lahir). */
  unclaimedBatas?: string | null;
  /** false = pemeriksaan "tanpa pemilik" tidak sempat jalan. Nol baris di situ
   *  BUKAN "bersih". */
  unclaimedDiperiksa?: boolean;
  /** Resi yang diketik OWNER sendiri (sumber MANUAL), dihitung TERPISAH. */
  manualDinilai?: number;
  manualCocok?: number;
  /** Yang DITAHAN gerbang Lapis 1 dan tidak pernah sampai ke sini.
   *  undefined/null = gadai belum mengirimkannya — "tidak diketahui", bukan nol. */
  tertahanGerbang?: { jml: number; rp: number;
                      perSebab: { sebab: string; teks: string; n: number; rp: number }[];
                      gerbangError: string | null } | null;
  /** Klaim yang pass ini TAHAN (berebut baris / di luar periode), lengkap
   *  identitasnya — dipasangkan ke `sandingan.ketinggalan` lewat klaim_id. */
  ditahanDaftar?: { id: string; no_faktur: string; outlet: string; tgl: string; nominal: number;
                    sebab: "BEREBUT" | "LUAR_PERIODE" }[];
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

/** Lantai tanggal — keputusan pemilik: apa pun sebelum ini dianggap sudah
 *  beres dan diperiksa manual. Sama dengan lantai LAPIS 1. */
const LANTAI_LAPIS2 = "2026-07-22";

/**
 * Rangkai isi laporan LAPIS 2 dari hasil pass, lalu serahkan penyusunan
 * teksnya ke lib/laporan/lapis2.
 *
 * Tunggakan (resi lama yang belum ketemu dan belum dibereskan) TIDAK ada di
 * sisi ini — ia hidup di aplikasi gadai. Diambil lewat endpoint cakupan yang
 * memang sudah dipanggil tiap hari. Kalau gagal diambil, laporan berkata
 * terus terang bahwa bagian itu tidak bisa dinilai — bukan mencetak "(0)"
 * yang tak bisa dibedakan dari "memang tidak ada".
 */
async function susunLaporanLapis2(
  r: any,
  berkas: RingkasBerkas,
  pass: RingkasPass[],
  dariDb: { namaFile: string; bankLabel: string },
  cakupan: HasilCakupan | null,
): Promise<string> {
  const kredit = pass.find((p) => p.jenis === "kredit");
  const debet = pass.find((p) => p.jenis === "debet");

  // Rekap per tanggal digabung dua arah, lalu disaring lantai.
  type Rekap = { tgl: string; jml: number; rp: number;
                 masukJml: number; masukRp: number; keluarJml: number; keluarRp: number };
  const petaTgl = new Map<string, Rekap>();
  for (const p of pass) {
    for (const x of (p.perTanggal ?? [])) {
      if (x.tgl < LANTAI_LAPIS2) continue;
      let ada = petaTgl.get(x.tgl);
      if (!ada) {
        ada = { tgl: x.tgl, jml: 0, rp: 0, masukJml: 0, masukRp: 0, keluarJml: 0, keluarRp: 0 };
        petaTgl.set(x.tgl, ada);
      }
      ada.jml += x.jml; ada.rp += x.rp;
      // Pass lama (sebelum arah dipisah) tidak punya medan ini; tanpa fallback
      // laporan akan menampilkan nol pada berkas yang diproses ulang.
      ada.masukJml += Number(x.masukJml ?? 0); ada.masukRp += Number(x.masukRp ?? 0);
      ada.keluarJml += Number(x.keluarJml ?? 0); ada.keluarRp += Number(x.keluarRp ?? 0);
    }
  }
  const perTanggal = [...petaTgl.values()].sort((a, b) => (a.tgl < b.tgl ? -1 : 1));

  const tidakKetemu = pass
    .flatMap((p) => p.tidakKetemu ?? [])
    .filter((x) => x.tgl >= LANTAI_LAPIS2)
    .sort((a, b) => (a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0));

  const rowsK = (kredit?.unclaimedRows ?? []).filter((x) => x.tgl >= LANTAI_LAPIS2);
  const rowsDSemua = (debet?.unclaimedRows ?? []).filter((x) => x.tgl >= LANTAI_LAPIS2);

  // ── POTONGAN ADMIN BANK DIPISAH, BUKAN DIBUANG ──
  //
  // Rp 2.500 dan Rp 6.500 adalah biaya yang dibebankan bank, bukan uang
  // perusahaan yang bergerak ke siapa pun. Tiap hari ia mendarat di blok
  // "UANG DI MUTASI TANPA PEMILIK" dan menyita tempat baris yang benar-benar
  // perlu dilihat. Keputusan pemilik 3 September 2026.
  //
  // Cacah & jumlahnya tetap dibawa ke laporan sebagai SATU baris. Kalau bank
  // menaikkan tarifnya, baris itulah yang akan memperlihatkannya.
  const rowsDAdmin = rowsDSemua.filter((x) => adalahBiayaAdmin(x.nominal));
  const rowsD = rowsDSemua.filter((x) => !adalahBiayaAdmin(x.nominal));

  // Tunggakan dari sisi gadai.
  let tunggakan: IsiLapis2["tunggakan"] = [];
  // Sandingan Lapis 1 ↔ Lapis 2 — angkanya diambil dari gadai, TIDAK dihitung
  // di sini. Dua sisi yang menghitung sendiri-sendiri akan menyimpang, dan
  // menyimpangnya justru terlihat seperti kebocoran.
  let sandingan: IsiLapis2["sandingan"] = null;
  let sandinganGagal: string | null = null;
  const gagal: string[] = [];
  for (const p of pass) if (p.batal) gagal.push(`${p.jenis}: ${p.batal.pesan}`);
  try {
    const { data: cfg } = await r.db
      .from("account_settings")
      .select("gadai_sync_enabled, gadai_api_url, gadai_api_key")
      .eq("account_id", r.ctx.account.id)
      .maybeSingle();
    const c = cfg as any;
    if (c?.gadai_sync_enabled && c.gadai_api_url && c.gadai_api_key) {
      const base = String(c.gadai_api_url).replace(/\/+$/, "");

      // ── SANDINGAN, diambil lebih dulu ──
      //
      // Rentangnya = periode BERKAS ini, bukan lantai: yang ingin dijawab
      // adalah "dari yang dilepas untuk hari-hari di berkas ini, adakah yang
      // tidak sampai kemari?". Memakai lantai akan menyeret tanggal-tanggal
      // lama yang memang sedang menunggu mutasi lain, lalu melaporkannya
      // sebagai ketinggalan — alarm palsu yang membuat blok ini berhenti dibaca.
      //
      // Kegagalannya TIDAK didiamkan: sandingan yang tak bisa diambil dicetak
      // apa adanya, karena "tidak ada blok" dan "semua cocok" terlihat sama.
      const sDari = kredit?.periodStart ?? debet?.periodStart ?? null;
      const sSampai = kredit?.periodEnd ?? debet?.periodEnd ?? null;

      // ── PATOKAN "BARU": WAKTU LAPORAN LAPIS 2 SEBELUMNYA ──
      //
      // Tanpa patokan ini blok "resi yang diuji" menjabarkan SELURUH tanggal
      // dalam periode berkas, termasuk yang sudah tuntas dan sudah dilaporkan
      // berhari-hari lalu. Pemilik menyebutnya sendiri: "sudah saya selesaikan,
      // kenapa muncul lagi".
      //
      // Yang dipakai waktu SELESAINYA job sebelumnya, bukan waktu job ini
      // dimulai. Vonis bisa lahir di luar sapuan — penutupan tangan lewat
      // /belum-cocok terjadi di antara dua unggahan — dan patokan "sejak sapuan
      // ini dimulai" akan membuat vonis itu tidak pernah muncul di laporan mana
      // pun. Kategori tanpa pintu keluar persis yang harus dihindari di sini.
      // Patokannya laporan yang BENAR-BENAR TERKIRIM, bukan job yang selesai.
      // Bedanya menutup lubang yang mahal: job yang gagal di tengah SESUDAH
      // hasilnya terkirim ke gadai ditandai SELESAI_RAGU + selesai_at, tapi
      // laporan LAPIS 2-nya tidak pernah terbit. Kalau patokannya "job selesai
      // terakhir", vonis satu hari penuh itu terlewat di laporan berikutnya
      // dan tidak akan muncul di laporan mana pun, selamanya.
      //
      // Antrean laporan adalah catatan yang paling jujur soal ini: TERKIRIM
      // berarti pemilik benar-benar sudah membacanya.
      let sejak: string | null = null;
      {
        const { data: sblm } = await r.db
          .from("mutasi_laporan_outbox")
          .select("created_at")
          .eq("account_id", r.ctx.account.id)
          .eq("status", "TERKIRIM")
          .like("teks", "🟢 LAPIS 2%")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        // null = memang belum pernah ada laporan. Itu BUKAN "tidak ada yang
        // baru" — laporannya nanti menjabarkan semuanya dan berkata kenapa.
        sejak = (sblm as any)?.created_at ? new Date((sblm as any).created_at).toISOString() : null;
      }

      if (sDari && sSampai) {
        try {
          const resS = await fetch(
            `${base}/api/transfer-klaim/sandingan?dari=${sDari}&sampai=${sSampai}` +
            (sejak ? `&sejak=${encodeURIComponent(sejak)}` : ""),
            { headers: { Authorization: `Bearer ${c.gadai_api_key}` },
              cache: "no-store", signal: AbortSignal.timeout(8000) });
          if (resS.ok) {
            const j = await resS.json();
            if (j?.ok) sandingan = j as IsiLapis2["sandingan"];
            else sandinganGagal = String(j?.msg ?? "ditolak Aceh Gadai");
          } else if (resS.status === 404) {
            sandinganGagal = "endpoint belum tayang di Aceh Gadai (404, kemungkinan belum di-promote)";
          } else {
            sandinganGagal = `HTTP ${resS.status}`;
          }
        } catch (e) {
          sandinganGagal = e instanceof Error ? e.message : String(e);
        }
      } else {
        sandinganGagal = "periode berkas tidak terbaca";
      }

      // `tercakup` = tanggal terakhir yang mutasinya ADA di berkas ini. Dengan
      // itu gadai bisa ikut menyertakan resi yang MENGGANTUNG (kalah berebut
      // baris, di luar periode) dan resi DOBEL — bukan cuma yang sudah divonis
      // "tidak ada di rekening". Tanpanya ia mengirim daftar lama yang aman.
      const res = await fetch(
        `${base}/api/transfer-klaim/tunggakan?sejak=${LANTAI_LAPIS2}` +
        (sSampai ? `&tercakup=${sSampai}` : ""), {
        headers: { Authorization: `Bearer ${c.gadai_api_key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const j = await res.json();
        if (j?.ok) {
          tunggakan = (j.items ?? []) as IsiLapis2["tunggakan"];

          // ── TELUSURI ULANG KE MUTASI YANG BARU DIUNGGAH ──
          //
          // Klaim yang sudah divonis UNMATCHED tidak pernah ditarik lagi, jadi
          // ia TIDAK ikut diuji otomatis pada unggahan berikutnya. Tanpa
          // penelusuran di sini, daftarnya cuma diulang apa adanya tiap hari
          // dan pemilik harus membuka /belum-cocok satu per satu hanya untuk
          // tahu apakah ada yang berubah.
          //
          // Ini TIDAK mencocokkan apa pun — hanya melapor apakah ada calon.
          // Penutupan tetap keputusan manusia di /belum-cocok, karena satu
          // baris bisa saja milik permintaan lain.
          for (const t of tunggakan) {
            try {
              const arahT = String((t as any).arah ?? "KREDIT").toUpperCase();
              const kol = arahT === "DEBET" ? "nominal_debet" : "nominal_kredit";
              // Jendela tanggal WAJIB, dan harus sama dengan yang dipakai
              // /belum-cocok (±4 hari). Tanpa itu cacahnya menghitung seluruh
              // riwayat — "ADA 12 baris bernominal sama" untuk klaim 4jt tidak
              // menolong siapa pun, ia cuma angka besar yang tidak bisa
              // ditindaklanjuti.
              const geserHariT = (n: number) => {
                const d = new Date(`${t.tgl}T00:00:00Z`);
                d.setUTCDate(d.getUTCDate() + n);
                return d.toISOString().slice(0, 10);
              };
              const { count } = await r.db
                .from("parsed_transactions")
                .select("id", { count: "exact", head: true })
                .eq("account_id", r.ctx.account.id)
                .is("claimed_by_input_id", null)
                .gte("tanggal", geserHariT(-4))
                .lte("tanggal", geserHariT(4))
                .gte(kol, Math.max(1, t.nominal - 50_000))
                .lte(kol, t.nominal + 50_000);
              (t as any).calonBebas = Number(count ?? 0);
            } catch {
              (t as any).calonBebas = null;   // gagal menelusuri != tidak ada
            }
          }
        }
        else gagal.push(`tunggakan tidak bisa dibaca: ${j?.msg ?? "-"}`);
      } else if (res.status === 404) {
        // Endpoint belum tayang — sebutkan, jangan diamkan.
        gagal.push("daftar tunggakan belum tersedia di Aceh Gadai (endpoint 404, kemungkinan belum di-promote)");
      } else {
        gagal.push(`tunggakan tidak bisa dibaca (HTTP ${res.status})`);
      }
    }
  } catch (e) {
    gagal.push(`tunggakan tidak bisa dibaca: ${e instanceof Error ? e.message : String(e)}`);
  }

  const isi: IsiLapis2 = {
    bankLabel: dariDb.bankLabel,
    namaFile: dariDb.namaFile,
    berkasDari: kredit?.periodStart ?? debet?.periodStart ?? null,
    berkasSampai: kredit?.periodEnd ?? debet?.periodEnd ?? null,
    nilaiDari: perTanggal[0]?.tgl ?? null,
    nilaiSampai: perTanggal[perTanggal.length - 1]?.tgl ?? null,
    utuh: berkas.utuh,
    rantaiPutus: Number(berkas.rantaiPutus ?? 0),
    nyambung: berkas.nyambung,
    selisihSambungan: Number(berkas.selisihSambungan ?? 0),
    perTanggal,
    nDiuji: perTanggal.reduce((s, x) => s + x.jml, 0),
    rpDiuji: perTanggal.reduce((s, x) => s + x.rp, 0),
    nCocok: pass.reduce((s, p) => s + Number(p.cocok ?? 0), 0),
    // Berapa yang "normal", berapa yang hasil penanganan manual. Angka manual
    // adalah bagian DARI nDiuji/nCocok, bukan tambahan atasnya.
    nManual: pass.reduce((s, p) => s + Number(p.manualDinilai ?? 0), 0),
    nManualCocok: pass.reduce((s, p) => s + Number(p.manualCocok ?? 0), 0),
    // Digabung dua arah. gerbangError dari arah mana pun cukup untuk membuat
    // seluruh laporan ini tidak boleh dibaca sebagai "sudah tersaring".
    tertahanGerbang: (() => {
      const ada = pass.map((p) => p.tertahanGerbang).filter(Boolean) as NonNullable<
        RingkasPass["tertahanGerbang"]
      >[];
      if (!ada.length) return null;          // tidak diketahui, bukan nol
      // Sebab yang sama dari dua arah HARUS dijumlah, bukan dicetak dua kali.
      // Dua baris "bukti belum dibaca mesin" pada satu laporan terbaca seperti
      // dua persoalan berbeda.
      const peta = new Map<string, { sebab: string; teks: string; n: number; rp: number }>();
      for (const x of ada) {
        for (const s of (x.perSebab ?? [])) {
          const k = String(s.sebab);
          const kini = peta.get(k) ?? { sebab: k, teks: String(s.teks ?? k), n: 0, rp: 0 };
          kini.n += Number(s.n ?? 0); kini.rp += Number(s.rp ?? 0);
          peta.set(k, kini);
        }
      }
      return {
        jml: ada.reduce((s, x) => s + Number(x.jml ?? 0), 0),
        rp: ada.reduce((s, x) => s + Number(x.rp ?? 0), 0),
        perSebab: [...peta.values()].sort((a, b) => b.rp - a.rp),
        gerbangError: ada.map((x) => x.gerbangError).find(Boolean) ?? null,
      };
    })(),
    tidakKetemu,
    ditahanLuarPeriode: pass.reduce((s, p) => s + Number(p.ditahanDiLuarPeriode ?? 0), 0),
    ditahanKonflik: pass.reduce((s, p) => s + Number(p.ditahanKonflik ?? 0), 0),
    kreditNganggur: rowsK,
    // Cacah UTUH yang belum pernah dilaporkan. Daftarnya dipotong 25 di
    // pipeline; menyebut cuma yang tampil berbunyi persis seperti "cuma segini".
    sisaKreditNganggur: Math.max(0, Number(kredit?.unclaimedBelumLapor ?? rowsK.length) - rowsK.length),
    rpKreditNganggur: rowsK.reduce((s, x) => s + Number(x.nominal || 0), 0),
    debetNganggur: rowsD,
    // Potongan admin ikut dikurangkan dari "sisa yang belum dilaporkan".
    // Tanpa ini, baris yang sengaja tidak dirinci akan muncul lagi sebagai
    // "…dan N lagi" — persis angka yang baru saja kita sembunyikan.
    sisaDebetNganggur: Math.max(
      0,
      Number(debet?.unclaimedBelumLapor ?? rowsDSemua.length) - rowsD.length - rowsDAdmin.length,
    ),
    rpDebetNganggur: rowsD.reduce((s, x) => s + Number(x.nominal || 0), 0),
    nBiayaAdmin: rowsDAdmin.length,
    rpBiayaAdmin: rowsDAdmin.reduce((s, x) => s + Number(x.nominal || 0), 0),
    // Ekor tanggal yang SENGAJA tidak diuji, dan apakah pemeriksaannya jalan.
    // Keduanya harus sampai ke laporan: "(0) karena bersih" dan "(0) karena
    // belum diperiksa" tidak boleh berbunyi sama.
    nganggurBatas: [kredit?.unclaimedBatas, debet?.unclaimedBatas]
      .filter((x): x is string => typeof x === "string" && !!x)
      .sort()[0] ?? null,
    nganggurDiperiksa: pass.length === 0
      ? false
      : pass.every((p) => p.unclaimedDiperiksa !== false),
    sandingan,
    sandinganGagal,
    // Alasan per klaim yang belum dijawab, dari pass berkas ini. Sisi gadai
    // tahu SIAPA yang menggantung (ketinggalan); sisi ini tahu KENAPA.
    alasanKlaim: pass.flatMap((p) => p.ditahanDaftar ?? []),
    tunggakan,
    gagal,
  };

  return susunLapis2(isi, { nomor: null, sebelumNomor: null, sebelumKapan: null });
}

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
    // Celah yang dilewati TETAP disebut tanggalnya. Menyembunyikannya sama
    // saja mengubah "saya memutuskan ini aman" jadi "tidak ada apa-apa di sini",
    // dan yang dibuktikan saldo hanyalah perubahan NETO nol — bukan ketiadaan
    // transaksi.
    if (cakupan.celahTerbuktiKosong.length > 0) {
      const daftar = cakupan.celahTerbuktiKosong
        .slice(0, 3)
        .map((c) => (c.dari === c.sampai ? tglID(c.dari) : `${tglID(c.dari)}–${tglID(c.sampai)}`))
        .join(", ");
      b.push(
        `   (dilewati karena saldo bertemu: ${daftar}` +
          (cakupan.celahTerbuktiKosong.length > 3 ? ` +${cakupan.celahTerbuktiKosong.length - 3} lagi` : "") +
          ")",
      );
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
  const teks = await susunLaporanLapis2(r, berkas, pass, dariDb, cakupan);

  // Penutupan ini adalah COMPARE-AND-SET, bukan update biasa.
  //
  // Tautan bisa diterbitkan ulang, dan halaman bisa terbuka di dua tempat.
  // Tanpa penjaga status, dua penutupan akan melahirkan DUA laporan Telegram
  // untuk berkas yang sama — dan kalau isinya berbeda (karena yang kedua
  // berjalan setelah keadaan berubah), pemiliknya menerima dua vonis yang
  // saling bertentangan tanpa cara tahu mana yang benar.
  const { data: ditutup } = await r.db
    .from("mutasi_jobs")
    .update({
      status: adaBatal ? "SELESAI_RAGU" : "SELESAI",
      langkah: "selesai",
      selesai_at: new Date().toISOString(),
      ringkasan: { berkas, pass } as any,
    })
    .eq("id", jobId)
    .eq("account_id", r.ctx.account.id)
    .in("status", ["ANTRI", "DIBUKA", "PARSE_OK", "KEDALUWARSA"])
    .select("id");

  if (!ditutup || ditutup.length === 0) {
    // Sudah ditutup pihak lain. Laporannya sudah (atau sedang) dikirim di sana.
    return { ok: true, teks };
  }

  // ── TUJUAN LAPORAN ──
  //
  // Laporan LAPIS 2 dikirim ke grup laporan kalau TG_LAPORAN_CHAT_ID di-set,
  // BUKAN ke chat tempat PDF-nya diunggah.
  //
  // Dua-duanya sengaja dipisah. Gerbang unggah tetap chat pribadi — itu
  // pengaman nyata: hanya pemilik yang boleh memasukkan mutasi rekening, dan
  // di grup siapa pun anggotanya bisa. Tapi LAPORANNYA harus mendarat di
  // tempat yang sama dengan LAPIS 1, supaya kedua lapisan bisa dibaca
  // bersisian dan angka per tanggalnya bisa disandingkan.
  const chatLaporan = String(process.env.TG_LAPORAN_CHAT_ID ?? "").trim()
    || (r.job.tg_chat_id ? String(r.job.tg_chat_id) : "");
  // Membalas pesan asli hanya masuk akal kalau laporannya memang mendarat di
  // chat yang sama; di grup lain, message_id itu tidak berarti apa-apa.
  const balasKe = chatLaporan === String(r.job.tg_chat_id ?? "")
    ? (r.job.tg_message_id ? Number(r.job.tg_message_id) : null)
    : null;

  if (chatLaporan) {
    // Lewat antrean, bukan kirim langsung: laporan hasil rekonsiliasi terlalu
    // mahal untuk hilang gara-gara satu panggilan jaringan yang gagal.
    await antreLaporan({
      accountId: r.ctx.account.id,
      chatId: chatLaporan,
      teks,
      balasKe,
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
