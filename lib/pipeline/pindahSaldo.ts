// ============================================================
// KANAL MASUK MUTASI — JEMBATAN PINDAH SALDO (rekening MASUK → KIRIM)
// File: lib/pipeline/pindahSaldo.ts
//
// LAHIR 1 November 2026 (Dua Rekening + Gerbang Token). Owner memindahkan
// uang dari rekening MASUK (1994) ke rekening KIRIM (1919) lewat menu resmi
// "Pindah Saldo" di Aceh Gadai (/pusat/pindah-saldo; sesi gerbang jenis
// PINDAH). Pindah saldo itu BUKAN klaim transfer_klaim, jadi di Lapis 2 dua
// kakinya jatuh ke blok UANG DI MUTASI TANPA PEMILIK:
//   - debet 1994 → "🔴 UANG KELUAR TANPA ALASAN" (padahal Owner sendiri);
//   - kredit 1919 → "uang masuk tanpa pemilik".
// Alarm yang berbunyi untuk setiap pindah saldo resmi membuat alarm
// sungguhan berhenti dibaca.
//
// KONTRAK (gadai lib/gerbang/pindahLapis2.ts → GET /api/transfer-klaim,
// medan `pindah`; HANYA dikirim bila saklar gadai `gerbang_pindah` DAN
// `gerbang_pindah_lapis2` keduanya ON — kunci tak ada = OFF):
//   pindah: { versi: 1, rek_asal: "1999881994", rek_tujuan: "1999881919",
//             sesi: [{ id, nominal, dibuat_at, debit_at|null, kredit_at,
//                      selesai_at }], galat?, dilewati? }
//   Hanya sesi PINDAH berstatus SELESAI (SMS kredit 1919 bernominal sama
//   sudah menutupnya di gadai). Medan tidak ada = gadai versi lama / saklar
//   OFF → SEMUA jalur di sini diam dan Lapis 2 PERSIS seperti sebelumnya.
//
// ATURAN PASANG (sengaja ketat — satu salah pasang membungkam satu uang
// keluar selamanya, karena barisnya ikut distempel "sudah diberitahukan"):
//   1. Kaki hanya di rekening yang TERBUKTI miliknya: debet di berkas
//      rekening MASUK bernomor rek_asal, kredit di berkas rekening KELUAR
//      bernomor rek_tujuan (aturan rekening Tahap 2 aktif, nomor kepala PDF
//      terbukti). Selain itu: tidak ada yang dipasangkan.
//   2. Nominal SAMA PERSIS, waktu bank baris (tanggal + jam WIB) di dalam
//      jendela JAM BANK sesi [min(kredit_at, debit_at) − 10 mnt,
//      max(kredit_at, debit_at) + 10 mnt] — pindah intra-BSI 1994 → 1919
//      terbukukan di menit yang sama di kedua rekening. dibuat_at/selesai_at
//      hanya PAGAR LUAR (jendela dipotong ke [dibuat − 10, selesai + 10]);
//      keduanya bisa berjam-jam dari jam bank (PDF sebagian hari, sesi
//      DEBIT_TELAT yang kreditnya datang belakangan) dan dulu menelan debet
//      lain bernominal sama (tinjauan 2 Nov, uji serang S1). Selisih
//      debit_at–kredit_at > 30 mnt, atau kredit_at di luar pagar = data
//      janggal → tidak dipasangkan.
//   2b. Kaki DEBET 1994 lebih ketat (tinjauan 2 Nov): debit_at WAJIB ada
//      (gadai melihat SMS debit 1994 sesi itu) DAN keterangan bank baris
//      berakhiran "TRF Ke - PT ACEH GADAI SYARIAH" (dicocokkan di UJUNG,
//      "TRF Ke" tepat sekali — berita di awal keterangan diketik pengirim).
//      Kaki KREDIT 1919 belum memakai pola keterangan: PDF 1919 belum pernah
//      diunggah, bentuknya belum diketahui.
//   3. Calon dihitung dari SEMUA baris rekening itu di database (yang sudah
//      diklaim, sudah distempel, dari berkas lain — kecuali yang dihapus),
//      bukan hanya baris yang sedang dibaca. Tepat SATU calon → dipasangkan;
//      dua atau lebih → TIDAK ditebak (catatan, barisnya tetap tanpa pemilik).
//      Baris tanpa jam di tanggal jendela ikut dihitung calon (tidak bisa
//      dibuktikan di luar jendela).
//   4. Satu sesi = satu baris per kaki; satu baris = satu sesi. Baris yang
//      menjadi calon tunggal dua sesi → keduanya tidak dipasangkan.
//   5. Calon tunggal yang sudah dipegang klaim lain → tidak dipasangkan
//      (catatan: pemiliknya perlu dilihat).
//   CATATAN ℹ️ "DISEBUT SEKALI" (tinjauan 2 Nov): kalimat ragu / janggal /
//   ditolak hanya dicetak bila minimal satu baris calon sesi itu SEDANG
//   dibaca sebagai tanpa pemilik (idTerbaca) — baris yang sudah distempel
//   tidak disebut lagi, kalimatnya pun tidak. "Dipegang klaim lain" hanya
//   di pass yang mengklaim baris itu (idDiklaimPassIni).
//   Galat baca calon = tidak ada yang dipasangkan + catatan; TIDAK PERNAH
//   membuat pemeriksaan tanpa pemilik "tidak jalan".
//
// Murni kecuali bacaCalonPindah (kueri). Diuji scripts/uji-pindah-saldo.mts.
// ============================================================
/* eslint-disable @typescript-eslint/no-explicit-any -- baris DB tanpa tipe, sama seperti nganggur.ts */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AturanRekening } from "@/lib/pipeline/rekeningKlaim";

/** Satu sesi PINDAH SELESAI dari gadai (sudah divalidasi). Waktu = epoch ms. */
export interface SesiPindah {
  id: string;
  nominal: number;
  dibuatMs: number;
  debitMs: number | null;
  kreditMs: number;
  selesaiMs: number;
}

/** Medan `pindah` jawaban GET /api/transfer-klaim, sesudah dibaca. */
export interface KirimanPindah {
  rekAsal: string;
  rekTujuan: string;
  sesi: SesiPindah[];
  /** Gadai gagal membaca sesinya — tidak ada yang bisa dipasangkan. */
  galat: string | null;
  /** Sesi SELESAI yang dilewati gadai karena datanya janggal. */
  dilewati: number;
  /** Sesi di muatan yang dibuang di sini karena bentuknya tidak sah. */
  ditolak: number;
}

/** Kaki pindah saldo yang dinilai satu pass. */
export type KakiPindah = "DEBET_ASAL" | "KREDIT_TUJUAN";

/** Sela di kiri-kanan jendela sesi — jam PDF dibulatkan ke menit, jam server
 *  dan jam bank bisa berselisih, SMS bisa terlambat diteruskan. */
export const SELA_PINDAH_MS = 10 * 60_000;
/** Selisih jam bank SMS debit 1994 dan SMS kredit 1919 satu sesi yang masih
 *  wajar. Pindah intra-BSI terbukukan di menit yang sama di kedua rekening;
 *  lebih dari ini = salah satu jam SMS tidak bisa dipercaya → jendela
 *  janggal, tidak dipasangkan. */
export const SELISIH_MAKS_DEBIT_KREDIT_MS = 30 * 60_000;
/** Paling banyak sesi yang dibaca dari satu muatan (rem muatan aneh). */
export const BATAS_SESI_PINDAH = 500;

const digit = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const ms = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
};
/** id sesi: angka saja (dicetak ke Telegram). */
const ID_SESI = /^[0-9]{1,18}$/;

/**
 * Baca medan `pindah` dari jawaban gadai. Murni, tidak melempar.
 * null = medan tidak ada / bukan objek → perilaku lama persis.
 */
export function bacaKirimanPindah(mentah: unknown): KirimanPindah | null {
  if (!mentah || typeof mentah !== "object" || Array.isArray(mentah)) return null;
  const p = mentah as Record<string, unknown>;
  const rekAsal = digit(p.rek_asal);
  const rekTujuan = digit(p.rek_tujuan);
  const galatMentah = p.galat ? String(p.galat).replace(/[\r\n]+/g, " ").slice(0, 120) : null;
  const dilewati = Math.max(0, Math.floor(Number(p.dilewati ?? 0)) || 0);
  // Rekening asal/tujuan wajib ada & berbeda — tanpa itu tidak bisa
  // dipastikan kaki mana milik berkas mana.
  if (!rekAsal || !rekTujuan || rekAsal === rekTujuan) {
    return { rekAsal, rekTujuan, sesi: [], galat: galatMentah ?? "rekening pindah saldo tidak sah", dilewati, ditolak: 0 };
  }
  const daftar = Array.isArray(p.sesi) ? p.sesi : [];
  const sesi: SesiPindah[] = [];
  const idDipakai = new Set<string>();
  let ditolak = 0;
  for (const x of daftar.slice(0, BATAS_SESI_PINDAH)) {
    const s = (x ?? {}) as Record<string, unknown>;
    const id = String(s.id ?? "");
    const nominal = Number(s.nominal);
    const dibuatMs = ms(s.dibuat_at);
    const kreditMs = ms(s.kredit_at);
    const selesaiMs = ms(s.selesai_at);
    const debitMs = ms(s.debit_at);
    const sah = ID_SESI.test(id) && !idDipakai.has(id) &&
      Number.isSafeInteger(nominal) && nominal > 0 &&
      dibuatMs !== null && kreditMs !== null && selesaiMs !== null &&
      (s.debit_at === null || s.debit_at === undefined || debitMs !== null);
    if (!sah) { ditolak++; continue; }
    idDipakai.add(id);
    sesi.push({ id, nominal, dibuatMs: dibuatMs!, debitMs, kreditMs: kreditMs!, selesaiMs: selesaiMs! });
  }
  ditolak += Math.max(0, daftar.length - BATAS_SESI_PINDAH);
  return { rekAsal, rekTujuan, sesi, galat: galatMentah, dilewati, ditolak };
}

/**
 * Kaki pindah saldo yang dinilai pass ini, atau null (tidak ada yang
 * dipasangkan). Murni.
 */
export function kakiPindahBerkas(o: {
  kiriman: KirimanPindah | null | undefined;
  aturan: AturanRekening;
  bankId: string;
  jenis: "kredit" | "debet";
  /** BankUpload.rekeningTerbukti — nomor kepala PDF benar-benar dibandingkan. */
  rekeningTerbukti: boolean;
}): KakiPindah | null {
  const k = o.kiriman;
  if (!k || !o.aturan.aktif || !o.rekeningTerbukti || !o.bankId) return null;
  if (o.jenis === "debet") {
    return o.aturan.nomorKeId[k.rekAsal] === o.bankId && o.bankId === o.aturan.masukId ? "DEBET_ASAL" : null;
  }
  return o.aturan.nomorKeId[k.rekTujuan] === o.bankId && o.bankId === o.aturan.keluarId ? "KREDIT_TUJUAN" : null;
}

/** Jam bank SMS satu sesi (kredit 1919, + debit 1994 bila terlihat). */
const jamBankSesi = (s: SesiPindah): number[] => (s.debitMs !== null ? [s.kreditMs, s.debitMs] : [s.kreditMs]);

/**
 * Jendela waktu bank satu sesi (epoch ms), atau null bila janggal. Murni.
 * Dipusatkan ke JAM BANK SMS: [min(kredit, debit) − sela, max(kredit,
 * debit) + sela], dipotong pagar luar [dibuat − sela, selesai + sela]
 * (aturan 2). dibuat_at/selesai_at sendiri TIDAK memperlebar jendela.
 */
export function jendelaPindah(s: SesiPindah): { awal: number; akhir: number } | null {
  const bank = jamBankSesi(s);
  if (![...bank, s.dibuatMs, s.selesaiMs].every(Number.isFinite)) return null;
  if (s.debitMs !== null && Math.abs(s.debitMs - s.kreditMs) > SELISIH_MAKS_DEBIT_KREDIT_MS) return null;
  const pagarAwal = s.dibuatMs - SELA_PINDAH_MS;
  const pagarAkhir = s.selesaiMs + SELA_PINDAH_MS;
  // Kredit 1919 sebelum sesi dibuat / sesudah sesi ditutup mustahil untuk
  // sesi wajar (gadai menutup sesi SAAT SMS kredit itu diterima).
  if (s.kreditMs < pagarAwal || s.kreditMs > pagarAkhir) return null;
  const awal = Math.max(Math.min(...bank) - SELA_PINDAH_MS, pagarAwal);
  const akhir = Math.min(Math.max(...bank) + SELA_PINDAH_MS, pagarAkhir);
  return akhir >= awal ? { awal, akhir } : null;
}

/**
 * Rentang tanggal WIB yang dibaca untuk satu sesi: tanggal jendelanya, atau
 * — bila jendelanya janggal — tanggal jam bank SMS-nya (supaya catatan
 * "janggal" hanya dicetak bila barisnya sedang disebut). Murni.
 */
export function rentangTanggalPindah(s: SesiPindah): { dari: string; sampai: string } {
  const j = jendelaPindah(s);
  const bank = jamBankSesi(s);
  const a = j ? j.awal : Math.min(...bank) - SELA_PINDAH_MS;
  const b = j ? j.akhir : Math.max(...bank) + SELA_PINDAH_MS;
  return { dari: tanggalWib(a), sampai: tanggalWib(b) };
}

/** Ujung keterangan BSI untuk transfer KE rekening atas nama PT — bentuk
 *  pindah 1994 → 1919 sungguhan di PDF 1994 (31 Okt 2026 23.02): "<berita>
 *  - TRF Ke - PT ACEH GADAI SYARIAH". Debet ke pihak ketiga berujung nama
 *  penerimanya ("… TRF Ke - <nama>"). */
const UJUNG_TRF_KE_PT = /TRF\s+Ke\s*-\s*PT\s+ACEH\s+GADAI\s+SYARIAH\s*$/i;

/**
 * Keterangan bank baris debet 1994 = transfer ke rekening PT? Murni.
 * Dicocokkan di UJUNG (bukan "mengandung"): berita di awal keterangan
 * diketik pengirim. "TRF Ke" wajib TEPAT SEKALI: berita yang sendiri memuat
 * "TRF Ke - PT ACEH GADAI SYARIAH" tidak bisa membuat debet ke orang lain
 * lolos, di format mana pun berita itu diletakkan.
 */
export function keteranganKePt(deskripsi: unknown): boolean {
  const d = String(deskripsi ?? "");
  return UJUNG_TRF_KE_PT.test(d) && (d.match(/TRF\s+Ke\b/gi) ?? []).length === 1;
}

/** Tanggal WIB (YYYY-MM-DD) dari epoch ms. */
export function tanggalWib(t: number): string {
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Waktu bank satu baris mutasi (epoch ms) dari tanggal + jam WIB. Jam BSI
 * BSINet "HH.MM"; bentuk "HH:MM(:SS)" juga diterima. null = jam tak terbaca.
 * Jam dibulatkan ke menit oleh bank — awal menitnya yang dipakai; sela
 * jendela menampung sisanya.
 */
export function waktuBaris(tanggal: unknown, jam: unknown): number | null {
  const tgl = String(tanggal ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tgl)) return null;
  const m = String(jam ?? "").trim().match(/^(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  const t = Date.parse(`${tgl}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+07:00`);
  return Number.isFinite(t) ? t : null;
}

/** Satu baris calon dari database (rekening berkas, nominal sesi). */
export interface CalonPindah {
  id: string;
  tanggal: string;
  jam: string | null;
  claimed_by_input_id: string | null;
  /** Keterangan bank (parsed_transactions.deskripsi) — aturan 2b. */
  deskripsi?: string | null;
}

export interface HasilPasangPindah {
  /** id baris mutasi → id sesi PINDAH. */
  pasangan: Map<string, string>;
  /** Kalimat untuk laporan (tanpa baris baru). */
  catatan: string[];
}

const rpTeks = (n: number) => "Rp " + Math.round(Number(n || 0)).toLocaleString("id-ID");

/**
 * Pasangkan sesi dengan baris yang SEDANG dibaca sebagai tanpa pemilik.
 * Murni.
 *
 * @param calonPerSesi id sesi → SEMUA baris rekening ini bernominal sesi itu
 *   di tanggal-tanggal jendelanya (lihat bacaCalonPindah). Sesi yang tidak
 *   ada di peta tidak dinilai.
 * @param idTerbaca id baris tanpa pemilik yang dibaca pass ini — hanya ini
 *   yang bisa dipindah ke blok PINDAH SALDO, dan hanya sesi yang salah satu
 *   barisnya ada di sini yang boleh diberi catatan (disebut sekali).
 * @param kaki kaki yang dinilai pass ini (kakiPindahBerkas) — DEBET_ASAL
 *   memakai aturan 2b.
 * @param idDiklaimPassIni id baris yang diklaim pass ini (jaring idTerpakai
 *   bacaBarisNganggur) — catatan "dipegang klaim lain" hanya di pass itu.
 */
export function pasangkanPindah(o: {
  sesi: SesiPindah[];
  calonPerSesi: Map<string, CalonPindah[]>;
  idTerbaca: Set<string>;
  kaki: KakiPindah;
  idDiklaimPassIni?: Set<string>;
}): HasilPasangPindah {
  const catatan: string[] = [];
  // Disebut sekali: catatan sesi hanya bila barisnya sedang dibaca sebagai
  // tanpa pemilik. Baris yang sudah distempel tidak dirinci lagi — catatan
  // tentangnya di laporan berikutnya hanya mengulang (dan isinya keliru).
  const disebut = (xs: CalonPindah[]) => xs.some((c) => o.idTerbaca.has(String(c.id)));
  // Calon per sesi sesudah saringan jendela, dan sesi per baris — baris yang
  // masuk jendela LEBIH DARI SATU sesi tidak pernah dipasangkan, walaupun ia
  // calon tunggal salah satunya (aturan 4).
  const tunggal = new Map<string, CalonPindah>();
  const sesiPerBaris = new Map<string, string[]>();
  for (const s of o.sesi) {
    const calon = o.calonPerSesi.get(s.id);
    if (!calon) continue;
    const j = jendelaPindah(s);
    if (!j) {
      if (disebut(calon)) catatan.push(`pindah saldo sesi #${s.id} ${rpTeks(s.nominal)}: jendela waktunya janggal — tidak dipasangkan.`);
      continue;
    }
    const dAwal = tanggalWib(j.awal), dAkhir = tanggalWib(j.akhir);
    const kena = calon.filter((c) => {
      const t = waktuBaris(c.tanggal, c.jam);
      if (t === null) {
        // Tanpa jam: tidak bisa dibuktikan di luar jendela → tetap calon.
        const d = String(c.tanggal ?? "").slice(0, 10);
        return d >= dAwal && d <= dAkhir;
      }
      return t >= j.awal && t <= j.akhir;
    });
    for (const c of kena) {
      const ada = sesiPerBaris.get(String(c.id)) ?? [];
      if (!ada.includes(s.id)) sesiPerBaris.set(String(c.id), [...ada, s.id]);
    }
    if (kena.length === 1) tunggal.set(s.id, kena[0]);
    else if (kena.length > 1 && disebut(kena)) {
      catatan.push(`pindah saldo sesi #${s.id} ${rpTeks(s.nominal)}: ${kena.length} baris bernominal sama di jendela waktunya — TIDAK dipasangkan (tidak ditebak); yang tampil di daftar tanpa pemilik tetap dihitung tanpa pemilik.`);
    }
  }
  // Satu baris = satu sesi.
  const pasangan = new Map<string, string>();
  for (const s of o.sesi) {
    const c = tunggal.get(s.id);
    if (!c) continue;
    const id = String(c.id);
    const terbaca = o.idTerbaca.has(id);
    const pemakai = sesiPerBaris.get(id) ?? [];
    if (pemakai.length > 1) {
      if (terbaca) catatan.push(`pindah saldo sesi #${s.id} ${rpTeks(s.nominal)}: barisnya juga masuk jendela sesi #${pemakai.filter((x) => x !== s.id).join(", #")} — TIDAK dipasangkan.`);
      continue;
    }
    if (c.claimed_by_input_id) {
      // Baris berklaim tidak pernah dibaca sebagai tanpa pemilik — ia
      // "disebut" hanya di pass yang mengklaimnya.
      if (o.idDiklaimPassIni?.has(id)) catatan.push(`pindah saldo sesi #${s.id} ${rpTeks(s.nominal)}: barisnya sudah dipegang klaim transaksi lain — TIDAK dipasangkan; periksa pemilik baris itu.`);
      continue;
    }
    // Sudah distempel / di luar jangkauan baca berkas ini → tidak ada yang
    // dipindah (barisnya memang tidak sedang disebut).
    if (!terbaca) continue;
    if (o.kaki === "DEBET_ASAL") {
      // Aturan 2b. Sesi SELESAI hanya membuktikan KREDIT 1919 bernominal
      // sama (gadai mencocokkan nominal + jendela token saja) — bukan bahwa
      // debet 1994 INI kakinya. Tidak lolos → tetap 🔴 (arah aman).
      if (s.debitMs === null) {
        catatan.push(`pindah saldo sesi #${s.id} ${rpTeks(s.nominal)}: SMS debit 1994-nya tidak pernah terlihat di Aceh Gadai — kaki debet TIDAK dipasangkan; periksa baris itu.`);
        continue;
      }
      if (!keteranganKePt(c.deskripsi)) {
        catatan.push(`pindah saldo sesi #${s.id} ${rpTeks(s.nominal)}: keterangan bank barisnya bukan transfer ke rekening PT ACEH GADAI SYARIAH — TIDAK dipasangkan; periksa baris itu.`);
        continue;
      }
    }
    pasangan.set(id, s.id);
  }
  return { pasangan, catatan };
}

/** Sesi yang jendelanya menyentuh rentang tanggal [dari, sampai]. Murni. */
export function sesiDalamRentang(sesi: SesiPindah[], dari: string, sampai: string): SesiPindah[] {
  return sesi.filter((s) => {
    // Jendela janggal tetap diteruskan supaya pasangkanPindah bisa
    // menyebutnya, tapi hanya bila tanggal jam bank SMS-nya di rentang ini.
    const r = rentangTanggalPindah(s);
    return r.dari <= sampai && r.sampai >= dari;
  });
}

/**
 * Baca SEMUA baris rekening ini bernominal sesi di tanggal jendelanya —
 * termasuk yang sudah diklaim / distempel (keunikan dinilai di sini, bukan
 * hanya di antara baris yang sedang dibaca). MELEMPAR bila kueri ditolak;
 * pemanggil (bacaBarisNganggur) menangkapnya jadi catatan tanpa pasangan.
 */
export async function bacaCalonPindah(
  supabase: SupabaseClient<any, any, any>,
  o: { accountId: string; bankId: string; kolom: "nominal_debet" | "nominal_kredit"; sesi: SesiPindah[] },
): Promise<Map<string, CalonPindah[]>> {
  const peta = new Map<string, CalonPindah[]>();
  for (const s of o.sesi) {
    // Sesi berjendela janggal tetap dibaca (tanggal jam bank SMS-nya) —
    // tidak untuk dipasangkan, hanya supaya catatannya ikut aturan disebut
    // sekali (pasangkanPindah).
    const r = rentangTanggalPindah(s);
    const { data, error } = await supabase
      .from("parsed_transactions")
      .select("id, tanggal, jam, claimed_by_input_id, deskripsi")
      .eq("account_id", o.accountId)
      .eq("bank_id", o.bankId)
      .eq(o.kolom, s.nominal)
      .gte("tanggal", r.dari)
      .lte("tanggal", r.sampai)
      .is("deleted_at", null)
      .limit(50);
    if (error) throw new Error(`baca calon pindah saldo ditolak: ${error.message}`);
    peta.set(s.id, ((data ?? []) as any[]).map((r) => ({
      id: String(r.id),
      tanggal: String(r.tanggal ?? "").slice(0, 10),
      jam: r.jam == null ? null : String(r.jam),
      claimed_by_input_id: r.claimed_by_input_id ? String(r.claimed_by_input_id) : null,
      deskripsi: r.deskripsi == null ? null : String(r.deskripsi),
    })));
  }
  return peta;
}

/** "1994 → 1919" — empat digit akhir saja (laporan & halaman web). */
export function rutePindah(k: Pick<KirimanPindah, "rekAsal" | "rekTujuan">): string {
  return `${k.rekAsal.slice(-4)} → ${k.rekTujuan.slice(-4)}`;
}
