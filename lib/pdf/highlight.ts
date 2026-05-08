// Generate PDF output: merged multi-bank PDF + overlay highlight + halaman rekap.

import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { PdfTransaction, UserInput, MatchSummary, Outlet, Bank, Jenis } from "@/lib/types";
import { hexToRgb01 } from "@/lib/colors";
import { formatDateID, formatRupiah, formatDateLong } from "@/lib/format";

const HIGHLIGHT_OPACITY = 0.4;

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

// ============================================================
// Multi-bank merge entry point (Phase 1E.2)
// ============================================================

export type BankUploadForPdf = {
  bank: Bank;
  fileBuffer: Uint8Array;
  transactions: PdfTransaction[];
};

export type MultiBankInput = {
  uploads: BankUploadForPdf[];
  inputs: UserInput[];
  summary: MatchSummary;
  outlets: Outlet[];
  jenis: Jenis;
};

/**
 * Generate satu PDF besar berisi:
 * - Cover/index page
 * - Per-bank: halaman PDF asli + highlight per outlet
 * - Lampiran rekap di akhir
 */
export async function generateMultiBankPdf(args: MultiBankInput): Promise<Uint8Array> {
  const { uploads, inputs, summary, outlets, jenis } = args;
  const merged = await PDFDocument.create();
  const helvetica = await merged.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await merged.embedFont(StandardFonts.HelveticaBold);
  const outletById = new Map(outlets.map((o) => [o.id, o]));

  // 1. Cover page
  drawCoverPage({
    pdf: merged,
    fontRegular: helvetica,
    fontBold: helveticaBold,
    uploads,
    outlets,
    summary,
    jenis,
  });

  // 2. Embed setiap bank PDF + highlight
  for (const up of uploads) {
    // Section divider
    drawBankDivider(merged, helveticaBold, helvetica, up.bank);

    // Load bank PDF + draw highlights di atas
    const copy = new Uint8Array(up.fileBuffer);
    const sourceDoc = await PDFDocument.load(copy);
    const sourcePages = sourceDoc.getPages();

    const inputsForBank = inputs.filter((i) => i.bankId === up.bank.id);

    for (const input of inputsForBank) {
      const m = input.match;
      if (!m || m.status !== "matched") continue;
      // Phase 1E.2: skip cross-bank match (matched di bank lain, bukan di sini)
      if (m.txBankId && m.txBankId !== up.bank.id) continue;
      const outlet = outletById.get(input.outletId);
      if (!outlet) continue;

      const matchedTx = up.transactions.find(
        (t) =>
          t.no === m.txNo &&
          t.tanggalDate.getTime() === m.txDate.getTime() &&
          t.kredit === input.nominal,
      );
      if (!matchedTx) continue;

      const pageIndex = matchedTx.page - 1;
      if (pageIndex < 0 || pageIndex >= sourcePages.length) continue;
      const page = sourcePages[pageIndex];
      const { r, g, b } = hexToRgb01(outlet.warna_hex);

      page.drawRectangle({
        x: matchedTx.bbox.xLeft,
        y: matchedTx.bbox.yBottom,
        width: matchedTx.bbox.width,
        height: matchedTx.bbox.height,
        color: rgb(r, g, b),
        opacity: HIGHLIGHT_OPACITY,
      });
    }

    // Copy semua halaman ke merged PDF
    const copiedPages = await merged.copyPages(sourceDoc, sourceDoc.getPageIndices());
    for (const p of copiedPages) merged.addPage(p);
  }

  // 3. Lampiran rekap di akhir
  drawRecapPages({
    pdfDoc: merged,
    fontRegular: helvetica,
    fontBold: helveticaBold,
    summary,
    outlets,
    uploads,
    inputs,
    jenis,
  });

  return await merged.save();
}

// ============================================================
// Backward-compat single-bank API (jaga supaya code lama yang import
// generateHighlightedPdf masih jalan, walaupun kita sudah pakai multi-bank).
// ============================================================

export type HighlightInput = {
  fileBuffer: Uint8Array;
  transactions: PdfTransaction[];
  inputs: UserInput[];
  summary: MatchSummary;
  outlets: Outlet[];
};

export async function generateHighlightedPdf(args: HighlightInput): Promise<Uint8Array> {
  const { fileBuffer, transactions, inputs, summary, outlets } = args;

  const copy = new Uint8Array(fileBuffer);
  const pdfDoc = await PDFDocument.load(copy);
  const pages = pdfDoc.getPages();
  const outletById = new Map(outlets.map((o) => [o.id, o]));

  for (const input of inputs) {
    const m = input.match;
    if (!m || m.status !== "matched") continue;
    const outlet = outletById.get(input.outletId);
    if (!outlet) continue;

    const matchedTx = transactions.find(
      (t) =>
        t.no === m.txNo &&
        t.tanggalDate.getTime() === m.txDate.getTime() &&
        t.kredit === input.nominal,
    );
    if (!matchedTx) continue;

    const pageIndex = matchedTx.page - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;
    const page = pages[pageIndex];
    const { r, g, b } = hexToRgb01(outlet.warna_hex);

    page.drawRectangle({
      x: matchedTx.bbox.xLeft,
      y: matchedTx.bbox.yBottom,
      width: matchedTx.bbox.width,
      height: matchedTx.bbox.height,
      color: rgb(r, g, b),
      opacity: HIGHLIGHT_OPACITY,
    });
  }

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  drawRecapPages({
    pdfDoc,
    fontRegular: helvetica,
    fontBold: helveticaBold,
    summary,
    outlets,
    uploads: [],
    inputs,
    jenis: "kredit",
  });

  return await pdfDoc.save();
}

// ============================================================
// Helpers
// ============================================================

function asciiSafe(s: string): string {
  return s.replace(/[^\x00-\xFF]/g, "?");
}

function drawCoverPage(args: {
  pdf: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  uploads: BankUploadForPdf[];
  outlets: Outlet[];
  summary: MatchSummary;
  jenis: Jenis;
}) {
  const { pdf, fontRegular, fontBold, uploads, summary, jenis } = args;
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  page.drawText(`Rekap Cek Mutasi ${jenis === "kredit" ? "Kredit" : "Debet"}`, {
    x: MARGIN,
    y: y - 18,
    size: 18,
    font: fontBold,
    color: rgb(0.05, 0.05, 0.1),
  });
  y -= 28;

  page.drawText(asciiSafe(`Dibuat: ${formatDateLong(new Date())}`), {
    x: MARGIN,
    y: y - 11,
    size: 10,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.5),
  });
  y -= 24;

  page.drawText(`Bank yang di-cek (${uploads.length}):`, {
    x: MARGIN,
    y: y - 13,
    size: 12,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.15),
  });
  y -= 20;

  for (const up of uploads) {
    const txCount = up.transactions.length;
    const total = up.transactions.reduce((s, t) => s + t.kredit, 0);
    page.drawText(
      asciiSafe(`- ${up.bank.label || up.bank.kode} | ${txCount} transaksi | Rp ${formatRupiah(total)}`),
      { x: MARGIN, y: y - 10, size: 10, font: fontRegular, color: rgb(0.15, 0.15, 0.2) },
    );
    y -= 16;
  }

  y -= 12;
  page.drawText("Ringkasan:", {
    x: MARGIN,
    y: y - 13,
    size: 12,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.15),
  });
  y -= 20;

  const lines = [
    `Total input: ${summary.totalInput}`,
    `Match: ${summary.matched}`,
    `Tidak ditemukan: ${summary.noCandidate.length}`,
    `Bentrok: ${summary.allTaken.length}`,
    `Mutasi belum di-claim: ${summary.unclaimed.length}`,
  ];
  for (const line of lines) {
    page.drawText(asciiSafe(line), {
      x: MARGIN,
      y: y - 10,
      size: 10,
      font: fontRegular,
      color: rgb(0.15, 0.15, 0.2),
    });
    y -= 14;
  }
}

function drawBankDivider(pdf: PDFDocument, fontBold: PDFFont, fontRegular: PDFFont, bank: Bank) {
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 80,
    width: PAGE_W,
    height: 80,
    color: rgb(0.95, 0.96, 0.98),
  });
  page.drawText(asciiSafe(bank.label || bank.kode), {
    x: MARGIN,
    y: PAGE_H - 50,
    size: 22,
    font: fontBold,
    color: rgb(0.05, 0.05, 0.1),
  });
  page.drawText("Mutasi rekening dengan highlight:", {
    x: MARGIN,
    y: PAGE_H - 110,
    size: 11,
    font: fontRegular,
    color: rgb(0.4, 0.4, 0.5),
  });
}

type DrawRecapArgs = {
  pdfDoc: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  summary: MatchSummary;
  outlets: Outlet[];
  uploads: BankUploadForPdf[];
  inputs: UserInput[];
  jenis: Jenis;
};

function drawRecapPages(args: DrawRecapArgs) {
  const { pdfDoc, fontRegular, fontBold, summary, outlets, uploads, jenis } = args;
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const bankById = new Map(uploads.map((u) => [u.bank.id, u.bank]));

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) newPage();
  }
  function title(text: string) {
    ensureSpace(28);
    page.drawText(asciiSafe(text), {
      x: MARGIN,
      y: y - 16,
      size: 16,
      font: fontBold,
      color: rgb(0.05, 0.05, 0.1),
    });
    y -= 24;
  }
  function subtitle(text: string) {
    ensureSpace(20);
    page.drawText(asciiSafe(text), {
      x: MARGIN,
      y: y - 12,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.15),
    });
    y -= 18;
  }
  function line(text: string, opts?: { color?: [number, number, number]; size?: number; bold?: boolean }) {
    const size = opts?.size ?? 10;
    ensureSpace(size + 4);
    page.drawText(asciiSafe(text), {
      x: MARGIN,
      y: y - size,
      size,
      font: opts?.bold ? fontBold : fontRegular,
      color: opts?.color
        ? rgb(opts.color[0], opts.color[1], opts.color[2])
        : rgb(0.15, 0.15, 0.2),
    });
    y -= size + 4;
  }
  function spacer(h = 8) {
    y -= h;
  }
  function colorBox(hex: string, label: string) {
    ensureSpace(18);
    const { r, g, b } = hexToRgb01(hex);
    page.drawRectangle({
      x: MARGIN,
      y: y - 12,
      width: 14,
      height: 12,
      color: rgb(r, g, b),
      borderColor: rgb(0.3, 0.3, 0.3),
      borderWidth: 0.5,
    });
    page.drawText(asciiSafe(label), {
      x: MARGIN + 20,
      y: y - 10,
      size: 10,
      font: fontRegular,
      color: rgb(0.15, 0.15, 0.2),
    });
    y -= 18;
  }

  function bankLabel(bankId: string | undefined): string {
    if (!bankId) return "—";
    const b = bankById.get(bankId);
    return b ? b.label || b.kode : bankId;
  }

  title(`Lampiran Rekap Cek Mutasi ${jenis === "kredit" ? "Kredit" : "Debet"}`);
  line(`Dibuat: ${formatDateLong(new Date())}`);
  spacer(6);

  subtitle("Ringkasan");
  line(`Total input: ${summary.totalInput}`);
  line(`Berhasil ter-match: ${summary.matched}`, { color: [0.05, 0.4, 0.1] });
  line(`Tidak ada nominal di mutasi: ${summary.noCandidate.length}`, { color: [0.7, 0.1, 0.1] });
  line(`Bentrok (sudah ke-claim input lain): ${summary.allTaken.length}`, {
    color: [0.7, 0.4, 0.05],
  });
  line(`Transaksi mutasi tidak di-claim: ${summary.unclaimed.length}`);
  spacer(8);

  if (uploads.length > 0) {
    subtitle("Bank yang di-cek");
    for (const up of uploads) {
      const total = up.transactions.reduce((s, t) => s + t.kredit, 0);
      line(
        `- ${up.bank.label || up.bank.kode}: ${up.transactions.length} transaksi, Rp ${formatRupiah(total)}`,
      );
    }
    spacer(8);
  }

  subtitle("Legend warna outlet");
  for (const o of outlets) colorBox(o.warna_hex, o.nama);
  spacer(8);

  subtitle(`Input tidak ditemukan di mutasi (${summary.noCandidate.length})`);
  if (summary.noCandidate.length === 0) {
    line("Tidak ada.", { color: [0.4, 0.4, 0.5] });
  } else {
    for (const i of summary.noCandidate) {
      const o = outletById.get(i.outletId);
      const bk = uploads.length > 0 ? ` [${bankLabel(i.bankId)}]` : "";
      line(`- ${formatDateID(i.tanggal)}${bk} | ${o?.nama ?? "?"} | Rp ${formatRupiah(i.nominal)}`);
    }
  }
  spacer(8);

  subtitle(`Input bentrok / sudah ke-claim input lain (${summary.allTaken.length})`);
  if (summary.allTaken.length === 0) {
    line("Tidak ada.", { color: [0.4, 0.4, 0.5] });
  } else {
    for (const i of summary.allTaken) {
      const o = outletById.get(i.outletId);
      const m = i.match;
      const conflictCount = m?.status === "all_taken" ? m.conflictCount : 0;
      const conflictDates = m?.status === "all_taken" ? m.conflictDates.join(", ") : "";
      const bk = uploads.length > 0 ? ` [${bankLabel(i.bankId)}]` : "";
      line(
        `- ${formatDateID(i.tanggal)}${bk} | ${o?.nama ?? "?"} | Rp ${formatRupiah(i.nominal)} (${conflictCount}x sudah ke-claim di tgl ${conflictDates})`,
      );
    }
  }
  spacer(8);

  subtitle(`Transaksi mutasi tidak di-claim (${summary.unclaimed.length})`);
  if (summary.unclaimed.length === 0) {
    line("Tidak ada.", { color: [0.4, 0.4, 0.5] });
  } else {
    for (const tx of summary.unclaimed) {
      const bk = uploads.length > 0 ? ` [${bankLabel(tx.bankId)}]` : "";
      const carry = tx.source === "carryover" ? " (carry-over)" : "";
      line(
        `- ${tx.tanggal} ${tx.waktu}${bk}${carry} | ${tx.namaPengirim || "?"} | Rp ${formatRupiah(tx.kredit)}`,
      );
    }
  }
}
