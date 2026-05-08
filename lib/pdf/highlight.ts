// Generate PDF output: original PDF + overlay highlight + halaman rekap.

import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { PdfTransaction, UserInput, MatchSummary, Outlet } from "@/lib/types";
import { hexToRgb01 } from "@/lib/colors";
import { formatDateID, formatRupiah, formatDateLong } from "@/lib/format";

export type HighlightInput = {
  fileBuffer: Uint8Array;
  transactions: PdfTransaction[];
  inputs: UserInput[];
  summary: MatchSummary;
  outlets: Outlet[];
};

const HIGHLIGHT_OPACITY = 0.4;

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
  drawRecapPages({ pdfDoc, fontRegular: helvetica, fontBold: helveticaBold, summary, outlets });

  return await pdfDoc.save();
}

type DrawRecapArgs = {
  pdfDoc: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  summary: MatchSummary;
  outlets: Outlet[];
};

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

function drawRecapPages(args: DrawRecapArgs) {
  const { pdfDoc, fontRegular, fontBold, summary, outlets } = args;
  const outletById = new Map(outlets.map((o) => [o.id, o]));

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function newPage() { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
  function ensureSpace(needed: number) { if (y - needed < MARGIN) newPage(); }
  function title(text: string) {
    ensureSpace(28);
    page.drawText(text, { x: MARGIN, y: y - 16, size: 16, font: fontBold, color: rgb(0.05, 0.05, 0.1) });
    y -= 24;
  }
  function subtitle(text: string) {
    ensureSpace(20);
    page.drawText(text, { x: MARGIN, y: y - 12, size: 12, font: fontBold, color: rgb(0.1, 0.1, 0.15) });
    y -= 18;
  }
  function line(text: string, opts?: { color?: [number, number, number]; size?: number; bold?: boolean }) {
    const size = opts?.size ?? 10;
    ensureSpace(size + 4);
    page.drawText(text, {
      x: MARGIN, y: y - size, size,
      font: opts?.bold ? fontBold : fontRegular,
      color: opts?.color ? rgb(opts.color[0], opts.color[1], opts.color[2]) : rgb(0.15, 0.15, 0.2),
    });
    y -= size + 4;
  }
  function spacer(h = 8) { y -= h; }
  function colorBox(hex: string, label: string) {
    ensureSpace(18);
    const { r, g, b } = hexToRgb01(hex);
    page.drawRectangle({
      x: MARGIN, y: y - 12, width: 14, height: 12,
      color: rgb(r, g, b), borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.5,
    });
    page.drawText(label, { x: MARGIN + 20, y: y - 10, size: 10, font: fontRegular, color: rgb(0.15, 0.15, 0.2) });
    y -= 18;
  }

  title("Rekap Cek Mutasi BSI");
  line(`Dibuat: ${formatDateLong(new Date())}`);
  spacer(6);

  subtitle("Ringkasan");
  line(`Total input: ${summary.totalInput}`);
  line(`Berhasil ter-match: ${summary.matched}`, { color: [0.05, 0.4, 0.1] });
  line(`Tidak ada nominal di mutasi: ${summary.noCandidate.length}`, { color: [0.7, 0.1, 0.1] });
  line(`Bentrok (sudah ke-claim input lain): ${summary.allTaken.length}`, { color: [0.7, 0.4, 0.05] });
  line(`Transaksi mutasi tidak di-claim: ${summary.unclaimed.length}`);
  spacer(8);

  subtitle("Legend warna outlet");
  for (const o of outlets) colorBox(o.warna_hex, o.nama);
  spacer(8);

  subtitle(`Input tidak ditemukan di mutasi (${summary.noCandidate.length})`);
  if (summary.noCandidate.length === 0) {
    line("Tidak ada.", { color: [0.4, 0.4, 0.5] });
  } else {
    for (const i of summary.noCandidate) {
      const o = outletById.get(i.outletId);
      line(`- ${formatDateID(i.tanggal)} | ${o?.nama ?? "?"} | Rp ${formatRupiah(i.nominal)}`);
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
      line(`- ${formatDateID(i.tanggal)} | ${o?.nama ?? "?"} | Rp ${formatRupiah(i.nominal)} (${conflictCount}x sudah ke-claim di tgl ${conflictDates})`);
    }
  }
  spacer(8);

  subtitle(`Transaksi mutasi tidak di-claim (${summary.unclaimed.length})`);
  if (summary.unclaimed.length === 0) {
    line("Tidak ada.", { color: [0.4, 0.4, 0.5] });
  } else {
    for (const tx of summary.unclaimed) {
      line(`- ${tx.tanggal} ${tx.waktu} | ${tx.namaPengirim || "?"} | Rp ${formatRupiah(tx.kredit)}`);
    }
  }
}
