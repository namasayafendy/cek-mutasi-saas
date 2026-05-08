// Parser untuk BCA e-Statement PDF (bulanan).
// Format:
// - Date column: "DD/MM" di x~43 (year dari PERIODE header)
// - Keterangan first line di x~88 — cek suffix " CR" atau " DB" / "DEBIT" untuk
//   determine jenis (DB rows kadang punya suffix "DB" terpisah di x~442, tapi
//   CR rows tidak konsisten — paling reliable: cek text keterangan)
// - Mutasi value di x~395 (US format X,XXX.XX)
// - Saldo di x~525 (optional — hanya di akhir group)
// - Skip "SALDO AWAL" rows

import type { ParsedDocument, ParsedTxRow, ParseOptions } from "./types";

const DATE_RE = /^(\d{2})\/(\d{2})$/;
const NOMINAL_RE = /^[\d,]+\.\d{2}$/;

const COL_DATE_X = 43;
const COL_DESC_X = 88;
const COL_DETAIL_X = 194;
const COL_NOMINAL_X = 395;
const COL_SALDO_X = 525;
const COL_X_TOLERANCE = 25;
const Y_TOLERANCE = 5;

type RawItem = { str: string; x: number; y: number; width: number; height: number };

function parseAmount(s: string): number {
  const cleaned = s.replace(/,/g, "").replace(/\.\d{2}$/, "");
  const n = parseInt(cleaned, 10);
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

function detectYear(items: RawItem[]): number {
  for (const it of items) {
    const m = it.str.trim().match(/^[A-Za-z]+\s+(\d{4})$/);
    if (m && it.y > 600) {
      const y = parseInt(m[1], 10);
      if (y >= 2000 && y <= 2099) return y;
    }
  }
  return new Date().getUTCFullYear();
}

/** Determine kredit/debet from keterangan text. Returns "kredit" | "debet" | null. */
function detectJenis(desc: string): "kredit" | "debet" | null {
  const s = desc.trim().toUpperCase();
  if (/\bCR\b\s*$/.test(s) || /\bKREDIT\b/.test(s)) return "kredit";
  if (/\bDB\b\s*$/.test(s) || /DEBIT\b/.test(s)) return "debet";
  return null;
}

export async function parseBcaEstatement(
  file: File,
  _opts?: ParseOptions,
): Promise<ParsedDocument> {
  const ab = await file.arrayBuffer();
  const fileBuffer = new Uint8Array(ab);
  const { getDocument } = await import("../pdf/pdf-loader");
  const pdf = await getDocument(fileBuffer);

  const rows: ParsedTxRow[] = [];
  const pages: { width: number; height: number }[] = [];

  // Detect year from page 1 header
  const firstPage = await pdf.getPage(1);
  const firstTc = await firstPage.getTextContent();
  const firstItems: RawItem[] = [];
  for (const it of firstTc.items) {
    const obj = it as { str?: string; transform?: number[] };
    if (typeof obj.str !== "string" || !Array.isArray(obj.transform)) continue;
    firstItems.push({ str: obj.str, x: obj.transform[4], y: obj.transform[5], width: 0, height: 0 });
  }
  const year = detectYear(firstItems);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({ width: viewport.width, height: viewport.height });

    const tc = await page.getTextContent();
    const items: RawItem[] = [];
    for (const it of tc.items) {
      const obj = it as { str?: string; transform?: number[]; width?: number; height?: number };
      if (typeof obj.str !== "string" || !Array.isArray(obj.transform)) continue;
      items.push({
        str: obj.str,
        x: obj.transform[4],
        y: obj.transform[5],
        width: obj.width ?? 0,
        height: obj.height ?? 0,
      });
    }

    // Date items: DD/MM at x~43
    const dateItems = items
      .filter(
        (it) =>
          DATE_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_DATE_X) <= COL_X_TOLERANCE,
      )
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < dateItems.length; i++) {
      const dateItem = dateItems[i];
      const dm = dateItem.str.trim().match(DATE_RE);
      if (!dm) continue;
      const day = parseInt(dm[1], 10);
      const month = parseInt(dm[2], 10);
      const tanggalDate = new Date(Date.UTC(year, month - 1, day, 12));
      if (isNaN(tanggalDate.getTime())) continue;

      const yCenter = dateItem.y;
      const yTop = yCenter + Y_TOLERANCE;
      const yBottom =
        i + 1 < dateItems.length ? dateItems[i + 1].y + Y_TOLERANCE : 0;
      const rowItems = items.filter((it) => it.y < yTop && it.y > yBottom);

      // Keterangan first line at x=88, same Y as date (skip empty items)
      const descItem = rowItems.find(
        (it) =>
          Math.abs(it.x - COL_DESC_X) <= COL_X_TOLERANCE &&
          Math.abs(it.y - yCenter) <= Y_TOLERANCE &&
          it.str.trim().length > 0,
      );
      const descFirst = descItem?.str.trim() ?? "";

      // Skip SALDO AWAL rows
      if (/SALDO\s+AWAL/i.test(descFirst)) continue;

      // Detail lines at x=194
      const detailItems = rowItems
        .filter((it) => Math.abs(it.x - COL_DETAIL_X) <= COL_X_TOLERANCE)
        .sort((a, b) => b.y - a.y);
      const detailText = detailItems.map((d) => d.str.trim()).join(" ");
      const fullDesc = [descFirst, detailText].filter((s) => s.length > 0).join(" ");

      // Determine jenis from keterangan
      const jenis = detectJenis(descFirst) ?? detectJenis(detailText);
      if (!jenis) continue; // skip rows that aren't transactions

      // Nominal at x~395
      const nominalItem = rowItems.find(
        (it) =>
          NOMINAL_RE.test(it.str.trim()) &&
          it.x >= COL_NOMINAL_X - 30 &&
          it.x <= COL_NOMINAL_X + 30 &&
          Math.abs(it.y - yCenter) <= Y_TOLERANCE,
      );
      if (!nominalItem) continue;
      const amount = parseAmount(nominalItem.str.trim());
      if (amount === 0) continue;

      // Saldo (optional)
      const saldoItem = rowItems.find(
        (it) =>
          NOMINAL_RE.test(it.str.trim()) &&
          it.x >= COL_SALDO_X - 25 &&
          it.x <= COL_SALDO_X + 30 &&
          Math.abs(it.y - yCenter) <= Y_TOLERANCE,
      );
      const saldo = saldoItem ? parseAmount(saldoItem.str.trim()) : null;

      rows.push({
        no: rows.length + 1,
        page: pageNum,
        tanggal: `${dm[1]}-${dm[2]}-${year}`,
        tanggalDate,
        waktu: "",
        namaPengirim: "",
        namaPenerima: "",
        deskripsi: fullDesc,
        noRef: null,
        saldo,
        kredit: jenis === "kredit" ? amount : 0,
        debet: jenis === "debet" ? amount : 0,
        bbox: {
          xLeft: 0,
          yBottom,
          width: viewport.width,
          height: yTop - yBottom,
        },
      });
    }
  }

  return { rows, pages, fileBuffer };
}
