// ============================================================
// CEKTRANSFER - UANG DI MUTASI TANPA PEMILIK: batas rinci + bahan laporan
// File: lib/laporan/nganggur.ts
//
// SATU JANJI, dan berkas ini ada untuk menjaganya: baris yang distempel
// "sudah diberitahukan" (parsed_transactions.unclaimed_reported_at) WAJIB
// tercetak RINCI di laporan Lapis 2 yang sama. Baris yang tidak muat TIDAK
// distempel — ia terbaca lagi oleh PDF yang MULAI pada/sebelum tanggalnya,
// dan laporan menyebut tanggal itu. Bukan sekadar "laporan berikutnya":
// pembaca hanya membaca dari tanggal awal berkasnya sendiri, sedangkan saran
// export harian mulai dari akhir tercakup − 1 hari.
//
// Stempel dipasang SERVER (tandaiSelesai), SESUDAH laporan yang merincinya
// tercatat di antrean Telegram — bukan oleh peramban di akhir pass. Dulu
// peramban menstempel lebih dulu dan laporan disusun belakangan: pass debet
// yang melempar, layar yang ditutup di tengah, atau tab kedua yang kalah CAS
// meninggalkan baris berstempel yang tidak pernah tercetak di mana pun.
//
// Lubang yang ditutup (1 November 2026): pipeline membaca dan menstempel ≤25
// baris per arah, laporan hanya mencetak 8 pertama lalu "…dan N lagi". Baris
// ke-9..25 distempel tanpa pernah dirinci, dan stempel itu membuatnya tidak
// akan pernah dibaca lagi. Sejak rekening dibagi dua, SEMUA debet di PDF
// rekening MASUK 1994 jatuh ke blok ini — satu debet curang bisa tenggelam
// di antara transaksi pribadi Owner tanpa satu baris pun yang menyebutnya.
// Keputusan pemilik: rinci SEMUA, jangan dipotong di baris ke-8.
//
// Batas yang SAMA dipakai dua sisi — kueri pembaca di pipeline
// (lib/pipeline/nganggur.ts) dan penyusun laporan (lib/laporan/lapis2.ts).
// Dua angka yang ditulis terpisah akan menyimpang, dan selisihnya persis
// lubang di atas.
//
// MURNI: tanpa database, tanpa jaringan — dipakai juga oleh skrip uji.
// ============================================================

import type { IsiLapis2 } from "./lapis2";
import { adalahBiayaAdmin } from "../bank/biayaAdmin";

/** Baris tanpa pemilik yang dibaca SATU pass (satu arah) — dan karena itu
 *  juga yang dirinci dan (kalau pass-nya tidak batal) distempel. Lebih dari
 *  ini tidak dibaca, tidak distempel, dan disebut cacah + tanggal mulainya
 *  sebagai sisa.
 *  Panjang pesan tidak membatasi angka ini: laporan yang melewati batas
 *  Telegram dipecah (pecahPesanLapis2), bukan dipotong. */
export const BATAS_RINCI_NGANGGUR = 100;

/** Buang baris baru + potong — sama dengan `jinak` di proses/actions.ts. */
const jinak = (s: unknown, maks: number) => String(s ?? "").replace(/[\r\n]+/g, " ").slice(0, maks);

export interface BarisNganggur {
  tgl: string;
  jam: string;
  nominal: number;
  pihak: string;
  ket: string;
}

/** Kaki PINDAH SALDO resmi yang dikenali jembatan (lib/pipeline/pindahSaldo.ts):
 *  baris mutasi yang tadinya "tanpa pemilik", pemiliknya sesi PINDAH gadai. */
export interface BarisPindah extends BarisNganggur {
  /** id sesi gerbang PINDAH di Aceh Gadai (angka). */
  sesi: string;
  /** "1994 → 1919" — empat digit akhir rekening asal → tujuan. */
  rute: string;
}

/** Yang dibutuhkan dari satu ringkasan pass — RingkasPass (proses/actions.ts)
 *  maupun ringkasan job tersimpan (skrip kirim ulang). */
export interface PassNganggur {
  unclaimedRows?: BarisNganggur[];
  /** Cacah UTUH baris tanpa pemilik yang belum distempel, termasuk yang tidak
   *  ikut terbaca karena batas di atas. */
  unclaimedBelumLapor?: number;
  /** id parsed_transactions dari `unclaimedRows` (urutan sama) yang BOLEH
   *  distempel — diisi jalankanPass hanya pada pass yang vonisnya terkirim
   *  atau yang dilewati karena milik rekening lain. null/kosong = pass batal:
   *  dibaca dan dirinci, TIDAK distempel. */
  idNganggur?: string[] | null;
  /** JEMBATAN PINDAH SALDO: baris yang terbaca bersama `unclaimedRows` tapi
   *  dikenali sebagai kaki pindah saldo resmi — dirinci di blok sendiri.
   *  Tidak ada = gadai tidak mengirim sesi PINDAH (perilaku lama persis). */
  pindahRows?: BarisPindah[];
  /** id dari `pindahRows` (urutan sama) yang boleh distempel — aturan SAMA
   *  dengan idNganggur (null = pass batal). */
  idPindah?: string[] | null;
  /** Kalimat jembatan (tidak dipasangkan karena ragu, galat baca, …). */
  pindahCatatan?: string[];
}

/** Bentuk id yang diterima penstempel (uuid parsed_transactions). Saringan
 *  longgar — huruf, angka, tanda minus — cukup supaya isi dari peramban tidak
 *  bisa menyelipkan sintaks penyaring PostgREST ke dalam `.in()`. */
const ID_SAH = /^[0-9A-Za-z-]{1,64}$/;

/**
 * id yang distempel SERVER sesudah laporan dua pass ini tercatat. Pasangan
 * bahanNganggur: masukannya SAMA (pass kredit & debet yang dirinci), jadi yang
 * distempel tidak bisa lebih luas daripada yang dirinci.
 *
 * Pass yang id-nya tidak sejajar dengan daftarnya (cacah beda, melewati batas,
 * id tak sah) TIDAK distempel sama sekali. Arah galatnya "disebut lagi" —
 * aman; menstempel sebagian dengan tebakan justru lubang yang ditutup di sini.
 */
export function idStempelNganggur(
  kredit: PassNganggur | undefined,
  debet: PassNganggur | undefined,
): string[] {
  const sejajar = (idsM: unknown, rowsM: unknown): string[] => {
    const ids = Array.isArray(idsM) ? (idsM as unknown[]) : [];
    const rows = Array.isArray(rowsM) ? (rowsM as unknown[]) : [];
    if (ids.length === 0) return [];
    if (ids.length !== rows.length || ids.length > BATAS_RINCI_NGANGGUR) return [];
    if (!ids.every((x) => typeof x === "string" && ID_SAH.test(x))) return [];
    return ids as string[];
  };
  // Kaki pindah saldo (dirinci di blok PINDAH SALDO) dinilai terpisah dengan
  // aturan yang sama — sejajar dengan daftarnya sendiri, atau tidak sama sekali.
  const satu = (p: PassNganggur | undefined): string[] =>
    [...sejajar(p?.idNganggur, p?.unclaimedRows), ...sejajar(p?.idPindah, p?.pindahRows)];
  return [...new Set([...satu(kredit), ...satu(debet)])];
}

/**
 * Apakah SEMUA bagian laporan sudah aman: tercatat di antrean (penguras yang
 * menuntaskan kirimnya) atau terkirim langsung. Hanya sesudah ini baris tanpa
 * pemilik boleh distempel. Satu bagian yang tidak tercatat dan tidak terkirim
 * = laporannya bisa hilang = jangan stempel apa pun.
 */
export function laporanTercatat(antre: { terkirim: number; ids: number[] }, nBagian: number): boolean {
  if (nBagian <= 0) return false;
  return antre.ids.length === nBagian || antre.terkirim === nBagian;
}

/**
 * Bahan blok UANG DI MUTASI TANPA PEMILIK untuk IsiLapis2, dari dua pass.
 *
 * Sisa = baris yang TIDAK terbaca pass (melewati BATAS_RINCI_NGANGGUR) —
 * inilah yang belum distempel. Pembaca mengambil tanggal tertua dulu, jadi
 * setiap baris sisa bertanggal ≥ tanggal terakhir yang terbaca; tanggal itu
 * ikut dibawa (`mulaiSisa…`) supaya laporan bisa menyebut dari tanggal berapa
 * PDF berikutnya harus mulai. Baris yang terbaca (termasuk potongan admin,
 * yang distempel tapi sengaja tidak dirinci — keputusan pemilik 3 Sep 2026)
 * tidak pernah dihitung sebagai sisa.
 *
 * Baris bertanggal sebelum `lantai` tidak dicetak (keputusan lantai Lapis 2:
 * dianggap sudah beres dan diperiksa manual) dan juga tidak disebut sebagai
 * sisa — ia sudah terbaca, jadi menyebutnya "dirinci di laporan berikutnya"
 * akan berbohong.
 */
export function bahanNganggur(
  kredit: PassNganggur | undefined,
  debet: PassNganggur | undefined,
  lantai: string,
): Pick<IsiLapis2,
  "kreditNganggur" | "sisaKreditNganggur" | "rpKreditNganggur" |
  "debetNganggur" | "sisaDebetNganggur" | "rpDebetNganggur" |
  "nBiayaAdmin" | "rpBiayaAdmin" | "mulaiSisaKreditNganggur" | "mulaiSisaDebetNganggur" | "pindahSaldo"> {
  const kakiPindah = (p: PassNganggur | undefined) =>
    (Array.isArray(p?.pindahRows) ? p!.pindahRows! : []).slice(0, BATAS_RINCI_NGANGGUR);
  const siapkan = (p: PassNganggur | undefined) => {
    const terbaca = Array.isArray(p?.unclaimedRows) ? p!.unclaimedRows! : [];
    // Peramban standar tidak pernah mengirim lebih dari batas (batas kueri
    // pipeline). Pemotongan ini hanya rem banjir pesan untuk klien di luar
    // standar — kelebihannya ikut disebut sebagai sisa, bukan dibuang diam-diam.
    const dipakai = terbaca.slice(0, BATAS_RINCI_NGANGGUR);
    const sisa = Math.max(0, Number(p?.unclaimedBelumLapor ?? terbaca.length) - dipakai.length);
    // Tanggal terakhir yang TERBACA — termasuk potongan admin dan baris
    // pra-lantai, yang tidak dirinci tapi ikut mengisi jatah baca. Diambil
    // dari daftar rinci saja, tanggal ini bisa terlalu awal (masih benar,
    // hanya boros); diambil dari sini, ia tepat batas sisanya. Kaki pindah
    // saldo (jembatan) juga terbaca di jatah yang sama.
    const tglSah = [...dipakai, ...kakiPindah(p)].map((x) => String(x?.tgl ?? "")).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
    const mulaiSisa = sisa > 0 && tglSah.length ? tglSah.reduce((m, t) => (t > m ? t : m)) : null;
    // Barisnya datang dari peramban dan kini dicetak SEMUA ke Telegram —
    // baris baru di dalam nama tidak boleh bisa menyulap baris laporan palsu.
    const tampil = dipakai
      .filter((x) => String(x?.tgl ?? "") >= lantai)
      .map((x) => ({ ...x, jam: jinak(x.jam, 12), pihak: jinak(x.pihak, 80) }));
    return { tampil, sisa, mulaiSisa };
  };
  const jumlah = (xs: BarisNganggur[]) => xs.reduce((s, x) => s + Number(x.nominal || 0), 0);

  const k = siapkan(kredit);
  const d = siapkan(debet);
  // ── POTONGAN ADMIN BANK DIPISAH, BUKAN DIBUANG ── (lib/bank/biayaAdmin.ts)
  // Cacah & jumlahnya tetap dibawa ke laporan sebagai SATU baris.
  const dAdmin = d.tampil.filter((x) => adalahBiayaAdmin(x.nominal));
  const dRinci = d.tampil.filter((x) => !adalahBiayaAdmin(x.nominal));
  return {
    kreditNganggur: k.tampil,
    sisaKreditNganggur: k.sisa,
    rpKreditNganggur: jumlah(k.tampil),
    debetNganggur: dRinci,
    sisaDebetNganggur: d.sisa,
    rpDebetNganggur: jumlah(dRinci),
    nBiayaAdmin: dAdmin.length,
    rpBiayaAdmin: jumlah(dAdmin),
    mulaiSisaKreditNganggur: k.mulaiSisa,
    mulaiSisaDebetNganggur: d.mulaiSisa,
    // Medan ini HANYA ada bila jembatan pindah saldo berbicara — tanpa itu
    // isi laporan (dan teksnya) sama persis dengan sebelum jembatan ada.
    ...bahanPindahSaldo(kredit, debet, lantai, kakiPindah),
  };
}

/**
 * Blok PINDAH SALDO RESMI untuk IsiLapis2: kaki yang dikenali (lantai sama
 * dengan daftar tanpa pemilik; dijinakkan — datang dari peramban) + catatan
 * jembatan. {} bila tidak ada apa pun yang perlu dikatakan.
 */
function bahanPindahSaldo(
  kredit: PassNganggur | undefined,
  debet: PassNganggur | undefined,
  lantai: string,
  kakiPindah: (p: PassNganggur | undefined) => BarisPindah[],
): Pick<IsiLapis2, "pindahSaldo"> | Record<string, never> {
  const bentuk = (xs: BarisPindah[], arah: "keluar" | "masuk") => xs
    .filter((x) => String(x?.tgl ?? "") >= lantai)
    .map((x) => ({
      // Jam hanya angka & pemisah — tidak ada emoji/huruf dari peramban di baris 🔁.
      tgl: String(x.tgl ?? ""), jam: String(x.jam ?? "").replace(/[^0-9.:]/g, "").slice(0, 8), nominal: Number(x.nominal || 0),
      sesi: String(x.sesi ?? "").replace(/\D/g, "").slice(0, 18) || "?",
      rute: jinak(x.rute, 20), arah,
    }));
  const baris = [...bentuk(kakiPindah(debet), "keluar"), ...bentuk(kakiPindah(kredit), "masuk")];
  const catatan = [...(debet?.pindahCatatan ?? []), ...(kredit?.pindahCatatan ?? [])]
    .filter((c) => typeof c === "string" && c.trim() !== "")
    .slice(0, 10)
    .map((c) => jinak(c, 300));
  if (!baris.length && !catatan.length) return {};
  return { pindahSaldo: { baris, catatan } };
}
