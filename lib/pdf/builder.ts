// Shared pdf-lib builder helpers used by all report generators.
// A4 portrait, Helvetica/HelveticaBold (StandardFonts → ASCII/WinAnsi only).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type RgbColor = ReturnType<typeof rgb>;

export const PAGE_W = 595;
export const PAGE_H = 842;
export const MARGIN_X = 40;
export const MARGIN_TOP = 40;
export const MARGIN_BOTTOM = 40;

// Slate / brand palette
export const TEXT = rgb(0.094, 0.149, 0.231); // slate-900
export const MUTED = rgb(0.392, 0.455, 0.545); // slate-500
export const BORDER = rgb(0.886, 0.91, 0.941); // slate-200
export const HEADER_BG = rgb(0.945, 0.961, 0.973); // slate-50
export const GREEN = rgb(0.082, 0.502, 0.349); // green-700
export const RED = rgb(0.722, 0.165, 0.247); // red-700
export const AMBER = rgb(0.706, 0.451, 0.094); // amber-700
export const BLUE = rgb(0.137, 0.42, 0.706);
export const BRAND_GREEN = rgb(0.063, 0.725, 0.506); // #10B981
export const BRAND_DARK = rgb(0.059, 0.18, 0.122); // #0F2E1F

export class PdfBuilder {
  pdf!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  fontBold!: PDFFont;
  y: number = PAGE_H - MARGIN_TOP;
  pageNum: number = 1;
  onNewPage?: (page: PDFPage, pageNum: number) => void;

  async init() {
    this.pdf = await PDFDocument.create();
    this.font = await this.pdf.embedFont(StandardFonts.Helvetica);
    this.fontBold = await this.pdf.embedFont(StandardFonts.HelveticaBold);
    this.newPage(true);
  }

  newPage(isFirst = false) {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN_TOP;
    if (!isFirst) this.pageNum += 1;
    if (this.onNewPage) this.onNewPage(this.page, this.pageNum);
  }

  ensure(space: number) {
    if (this.y - space < MARGIN_BOTTOM + 20) {
      this.drawPageNumber();
      this.newPage();
    }
  }

  drawPageNumber() {
    const txt = `Hal. ${this.pageNum}`;
    const w = this.font.widthOfTextAtSize(txt, 8);
    this.page.drawText(txt, {
      x: PAGE_W - MARGIN_X - w,
      y: 20,
      size: 8,
      font: this.font,
      color: MUTED,
    });
  }

  text(s: string, x: number, y: number, size: number, font: PDFFont, color: RgbColor = TEXT) {
    this.page.drawText(s, { x, y, size, font, color });
  }

  textRight(s: string, xRight: number, y: number, size: number, font: PDFFont, color: RgbColor = TEXT) {
    const w = font.widthOfTextAtSize(s, size);
    this.page.drawText(s, { x: xRight - w, y, size, font, color });
  }

  rect(x: number, y: number, w: number, h: number, fill: RgbColor) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: fill });
  }

  rectFill(
    x: number,
    y: number,
    w: number,
    h: number,
    color: RgbColor,
    opacity = 1,
  ) {
    this.page.drawRectangle({ x, y, width: w, height: h, color, opacity });
  }

  rectStroke(
    x: number,
    y: number,
    w: number,
    h: number,
    color: RgbColor,
    thickness = 0.5,
  ) {
    this.page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: color,
      borderWidth: thickness,
    });
  }

  hLine(x1: number, x2: number, y: number, color: RgbColor = BORDER) {
    this.page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: 0.5,
      color,
    });
  }
}

// Convert "#FFEB3B" → RgbColor that pdf-lib can use.
// Falls back to TEXT (slate-900) if hex is invalid.
export function hexToRgbColor(hex: string): RgbColor {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return TEXT;
  return rgb(
    parseInt(m[1].slice(0, 2), 16) / 255,
    parseInt(m[1].slice(2, 4), 16) / 255,
    parseInt(m[1].slice(4, 6), 16) / 255,
  );
}

// pdf-lib StandardFonts (Helvetica) only supports WinAnsi. Replace anything else
// (em-dash, smart quotes, non-Latin) with ASCII equivalents so we never crash.
export function asciiSafe(s: string): string {
  return s
    .replace(/[–—]/g, "-") // en/em dash
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x00-\xFF]/g, "?");
}

export function truncate(font: PDFFont, s: string, size: number, maxW: number): string {
  // pdf-lib StandardFonts (WinAnsi) can't measure non-Latin-1 chars — must sanitize first.
  const safe = asciiSafe(s);
  if (font.widthOfTextAtSize(safe, size) <= maxW) return safe;
  let out = safe;
  while (out.length > 1 && font.widthOfTextAtSize(out + "...", size) > maxW) {
    out = out.slice(0, -1);
  }
  return out + "...";
}

// Trigger browser download from a Uint8Array (client-side only).
export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  // Copy into a fresh ArrayBuffer to avoid any detached-buffer issues
  // when the same bytes object is reused.
  const buf = new Uint8Array(bytes).buffer;
  const blob = new Blob([buf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
