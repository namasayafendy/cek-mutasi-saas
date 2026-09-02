// ============================================================
// CEK MUTASI - Biaya administrasi bank
// File: lib/bank/biayaAdmin.ts
//
// Potongan rutin yang dibebankan BANK, bukan uang perusahaan yang bergerak ke
// siapa pun. Ia muncul di kolom DEBET mutasi tanpa pernah punya kontrak
// pemilik, jadi setiap hari ia mendarat di blok "UANG DI MUTASI TANPA PEMILIK"
// dan menyita tempat baris yang benar-benar perlu dilihat.
//
// Keputusan pemilik, 3 September 2026: "untuk admin yang Rp 2.500 dan 6.500
// buat tidak perlu dilaporkan saja karena itu biaya adm."
//
// NOMINAL PERSIS, bukan rentang. "Di bawah Rp 10.000" akan ikut menelan
// pencairan kecil yang sungguhan — dan baris yang hilang karena aturan yang
// terlalu lebar jauh lebih sulit ditemukan daripada baris yang kelebihan.
//
// HANYA SISI DEBET. Uang MASUK Rp 2.500 bukan biaya admin; ia pembayaran
// nasabah yang kebetulan kecil, dan menyembunyikannya berarti menghapus
// pertanyaan yang sah.
//
// TIDAK DIBUANG, HANYA TIDAK DIRINCI. Cacah dan jumlah rupiahnya tetap
// dicetak satu baris di laporan. Angka yang lenyap tanpa keterangan sama
// menakutkannya dengan angka yang salah — dan kalau bank suatu hari menaikkan
// tarifnya, baris itulah yang akan memperlihatkannya.
// ============================================================

/** Nominal potongan admin bank yang dikenal. Persis, bukan rentang. */
export const NOMINAL_BIAYA_ADMIN: readonly number[] = [2_500, 6_500];

/** Apakah satu baris DEBET mutasi adalah potongan admin bank? */
export function adalahBiayaAdmin(nominal: unknown): boolean {
  const n = Math.round(Number(nominal ?? 0));
  return NOMINAL_BIAYA_ADMIN.includes(n);
}
