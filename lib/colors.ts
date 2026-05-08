// 20-warna palette untuk highlight outlet.
// Dipilih supaya: (1) kontras saat di-print, (2) mudah dibedakan satu sama lain,
// (3) cukup terang sehingga teks hitam di atasnya tetap terbaca.

export type PaletteColor = {
  hex: string;
  label: string;
};

export const PALETTE: PaletteColor[] = [
  { hex: "#FFEB3B", label: "Kuning" },
  { hex: "#F8BBD0", label: "Pink" },
  { hex: "#C8E6C9", label: "Hijau Muda" },
  { hex: "#BBDEFB", label: "Biru Muda" },
  { hex: "#FFE0B2", label: "Oranye" },
  { hex: "#E1BEE7", label: "Ungu Muda" },
  { hex: "#B2EBF2", label: "Cyan" },
  { hex: "#DCEDC8", label: "Lime" },
  { hex: "#FFECB3", label: "Amber" },
  { hex: "#B2DFDB", label: "Teal" },
  { hex: "#FFCCBC", label: "Salmon" },
  { hex: "#C5CAE9", label: "Indigo Muda" },
  { hex: "#B3E5FC", label: "Langit" },
  { hex: "#F48FB1", label: "Magenta" },
  { hex: "#D7CCC8", label: "Coklat Muda" },
  { hex: "#D1C4E9", label: "Lavender" },
  { hex: "#FFAB91", label: "Peach" },
  { hex: "#81D4FA", label: "Sky" },
  { hex: "#A5D6A7", label: "Mint" },
  { hex: "#F0F4C3", label: "Krem Hijau" },
];

/**
 * Pilih warna berikutnya dari palette. Akan cari warna yang belum dipakai;
 * kalau semua sudah dipakai, mulai dari awal lagi (warna sama tapi index naik).
 */
export function pickNextColor(usedIndexes: number[]): { hex: string; index: number } {
  const used = new Set(usedIndexes);
  for (let i = 0; i < PALETTE.length; i++) {
    if (!used.has(i)) return { hex: PALETTE[i].hex, index: i };
  }
  // Semua sudah terpakai — mulai dari index berikutnya secara modular
  const next = usedIndexes.length % PALETTE.length;
  return { hex: PALETTE[next].hex, index: usedIndexes.length };
}

/** Cari label warna dari hex */
export function findColorLabel(hex: string): string {
  const c = PALETTE.find((p) => p.hex.toLowerCase() === hex.toLowerCase());
  return c?.label ?? hex;
}

/** Convert hex ke rgb 0-1 untuk pdf-lib */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return { r, g, b };
}
