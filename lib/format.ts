/**
 * Parse string nominal jadi number (rupiah).
 * Terima format: "100000", "100.000", "1.000.000", "100,000", "100rb" (rb = ribu)
 * Return null kalau tidak valid.
 */
export function parseNominal(input: string): number | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;

  // Handle "rb" / "ribu" / "k" suffix
  let multiplier = 1;
  if (/(rb|ribu)$/.test(s)) {
    multiplier = 1000;
    s = s.replace(/(rb|ribu)$/, "").trim();
  } else if (/k$/.test(s)) {
    multiplier = 1000;
    s = s.replace(/k$/, "").trim();
  } else if (/(jt|juta)$/.test(s)) {
    multiplier = 1_000_000;
    s = s.replace(/(jt|juta)$/, "").trim();
  }

  // Hapus titik dan koma sebagai thousands separator (ribuan)
  // Sederhana: buang semua titik dan koma karena rupiah tidak pakai desimal
  s = s.replace(/[.,\s]/g, "");

  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10) * multiplier;
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

/** Format number jadi rupiah dengan titik separator: 100000 -> "100.000" */
export function formatRupiah(n: number): string {
  return n.toLocaleString("id-ID");
}

/** Format dengan prefix Rp */
export function formatRp(n: number): string {
  return `Rp ${formatRupiah(n)}`;
}

/** Format tanggal jadi "DD-MM-YYYY" */
export function formatDateID(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/** Parse "DD-MM-YYYY" jadi Date (UTC noon untuk hindari timezone shift) */
export function parseDateID(s: string): Date | null {
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd), 12, 0, 0));
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Parse "YYYY-MM-DD" (format input HTML date) jadi Date */
export function parseDateISO(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, yyyy, mm, dd] = m;
  const d = new Date(Date.UTC(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd), 12, 0, 0));
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Format Date jadi "YYYY-MM-DD" untuk input HTML date */
export function toDateISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Diff hari antara dua Date (a - b dalam hari, integer) */
export function diffDays(a: Date, b: Date): number {
  const MS = 24 * 60 * 60 * 1000;
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((da - db) / MS);
}

/** Format tanggal Indonesia panjang: "20 April 2026" */
export function formatDateLong(d: Date): string {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
