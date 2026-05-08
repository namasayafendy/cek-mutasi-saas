// Parser untuk BSI mutasi via BYOND mobile app.
// Format:
// - Date "DD MMM YYYY" di kolom kiri (x~38)
// - Time HH:MM di line bawah date
// - Detail Transaksi: multi-line di kolom 117. Line pertama biasanya summary,
//   line "Dana Keluar" / "Dana Masuk" indicator
// - No Reff (FT...) di kolom ~248
// - Debit/Kredit/Saldo: nominal Indonesian format "X.XXX,XX" tapi PDF split
//   integer part dan ",XX" jadi 2 text items terpisah. Kita parse integer part saja.

import type { ParsedDocument, ParsedTxRow, ParseOptions } from "./types";

const DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/;
const TIME_RE = /^\d{2}:\d{2}$/;
// Integer dengan format Indonesia: digit dengan optional thousand separator
const NUMBER_INT_RE = /^\d{1,3}(?:\.\d{3})*$/;
const REF_RE = /^FT[A-Z0-9]+/;

const COL_DATE_X = 38;
const COL_DETAIL_X = 117;
const COL_REF_X = 248;
const COL_DEBIT_X = 349;
const COL_KREDIT_X = 464;
const COL_SALDO_X = 507;
const COL_X_TOLERANCE = 30;
const Y_TOLERANCE = 5;

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6,
  jul: 7, aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

type RawItem = { str: string; x: number; y: number; width: number; height: number };

function parseDate(s: string): { date: Date; ddmmyyyy: string } | null {
  const m = s.match(DATE_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monKey = m[2].toLowerCase();
  const month = MONTH_MAP[monKey];
  if (!month) return null;
  const year = parseInt(m[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (isNaN(date.getTime())) return null;
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return { date, ddmmyyyy: `${dd}-${mm}-${year}` };
}

function parseAmountID(s: string): number {
  if (!s || s === "0") return 0;
  const cleaned = s.replace(/\./g, "");
  const n = parseInt(cleaned, 10);
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

export async function parseBsiByond(file: File, _opts?: ParseOptions): Promise<ParsedDocument> {
  const ab = await file.arrayBuffer();
  const fileBuffer = new Uint8Array(ab);
  const { getDocument } = await import("../pdf/pdf-loader");
  const pdf = await getDocument(fileBuffer);

  const rows: ParsedTxRow[] = [];
  const pages: { width: number; height: number }[] = [];

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

    const dateItems = items
      .filter(
        (it) =>
          DATE_RE.test(it.str.trim()) && Math.abs(it.x - COL_DATE_X) <= COL_X_TOLERANCE,
      )
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < dateItems.length; i++) {
      const dateItem = dateItems[i];
      const dt = parseDate(dateItem.str.trim());
      if (!dt) continue;

      const yTop = dateItem.y + Y_TOLERANCE;
      const yBottom =
        i + 1 < dateItems.length ? dateItems[i + 1].y + Y_TOLERANCE : 0;
      const rowItems = items.filter((it) => it.y < yTop && it.y > yBottom);

      // Time
      const timeItem = rowItems.find(
        (it) =>
          TIME_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_DATE_X) <= COL_X_TOLERANCE,
      );
      const waktu = timeItem?.str.trim() ?? "";

      // No Reff
      const refItem = rowItems.find(
        (it) =>
          REF_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_REF_X) <= COL_X_TOLERANCE,
      );
      const noRef = refItem?.str.trim() ?? null;

      // Debit integer at column ~349 (same Y as date for first line of row)
      const debitInt = rowItems.find(
        (it) =>
          (NUMBER_INT_RE.test(it.str.trim()) || it.str.trim() === "0") &&
          it.x >= COL_DEBIT_X - 5 &&
          it.x <= COL_DEBIT_X + 50 &&
          Math.abs(it.y - dateItem.y) <= Y_TOLERANCE,
      );
      const debet = debitInt ? parseAmountID(debitInt.str.trim()) : 0;

      // Kredit integer at column ~464
      const kreditInt = rowItems.find(
        (it) =>
          (NUMBER_INT_RE.test(it.str.trim()) || it.str.trim() === "0") &&
          it.x >= COL_KREDIT_X - 20 &&
          it.x <= COL_KREDIT_X + 30 &&
          Math.abs(it.y - dateItem.y) <= Y_TOLERANCE,
      );
      const kredit = kreditInt ? parseAmountID(kreditInt.str.trim()) : 0;

      // Skip kalau keduanya nol
      if (kredit === 0 && debet === 0) continue;

      // Saldo
      const saldoInt = rowItems.find(
        (it) =>
          NUMBER_INT_RE.test(it.str.trim()) &&
          it.x >= COL_SALDO_X - 5 &&
          it.x <= COL_SALDO_X + 50 &&
          Math.abs(it.y - dateItem.y) <= Y_TOLERANCE,
      );
      const saldo = saldoInt ? parseAmountID(saldoInt.str.trim()) : null;

      // Detail multi-line
      const detailItems = rowItems
        .filter(
          (it) =>
            Math.abs(it.x - COL_DETAIL_X) <= COL_X_TOLERANCE &&
            it.str.trim().length > 0,
        )
        .sort((a, b) => b.y - a.y);
      const deskripsi = detailItems.map((d) => d.str.trim()).join(" ").trim();

      rows.push({
        no: rows.length + 1,
        page: pageNum,
        tanggal: dt.ddmmyyyy,
        tanggalDate: dt.date,
        waktu,
        namaPengirim: "",
        namaPenerima: "",
        deskripsi,
        noRef,
        saldo,
        kredit,
        debet,
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
