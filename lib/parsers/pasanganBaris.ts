// ============================================================
// PASANGAN BARIS — satu baris PDF ↔ satu baris database
// File: lib/parsers/pasanganBaris.ts
//
// LAHIR DARI Tahap 1 (Okt 2026), sesudah backtest 89 PDF arsip menemukan
// dua cacat di database mutasi:
//   - BARIS HILANG: bank memakai nomor referensi YANG SAMA untuk debet dan
//     kredit retur BI-FAST, dan kadang untuk transfer + biaya admin 2.500-nya.
//     Penyaring lama (no_ref saja) membuang baris kedua diam-diam.
//   - BARIS GANDA: transaksi yang sama tersimpan dua kali dengan identitas
//     berbeda — sekali tanpa ref (parser lama), sekali ber-ref (5 Agu 2026).
//     Indeks unik tidak bisa melihatnya karena identitasnya memang beda.
//
// Fungsi di berkas ini MURNI (tanpa database) dan dipakai di TIGA tempat
// supaya ketiganya tidak pernah berbeda pendapat:
//   1. persistTransactions — baris mana yang benar-benar baru (disisipkan);
//   2. petakanKeDatabase   — id database untuk setiap baris PDF (pencocokan);
//   3. petakanKeDatabase   — bukti sesudah simpan: hilang / ganda.
//
// CARA MEMASANGKAN (berurutan, setiap baris DB dipakai paling banyak sekali):
//   1. IDENTITAS — kunci yang sama dengan indeks unik database:
//      ref + arah + nominal, atau fingerprint untuk baris tanpa ref.
//      Saldo SENGAJA tidak ikut: BSI kadang membukukan kredit belakangan
//      dengan jam mundur (27 Sep 2026), sehingga saldo baris lama yang sudah
//      tersimpan bergeser di PDF berikutnya. Barisnya sama.
//   2. ISI — (tanggal, jam, kredit, debet, saldo) dengan baris DB AKTIF yang
//      belum terpakai. Ini yang mencegah ganda: transaksi yang sudah
//      tersimpan dengan identitas lain (tanpa ref / ref terbaca beda) TIDAK
//      disisipkan lagi. Aman terhadap retur yang diulang dalam menit yang
//      sama (debet → kredit → debet, saldo kembali sama): baris DB yang sudah
//      dipakai langkah 1 tidak bisa dipakai lagi, jadi debet kedua tetap
//      dianggap baru.
//   2b. TANPA SALDO — sisa baris PDF ↔ baris DB AKTIF TANPA REF yang belum
//      terpakai, kunci (tanggal, jam, kredit, debet), HANYA bila jumlahnya
//      per kunci SAMA di kedua sisi. Untuk baris lama tanpa ref yang saldonya
//      bergeser (kredit dibukukan belakangan) — fingerprint & kunci isinya
//      sama-sama memuat saldo, jadi langkah 1 dan 2 tidak melihatnya. Jumlah
//      yang tidak sama = ambigu → tidak dipasangkan (lalu tertahan sebagai
//      ganda di bawah, bukan ditebak).
//   3. TERHAPUS — baris yang identitasnya hanya ada sebagai baris terhapus
//      (soft-delete "Hapus Data"). Tidak bisa disisipkan ulang (indeks unik
//      ikut baris terhapus); persistTransactions MENGHIDUPKANNYA kembali —
//      PDF yang diunggah ulang memuatnya, jadi ia memang ada di rekening.
//      KECUALI masih ada baris AKTIF tak terpakai dengan (tanggal, jam,
//      nominal) yang sama: itu tanda salinan gandanya sengaja dihapus —
//      tidak dihidupkan, dihitung hilang, dan baris aktif itu tertahan ganda.
//
// GANDA = baris DB AKTIF yang tidak terpakai dan (tanggal, jam, nominal)-nya
// muncul di PDF. Sengaja tanpa saldo: salinan lama yang saldonya bergeser
// tetap tertangkap. Semua jalur yang ragu berakhir di sini atau di hilang —
// keduanya MENAHAN Lapis 2, tidak ada yang ditebak diam-diam.
//
// SIDIK JARI BERURUTAN (baris tanpa ref): dua transaksi tanpa ref yang isinya
// persis sama di hari yang sama (BCA/BNI tanpa jam & saldo: dua transfer
// 50.000 dari nasabah berbeda) dulu berbagi satu fingerprint, jadi yang kedua
// terbuang. Kemunculan ke-2 dst. kini diberi akhiran "|#2", "|#3" — urutan
// di PDF stabil antar-unggahan untuk hari yang sama. Kemunculan PERTAMA tetap
// memakai format lama, jadi baris yang sudah tersimpan tidak tergandakan.
// Langkah 1 lebih dulu untuk SEMUA baris sebelum langkah 2 — kalau tidak,
// sebuah baris bisa "mencuri" pasangan identitas milik baris lain.
// ============================================================

import type { ParsedTxRow } from "./types";

/** Kolom parsed_transactions yang dibutuhkan untuk memasangkan. */
export type BarisDb = {
  id: string;
  no_ref: string | null;
  fingerprint: string | null;
  tanggal: string; // YYYY-MM-DD
  jam: string | null;
  nominal_kredit: number;
  nominal_debet: number;
  saldo: number | null;
  deleted_at: string | null;
  claimed_by_input_id?: string | null;
};

export const KOLOM_BARIS_DB =
  "id, no_ref, fingerprint, tanggal, jam, nominal_kredit, nominal_debet, saldo, deleted_at, claimed_by_input_id";

/** Arah baris mutasi — HARUS sama dengan kolom terhitung `arah` di database. */
export function arahBaris(row: Pick<ParsedTxRow, "debet">): "D" | "K" {
  return (row.debet || 0) > 0 ? "D" : "K";
}

/**
 * Fingerprint untuk row tanpa no_ref. Format: "tgl|jam|kredit|debet|saldo".
 * JANGAN diubah: nilainya tersimpan di kolom fingerprint dan menjadi kunci
 * indeks unik baris tanpa ref.
 */
export function computeFingerprint(row: ParsedTxRow): string {
  return [row.tanggal, row.waktu, row.kredit, row.debet, row.saldo ?? ""].join("|");
}

/** Tanggal YYYY-MM-DD persis seperti yang ditulis ke kolom `tanggal`. */
export function tanggalDb(row: Pick<ParsedTxRow, "tanggalDate">): string {
  return row.tanggalDate.toISOString().split("T")[0];
}

function kunciRef(noRef: string, debet: number, kredit: number): string {
  return `ref:${noRef}|${debet > 0 ? "D" : "K"}|${debet}|${kredit}`;
}

/**
 * Fingerprint per baris (null untuk baris ber-ref), dengan akhiran urutan
 * untuk kemunculan ke-2 dst. dari isi yang sama — lihat catatan kepala.
 * Nilai inilah yang ditulis ke kolom fingerprint.
 */
export function sidikJariSemua(rows: ParsedTxRow[]): (string | null)[] {
  const ke = new Map<string, number>();
  return rows.map((r) => {
    if (r.noRef) return null;
    const dasar = computeFingerprint(r);
    const n = (ke.get(dasar) ?? 0) + 1;
    ke.set(dasar, n);
    return n === 1 ? dasar : `${dasar}|#${n}`;
  });
}

/** Kunci identitas setiap baris PDF — SAMA PERSIS dengan kolom indeks unik. */
export function kunciIdentitasSemua(rows: ParsedTxRow[]): string[] {
  const fp = sidikJariSemua(rows);
  return rows.map((r, i) =>
    r.noRef ? kunciRef(r.noRef, r.debet || 0, r.kredit || 0) : `fp:${fp[i]}`,
  );
}

function kunciIdentitasDb(b: BarisDb): string {
  if (b.no_ref) return kunciRef(b.no_ref, Number(b.nominal_debet ?? 0), Number(b.nominal_kredit ?? 0));
  if (b.fingerprint) return `fp:${b.fingerprint}`;
  return `id:${b.id}`; // tak punya identitas — hanya bisa berpasangan lewat isi
}

function kunciIsi(tgl: string, jam: string | null, k: number, d: number, saldo: number): string {
  return `${tgl}|${jam ?? ""}|${k}|${d}|${saldo}`;
}

/** Kunci isi baris PDF; null bila tanpa saldo (tak bisa dibandingkan isinya). */
export function kunciIsiPdf(row: ParsedTxRow): string | null {
  if (row.saldo == null) return null;
  return kunciIsi(tanggalDb(row), row.waktu || null, row.kredit || 0, row.debet || 0, row.saldo);
}

function kunciIsiDb(b: BarisDb): string | null {
  if (b.saldo == null) return null;
  return kunciIsi(
    String(b.tanggal),
    b.jam || null,
    Number(b.nominal_kredit ?? 0),
    Number(b.nominal_debet ?? 0),
    Number(b.saldo),
  );
}

function kunciTanpaSaldo(tgl: string, jam: string | null, k: number, d: number): string {
  return `${tgl}|${jam || ""}|${k}|${d}`;
}
function kunciTanpaSaldoPdf(row: ParsedTxRow): string {
  return kunciTanpaSaldo(tanggalDb(row), row.waktu || null, row.kredit || 0, row.debet || 0);
}
function kunciTanpaSaldoDb(b: BarisDb): string {
  return kunciTanpaSaldo(String(b.tanggal), b.jam || null, Number(b.nominal_kredit ?? 0), Number(b.nominal_debet ?? 0));
}

export type HasilPasangan = {
  /** Per baris PDF (urutan sama dengan `rows`): baris DB pasangannya, atau null. */
  pasangan: (BarisDb | null)[];
  /** Per baris PDF: lewat langkah mana ia berpasangan. */
  cara: ("identitas" | "isi" | "terhapus" | null)[];
  /** Indeks baris PDF tanpa pasangan sama sekali = BARU (perlu disisipkan). */
  baru: number[];
  /** Indeks baris PDF yang pasangannya hanya baris terhapus (dihidupkan
   *  kembali oleh persist, KECUALI yang juga ada di `terhapusRagu`). */
  terhapus: number[];
  /** Bagian dari `terhapus` yang TIDAK boleh dihidupkan (ada baris aktif
   *  tak terpakai dengan isi tanpa-saldo yang sama). Dihitung hilang. */
  terhapusRagu: number[];
  /** Baris DB aktif tak terpakai yang (tanggal, jam, nominal)-nya ada di PDF = GANDA. */
  gandaDb: BarisDb[];
};

export function pasangkanBaris(rows: ParsedTxRow[], db: BarisDb[]): HasilPasangan {
  const n = rows.length;
  const identitas = kunciIdentitasSemua(rows);
  const pasangan: (BarisDb | null)[] = new Array(n).fill(null);
  const cara: HasilPasangan["cara"] = new Array(n).fill(null);
  const terpakai = new Set<string>();

  // Urutan deterministik: id naik. Satu id hanya dihitung sekali walau
  // datang dari beberapa kueri.
  const unik = new Map<string, BarisDb>();
  for (const b of db) if (b && b.id && !unik.has(String(b.id))) unik.set(String(b.id), b);
  const semua = [...unik.values()].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

  const aktifPerIdentitas = new Map<string, BarisDb[]>();
  const terhapusPerIdentitas = new Map<string, BarisDb[]>();
  const aktifPerIsi = new Map<string, BarisDb[]>();
  const masuk = (m: Map<string, BarisDb[]>, k: string, b: BarisDb) => {
    const l = m.get(k);
    if (l) l.push(b);
    else m.set(k, [b]);
  };
  for (const b of semua) {
    const ki = kunciIdentitasDb(b);
    if (b.deleted_at) {
      masuk(terhapusPerIdentitas, ki, b);
      continue;
    }
    masuk(aktifPerIdentitas, ki, b);
    const ks = kunciIsiDb(b);
    if (ks) masuk(aktifPerIsi, ks, b);
  }
  const ambil = (l: BarisDb[] | undefined): BarisDb | null => {
    if (!l) return null;
    for (const b of l) if (!terpakai.has(String(b.id))) return b;
    return null;
  };

  // 1. identitas (baris aktif)
  for (let i = 0; i < n; i++) {
    const b = ambil(aktifPerIdentitas.get(identitas[i]));
    if (b) {
      pasangan[i] = b;
      cara[i] = "identitas";
      terpakai.add(String(b.id));
    }
  }
  // 2. isi (baris aktif yang belum terpakai)
  for (let i = 0; i < n; i++) {
    if (pasangan[i]) continue;
    const ks = kunciIsiPdf(rows[i]);
    if (!ks) continue;
    const b = ambil(aktifPerIsi.get(ks));
    if (b) {
      pasangan[i] = b;
      cara[i] = "isi";
      terpakai.add(String(b.id));
    }
  }
  // 2b. tanpa saldo, hanya ke baris DB aktif TANPA REF, jumlah harus sama
  {
    const pdfSisa = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      if (pasangan[i]) continue;
      const k = kunciTanpaSaldoPdf(rows[i]);
      const l = pdfSisa.get(k);
      if (l) l.push(i);
      else pdfSisa.set(k, [i]);
    }
    const dbSisa = new Map<string, BarisDb[]>();
    for (const b of semua) {
      if (b.deleted_at || b.no_ref || terpakai.has(String(b.id))) continue;
      masuk(dbSisa, kunciTanpaSaldoDb(b), b);
    }
    for (const [k, idx] of pdfSisa) {
      const l = dbSisa.get(k);
      if (!l || l.length !== idx.length) continue;
      idx.forEach((i, j) => {
        pasangan[i] = l[j];
        cara[i] = "isi";
        terpakai.add(String(l[j].id));
      });
    }
  }

  // Baris aktif yang belum terpakai, per kunci tanpa saldo — untuk penjaga
  // langkah 3 dan hitungan ganda.
  const sisaAktifTanpaSaldo = () => {
    const m = new Map<string, BarisDb[]>();
    for (const b of semua) {
      if (b.deleted_at || terpakai.has(String(b.id))) continue;
      masuk(m, kunciTanpaSaldoDb(b), b);
    }
    return m;
  };

  // 3. identitas yang hanya tersisa sebagai baris terhapus
  const terhapusRagu: number[] = [];
  {
    const sisa = sisaAktifTanpaSaldo();
    for (let i = 0; i < n; i++) {
      if (pasangan[i]) continue;
      const b = ambil(terhapusPerIdentitas.get(identitas[i]));
      if (b) {
        pasangan[i] = b;
        cara[i] = "terhapus";
        terpakai.add(String(b.id));
        if (sisa.has(kunciTanpaSaldoPdf(rows[i]))) terhapusRagu.push(i);
      }
    }
  }

  const baru: number[] = [];
  const terhapus: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!pasangan[i]) baru.push(i);
    else if (cara[i] === "terhapus") terhapus.push(i);
  }

  // Ganda: baris DB aktif tak terpakai yang (tanggal, jam, nominal)-nya
  // muncul di PDF. Semua pasangan yang mungkin sudah dihabiskan di atas,
  // jadi sisa seperti ini berarti database memuatnya LEBIH sering dari PDF.
  const tanpaSaldoPdf = new Set<string>(rows.map((r) => kunciTanpaSaldoPdf(r)));
  const gandaDb: BarisDb[] = [];
  for (const [k, l] of sisaAktifTanpaSaldo()) {
    if (tanpaSaldoPdf.has(k)) gandaDb.push(...l);
  }

  return { pasangan, cara, baru, terhapus, terhapusRagu, gandaDb };
}
