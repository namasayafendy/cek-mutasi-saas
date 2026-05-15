// Generate rekap PDF report — table layout dengan summary cards + breakdown.
// Pakai pdf-lib (sudah dipakai di parsers).

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatRupiah, formatDateID, parseDateISO } from "@/lib/format";

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

type InputRow = {
  id: string;
  tanggal_input: string;
  outlet_id: string | null;
  bank_id: string | null;
  nominal: number;
  jenis: "kredit" | "debet";
  match_status: "matched" | "no_candidate" | "all_taken" | "manual_claimed" | null;
  manual_claim_reason: string | null;
};

type FilterState = {
  from: string;
  to: string;
  jenis: "all" | "kredit" | "debet";
  bankId: string;
  outletId: string;
  status: "all" | "matched" | "unmatched" | "conflict";
};

type PerOutletAgg = {
  outletId: string | null;
  nama: string;
  warna: string;
  input: number;
  matched: number;
  unmatched: number;
  nominalMatched: number;
  nominalUnmatched: number;
};

type PerBankAgg = {
  bankId: string | null;
  label: string;
  input: number;
  matched: number;
  unmatched: number;
  nominalMatched: number;
  nominalUnmatched: number;
};

type Stats = {
  totalInput: number;
  totalNominal: number;
  matched: number;
  matchedNominal: number;
  unmatched: number;
  unmatchedNominal: number;
  conflict: number;
  conflictNominal: number;
  manualClaim: number;
  matchRate: number;
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN_X = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 40;

// Slate palette
const TEXT = rgb(0.094, 0.149, 0.231); // slate-900
const MUTED = rgb(0.392, 0.455, 0.545); // slate-500
const BORDER = rgb(0.886, 0.91, 0.941); // slate-200
const HEADER_BG = rgb(0.945, 0.961, 0.973); // slate-50
const GREEN = rgb(0.082, 0.502, 0.349); // green-700
const RED = rgb(0.722, 0.165, 0.247); // red-700
const AMBER = rgb(0.706, 0.451, 0.094); // amber-700
const BLUE = rgb(0.137, 0.42, 0.706);

function jenisLabel(j: FilterState["jenis"]): string {
  if (j === "kredit") return "Kredit (masuk)";
  if (j === "debet") return "Debet (keluar)";
  return "Semua jenis";
}

function statusLabel(s: FilterState["status"]): string {
  if (s === "matched") return "Match saja";
  if (s === "unmatched") return "Tidak ditemukan saja";
  if (s === "conflict") return "Bentrok saja";
  return "Semua status";
}

function statusText(s: InputRow["match_status"]): { text: string; color: ReturnType<typeof rgb> } {
  if (s === "matched") return { text: "Match", color: GREEN };
  if (s === "manual_claimed") return { text: "Manual claim", color: BLUE };
  if (s === "no_candidate") return { text: "Tidak ada", color: RED };
  if (s === "all_taken") return { text: "Bentrok", color: AMBER };
  return { text: "—", color: MUTED };
}

class PdfBuilder {
  pdf!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  fontBold!: PDFFont;
  y: number = PAGE_H - MARGIN_TOP;
  pageNum: number = 1;

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

  text(s: string, x: number, y: number, size: number, font: PDFFont, color = TEXT) {
    this.page.drawText(s, { x, y, size, font, color });
  }

  rect(x: number, y: number, w: number, h: number, fill: ReturnType<typeof rgb>) {
    this.page.drawRectangle({ x, y, width: w, height: h, color: fill });
  }

  hLine(x1: number, x2: number, y: number, color = BORDER) {
    this.page.drawLine({
      start: { x: x1, y },
      end: { x: x2, y },
      thickness: 0.5,
      color,
    });
  }
}

function asciiSafe(s: string): string {
  // pdf-lib StandardFonts hanya support WinAnsi. Replace karakter di luar range.
  return s.replace(/[^\x00-\xFF]/g, "?");
}

// Truncate string to fit max width
function truncate(font: PDFFont, s: string, size: number, maxW: number): string {
  // pdf-lib StandardFonts (WinAnsi) can't measure non-Latin-1 chars (incl. the
  // ellipsis char U+2026 itself) — sanitize first and use ASCII triple-dot.
  const safe = asciiSafe(s);
  if (font.widthOfTextAtSize(safe, size) <= maxW) return safe;
  let out = safe;
  while (out.length > 1 && font.widthOfTextAtSize(out + "...", size) > maxW) {
    out = out.slice(0, -1);
  }
  return out + "...";
}

export async function generateRekapPdf(args: {
  brandName: string;
  filter: FilterState;
  outlets: OutletLite[];
  banks: BankLite[];
  rows: InputRow[];
  perOutlet: PerOutletAgg[];
  perBank: PerBankAgg[];
  stats: Stats;
}): Promise<Uint8Array> {
  const { brandName, filter, outlets, banks, rows, perOutlet, perBank, stats } = args;
  const outletMap = new Map(outlets.map((o) => [o.id, o]));
  const bankMap = new Map(banks.map((b) => [b.id, b]));

  const b = new PdfBuilder();
  await b.init();

  // ===== HEADER =====
  b.text(asciiSafe(brandName), MARGIN_X, b.y, 16, b.fontBold);
  b.text(
    `Dibuat ${formatDateID(new Date())}`,
    PAGE_W - MARGIN_X - b.font.widthOfTextAtSize(`Dibuat ${formatDateID(new Date())}`, 9),
    b.y + 4,
    9,
    b.font,
    MUTED,
  );
  b.y -= 22;
  b.text("Rekap Cek Mutasi", MARGIN_X, b.y, 13, b.fontBold);
  b.y -= 18;

  // Filter description
  const fromD = parseDateISO(filter.from);
  const toD = parseDateISO(filter.to);
  const periode =
    fromD && toD ? `${formatDateID(fromD)} sd ${formatDateID(toD)}` : `${filter.from} - ${filter.to}`;
  const bankSel =
    filter.bankId === "all"
      ? "semua bank"
      : (() => {
          const bk = bankMap.get(filter.bankId);
          return bk ? bk.label || bk.kode : "bank tidak diketahui";
        })();
  const outletSel =
    filter.outletId === "all"
      ? "semua outlet"
      : (() => {
          const o = outletMap.get(filter.outletId);
          return o ? o.nama : "outlet tidak diketahui";
        })();
  const filterLines = [
    `Periode: ${periode}`,
    `Filter: ${jenisLabel(filter.jenis)} | ${bankSel} | ${outletSel} | ${statusLabel(filter.status)}`,
  ];
  for (const line of filterLines) {
    b.text(asciiSafe(line), MARGIN_X, b.y, 9, b.font, MUTED);
    b.y -= 12;
  }
  b.y -= 6;
  b.hLine(MARGIN_X, PAGE_W - MARGIN_X, b.y);
  b.y -= 14;

  // ===== SUMMARY CARDS =====
  b.text("Ringkasan", MARGIN_X, b.y, 11, b.fontBold);
  b.y -= 14;
  const cardW = (PAGE_W - 2 * MARGIN_X - 4 * 8) / 5;
  const cardH = 50;
  const cardY = b.y - cardH;
  const cards: { label: string; value: string; sub: string; color: ReturnType<typeof rgb> }[] = [
    {
      label: "Total Input",
      value: String(stats.totalInput),
      sub: `Rp ${formatRupiah(stats.totalNominal)}`,
      color: TEXT,
    },
    {
      label: "Match",
      value: String(stats.matched),
      sub: `Rp ${formatRupiah(stats.matchedNominal)}`,
      color: GREEN,
    },
    {
      label: "Tidak Ditemukan",
      value: String(stats.unmatched),
      sub: `Rp ${formatRupiah(stats.unmatchedNominal)}`,
      color: RED,
    },
    {
      label: "Bentrok",
      value: String(stats.conflict),
      sub: `Rp ${formatRupiah(stats.conflictNominal)}`,
      color: AMBER,
    },
    {
      label: "Match Rate",
      value: `${stats.matchRate.toFixed(1)}%`,
      sub: stats.manualClaim > 0 ? `${stats.manualClaim} manual claim` : "auto-match",
      color: TEXT,
    },
  ];
  for (let i = 0; i < cards.length; i++) {
    const cx = MARGIN_X + i * (cardW + 8);
    b.page.drawRectangle({
      x: cx,
      y: cardY,
      width: cardW,
      height: cardH,
      borderColor: BORDER,
      borderWidth: 0.5,
    });
    b.text(asciiSafe(cards[i].label), cx + 6, cardY + cardH - 12, 7.5, b.font, MUTED);
    b.text(cards[i].value, cx + 6, cardY + cardH - 28, 13, b.fontBold, cards[i].color);
    b.text(asciiSafe(cards[i].sub), cx + 6, cardY + 8, 7, b.font, cards[i].color);
  }
  b.y = cardY - 18;

  // ===== BREAKDOWN PER OUTLET =====
  if (perOutlet.length > 0) {
    b.ensure(40 + perOutlet.length * 14);
    b.text("Breakdown per Outlet", MARGIN_X, b.y, 11, b.fontBold);
    b.y -= 14;
    drawAggTable(
      b,
      ["Outlet", "Input", "Match", "Tidak match", "Nominal Match", "Match %"],
      [180, 50, 50, 60, 110, 50],
      perOutlet.map((o) => [
        o.nama,
        String(o.input),
        String(o.matched),
        String(o.unmatched),
        `Rp ${formatRupiah(o.nominalMatched)}`,
        `${o.input > 0 ? ((o.matched / o.input) * 100).toFixed(0) : 0}%`,
      ]),
    );
    b.y -= 12;
  }

  // ===== BREAKDOWN PER BANK =====
  if (perBank.length > 0) {
    b.ensure(40 + perBank.length * 14);
    b.text("Breakdown per Bank", MARGIN_X, b.y, 11, b.fontBold);
    b.y -= 14;
    drawAggTable(
      b,
      ["Bank", "Input", "Match", "Tidak match", "Nominal Match", "Match %"],
      [180, 50, 50, 60, 110, 50],
      perBank.map((bk) => [
        bk.label,
        String(bk.input),
        String(bk.matched),
        String(bk.unmatched),
        `Rp ${formatRupiah(bk.nominalMatched)}`,
        `${bk.input > 0 ? ((bk.matched / bk.input) * 100).toFixed(0) : 0}%`,
      ]),
    );
    b.y -= 12;
  }

  // ===== DETAIL =====
  if (rows.length > 0) {
    b.ensure(40);
    b.text(`Detail (${rows.length} input)`, MARGIN_X, b.y, 11, b.fontBold);
    b.y -= 14;
    drawDetailTable(b, rows, outletMap, bankMap);
  } else {
    b.ensure(20);
    b.text("Tidak ada data sesuai filter.", MARGIN_X, b.y, 9, b.font, MUTED);
    b.y -= 12;
  }

  b.drawPageNumber();

  return await b.pdf.save();
}

function drawAggTable(
  b: PdfBuilder,
  headers: string[],
  widths: number[],
  rows: string[][],
) {
  const rowH = 14;
  // Header bg
  b.rect(MARGIN_X, b.y - rowH + 3, widths.reduce((a, c) => a + c, 0), rowH, HEADER_BG);
  let x = MARGIN_X;
  for (let i = 0; i < headers.length; i++) {
    const w = widths[i];
    const align = i === 0 ? "left" : "right";
    const txt = asciiSafe(headers[i]);
    const tx = align === "left" ? x + 4 : x + w - 4 - b.fontBold.widthOfTextAtSize(txt, 8);
    b.text(txt, tx, b.y - 9, 8, b.fontBold, MUTED);
    x += w;
  }
  b.y -= rowH;

  for (const row of rows) {
    b.ensure(rowH);
    let cx = MARGIN_X;
    for (let i = 0; i < row.length; i++) {
      const w = widths[i];
      const align = i === 0 ? "left" : "right";
      const txt = asciiSafe(truncate(b.font, row[i], 8, w - 8));
      const tw = b.font.widthOfTextAtSize(txt, 8);
      const tx = align === "left" ? cx + 4 : cx + w - 4 - tw;
      b.text(txt, tx, b.y - 9, 8, b.font);
      cx += w;
    }
    b.hLine(MARGIN_X, MARGIN_X + widths.reduce((a, c) => a + c, 0), b.y - rowH + 2);
    b.y -= rowH;
  }
}

function drawDetailTable(
  b: PdfBuilder,
  rows: InputRow[],
  outletMap: Map<string, OutletLite>,
  bankMap: Map<string, BankLite>,
) {
  const headers = ["Tgl", "Jenis", "Outlet", "Bank", "Nominal", "Status"];
  const widths = [55, 45, 110, 95, 90, 110];
  const totalW = widths.reduce((a, c) => a + c, 0);
  const rowH = 13;

  function drawHeader() {
    b.rect(MARGIN_X, b.y - rowH + 3, totalW, rowH, HEADER_BG);
    let x = MARGIN_X;
    for (let i = 0; i < headers.length; i++) {
      const w = widths[i];
      const align = i === 4 ? "right" : "left";
      const txt = asciiSafe(headers[i]);
      const tx = align === "left" ? x + 4 : x + w - 4 - b.fontBold.widthOfTextAtSize(txt, 7.5);
      b.text(txt, tx, b.y - 9, 7.5, b.fontBold, MUTED);
      x += w;
    }
    b.y -= rowH;
  }

  drawHeader();

  for (const r of rows) {
    if (b.y - rowH < MARGIN_BOTTOM + 30) {
      b.drawPageNumber();
      b.newPage();
      drawHeader();
    }
    const outlet = r.outlet_id ? outletMap.get(r.outlet_id) : null;
    const bank = r.bank_id ? bankMap.get(r.bank_id) : null;
    const tgl = parseDateISO(r.tanggal_input);
    const tglStr = tgl ? formatDateID(tgl) : r.tanggal_input;
    const jenisStr = r.jenis === "kredit" ? "Kredit" : "Debet";
    const outletStr = outlet?.nama ?? "-";
    const bankStr = bank ? bank.label || bank.kode : "-";
    const nominalStr = `Rp ${formatRupiah(r.nominal)}`;
    const status = statusText(r.match_status);

    const cells = [tglStr, jenisStr, outletStr, bankStr, nominalStr, status.text];
    let cx = MARGIN_X;
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i];
      const align = i === 4 ? "right" : "left";
      const txt = asciiSafe(truncate(b.font, cells[i], 7.5, w - 8));
      const tw = b.font.widthOfTextAtSize(txt, 7.5);
      const tx = align === "left" ? cx + 4 : cx + w - 4 - tw;
      const color = i === 5 ? status.color : i === 1 && r.jenis === "kredit" ? GREEN : i === 1 ? RED : TEXT;
      b.text(txt, tx, b.y - 9, 7.5, b.font, color);
      cx += w;
    }
    b.hLine(MARGIN_X, MARGIN_X + totalW, b.y - rowH + 2);
    b.y -= rowH;
  }
}
