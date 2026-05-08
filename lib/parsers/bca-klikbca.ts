// Parser untuk BCA KlikBCA HTML (download dari klikbca.com Mutasi Rekening).
// Format: HTML dengan TABLE struktur:
// - Header info: No. rekening, Nama, Periode
// - Table transaksi 5 kolom: Tanggal | Keterangan | Cabang | Jumlah | Saldo
// - Jumlah format: "1,020,000.00 CR" atau "30,000.00 DB"
//
// Karena pipeline app pakai PDF (viewer + pdf-lib highlight), kita generate
// synthetic PDF dari data parsed sebagai bridge — output downloadable PDF
// yang bisa di-highlight pakai pipeline existing.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ParsedDocument, ParsedTxRow, ParseOptions } from "./types";

const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const JUMLAH_RE = /^([\d,]+\.\d{2})\s+(CR|DB)$/;
const SALDO_RE = /^[\d,]+\.\d{2}$/;

function parseAmount(s: string): number {
  const cleaned = s.replace(/,/g, "").replace(/\.\d{2}$/, "");
  const n = parseInt(cleaned, 10);
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

type AccountInfo = {
  noRekening: string;
  nama: string;
  periode: string;
};

type RawRow = {
  tanggalStr: string;
  keterangan: string;
  cabang: string;
  jumlahStr: string;
  saldoStr: string;
};

function extractFromHtml(html: string): { info: AccountInfo; rows: RawRow[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract account info from first table (header table with B tags)
  const info: AccountInfo = { noRekening: "", nama: "", periode: "" };
  const allTr = doc.querySelectorAll("tr");
  for (const tr of Array.from(allTr)) {
    const tds = tr.querySelectorAll("td");
    if (tds.length === 2) {
      const label = tds[0].textContent?.trim() ?? "";
      const value = tds[1].textContent?.trim() ?? "";
      if (label === "No. rekening") info.noRekening = value;
      if (label === "Nama") info.nama = value;
      if (label === "Periode") info.periode = value;
    }
  }

  // Extract transaction rows: TR with 5 TDs
  const rows: RawRow[] = [];
  for (const tr of Array.from(allTr)) {
    const tds = tr.querySelectorAll("td");
    if (tds.length !== 5) continue;
    const tanggalStr = tds[0].textContent?.trim() ?? "";
    if (!DATE_RE.test(tanggalStr)) continue; // skip header rows
    rows.push({
      tanggalStr,
      keterangan: tds[1].textContent?.trim() ?? "",
      cabang: tds[2].textContent?.trim() ?? "",
      jumlahStr: tds[3].textContent?.trim() ?? "",
      saldoStr: tds[4].textContent?.trim() ?? "",
    });
  }

  return { info, rows };
}

// PDF layout constants
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 30;
const HEADER_HEIGHT = 90;
const TABLE_HEADER_HEIGHT = 25;
const ROW_HEIGHT = 36;

const COL_TGL_X = 30;
const COL_KETERANGAN_X = 90;
const COL_JUMLAH_X = 380;
const COL_SALDO_X = 490;

async function generateSyntheticPdf(
  info: AccountInfo,
  txRows: ParsedTxRow[],
): Promise<{ buffer: Uint8Array; pages: { width: number; height: number }[] }> {
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const usableHeight = PAGE_H - MARGIN - HEADER_HEIGHT - TABLE_HEADER_HEIGHT - MARGIN;
  const rowsPerPage = Math.floor(usableHeight / ROW_HEIGHT);

  const pageInfos: { width: number; height: number }[] = [];

  // Truncate long string to fit
  function truncate(s: string, font: typeof helvetica, fontSize: number, maxWidth: number): string {
    let t = s;
    while (font.widthOfTextAtSize(t, fontSize) > maxWidth && t.length > 3) {
      t = t.slice(0, -1);
    }
    if (t !== s) t = t.slice(0, -1) + "…";
    return t;
  }

  let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  pageInfos.push({ width: PAGE_W, height: PAGE_H });

  function drawHeader(p: typeof currentPage) {
    p.drawText("BCA KlikBCA — Mutasi Rekening", {
      x: MARGIN,
      y: PAGE_H - MARGIN - 14,
      size: 14,
      font: helveticaBold,
      color: rgb(0, 0.29, 0.64),
    });
    p.drawText(`No. Rekening: ${info.noRekening}`, {
      x: MARGIN,
      y: PAGE_H - MARGIN - 32,
      size: 9,
      font: helvetica,
    });
    p.drawText(`Nama: ${info.nama}`, {
      x: MARGIN,
      y: PAGE_H - MARGIN - 45,
      size: 9,
      font: helvetica,
    });
    p.drawText(`Periode: ${info.periode}`, {
      x: MARGIN,
      y: PAGE_H - MARGIN - 58,
      size: 9,
      font: helvetica,
    });

    // Table header row
    const tableTopY = PAGE_H - MARGIN - HEADER_HEIGHT;
    p.drawRectangle({
      x: MARGIN,
      y: tableTopY - TABLE_HEADER_HEIGHT,
      width: PAGE_W - 2 * MARGIN,
      height: TABLE_HEADER_HEIGHT,
      color: rgb(0.26, 0.48, 0.71),
    });
    const headerTextY = tableTopY - 16;
    p.drawText("Tanggal", { x: COL_TGL_X + 5, y: headerTextY, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
    p.drawText("Keterangan", { x: COL_KETERANGAN_X, y: headerTextY, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
    p.drawText("Jumlah", { x: COL_JUMLAH_X, y: headerTextY, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
    p.drawText("Saldo", { x: COL_SALDO_X, y: headerTextY, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
  }

  drawHeader(currentPage);

  let pageNum = 1;
  let rowOnPage = 0;

  for (const row of txRows) {
    if (rowOnPage >= rowsPerPage) {
      currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
      pageInfos.push({ width: PAGE_W, height: PAGE_H });
      drawHeader(currentPage);
      pageNum++;
      rowOnPage = 0;
    }

    const tableTopY = PAGE_H - MARGIN - HEADER_HEIGHT - TABLE_HEADER_HEIGHT;
    const yBottom = tableTopY - (rowOnPage + 1) * ROW_HEIGHT;
    const yText = yBottom + ROW_HEIGHT - 14;
    const yText2 = yBottom + 8;

    // Alternate row background
    if (rowOnPage % 2 === 0) {
      currentPage.drawRectangle({
        x: MARGIN,
        y: yBottom,
        width: PAGE_W - 2 * MARGIN,
        height: ROW_HEIGHT,
        color: rgb(0.96, 0.97, 0.98),
      });
    }

    currentPage.drawText(row.tanggal, {
      x: COL_TGL_X + 5,
      y: yText,
      size: 8,
      font: helvetica,
    });
    const desc = truncate(row.deskripsi, helvetica, 8, COL_JUMLAH_X - COL_KETERANGAN_X - 10);
    currentPage.drawText(desc, {
      x: COL_KETERANGAN_X,
      y: yText,
      size: 8,
      font: helvetica,
    });

    const amount = row.kredit > 0 ? row.kredit : row.debet;
    const isKredit = row.kredit > 0;
    const amountStr =
      amount.toLocaleString("id-ID") + (isKredit ? " CR" : " DB");
    const amountColor = isKredit ? rgb(0.05, 0.4, 0.1) : rgb(0.7, 0.1, 0.1);
    currentPage.drawText(amountStr, {
      x: COL_JUMLAH_X,
      y: yText,
      size: 8,
      font: helveticaBold,
      color: amountColor,
    });
    if (row.saldo !== null) {
      currentPage.drawText(row.saldo.toLocaleString("id-ID"), {
        x: COL_SALDO_X,
        y: yText,
        size: 8,
        font: helvetica,
      });
    }

    // Update row's bbox + page
    row.page = pageNum;
    row.bbox = {
      xLeft: MARGIN,
      yBottom,
      width: PAGE_W - 2 * MARGIN,
      height: ROW_HEIGHT,
    };

    rowOnPage++;
  }

  const buffer = await pdfDoc.save();
  return { buffer: new Uint8Array(buffer), pages: pageInfos };
}

export async function parseBcaKlikbca(
  file: File,
  _opts?: ParseOptions,
): Promise<ParsedDocument> {
  const text = await file.text();
  const { info, rows } = extractFromHtml(text);

  const txRows: ParsedTxRow[] = [];
  for (const r of rows) {
    const dm = r.tanggalStr.match(DATE_RE);
    if (!dm) continue;
    const day = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10);
    const year = parseInt(dm[3], 10);
    const tanggalDate = new Date(Date.UTC(year, month - 1, day, 12));
    if (isNaN(tanggalDate.getTime())) continue;

    const jm = r.jumlahStr.match(JUMLAH_RE);
    if (!jm) continue;
    const amount = parseAmount(jm[1]);
    if (amount === 0) continue;
    const isKredit = jm[2] === "CR";

    const saldo = SALDO_RE.test(r.saldoStr) ? parseAmount(r.saldoStr) : null;
    const deskripsi = r.cabang
      ? `${r.keterangan} (Cabang: ${r.cabang})`.trim()
      : r.keterangan.trim();

    txRows.push({
      no: txRows.length + 1,
      page: 1, // will be updated when generating PDF
      tanggal: `${dm[1]}-${dm[2]}-${dm[3]}`,
      tanggalDate,
      waktu: "",
      namaPengirim: "",
      namaPenerima: "",
      deskripsi,
      noRef: null,
      saldo,
      kredit: isKredit ? amount : 0,
      debet: isKredit ? 0 : amount,
      bbox: { xLeft: 0, yBottom: 0, width: 0, height: 0 }, // updated below
    });
  }

  // Generate synthetic PDF (this also updates each row's page + bbox)
  const { buffer, pages } = await generateSyntheticPdf(info, txRows);

  return { rows: txRows, pages, fileBuffer: buffer };
}
