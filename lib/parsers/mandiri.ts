// Parser untuk Mandiri e-Statement PDF (password protected).
// Format:
// - PDF password protected (biasanya tanggal lahir DDMMYYYY)
// - Multi-page
// - "No" column at x=20 (1, 2, 3, ...)
// - "Date" column at x=52: "DD MMM YYYY" + "HH:MM:SS WIB" pada 2 baris terpisah
// - "Keterangan" column at x=124, multi-line
// - "Nominal (IDR)" at x=380-400: "+X.XXX,XX" untuk kredit, "-X.XXX,XX" untuk debet
// - "Saldo (IDR)" at x=520-535
// - Tidak ada No.Referensi explicit (numeric ref kadang ada di keterangan)

import type { ParsedDocument, ParsedTxRow, ParseOptions } from "./types";

const DATE_RE = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}\s+WIB$/;
const NOMINAL_RE = /^([+-])(\d{1,3}(?:\.\d{3})*),(\d{2})$/;
const SALDO_RE = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
const NO_RE = /^\d{1,4}$/;

const COL_NO_X = 20;
const COL_DATE_X = 52;
const COL_DESC_X = 124;
const COL_NOMINAL_X = 388;
const COL_SALDO_X = 530;
const COL_X_TOLERANCE = 30;
const Y_TOLERANCE = 8;

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6,
  jul: 7, aug: 8, agu: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, des: 12,
};

type RawItem = { str: string; x: number; y: number; width: number; height: number };

function parseDate(s: string): { date: Date; ddmmyyyy: string } | null {
  const m = s.match(DATE_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTH_MAP[m[2].toLowerCase()];
  if (!month) return null;
  const year = parseInt(m[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (isNaN(date.getTime())) return null;
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return { date, ddmmyyyy: `${dd}-${mm}-${year}` };
}

function parseAmountID(s: string): number {
  // "300.000,00" → 300000 (drop decimals, keep rupiah only)
  const cleaned = s.replace(/\./g, "").replace(/,\d{2}$/, "");
  const n = parseInt(cleaned, 10);
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

export async function parseMandiri(
  file: File,
  opts?: ParseOptions,
): Promise<ParsedDocument> {
  const ab = await file.arrayBuffer();
  const fileBuffer = new Uint8Array(ab);
  const { getDocument } = await import("../pdf/pdf-loader");
  const pdf = await getDocument(fileBuffer, { password: opts?.password });

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

    // Find header "No" label, gunakan Y-nya sebagai cutoff supaya kita tidak
    // accidentally pick up header sebagai transaction No. Header punya 2 "No"
    // (English + Indonesian), ambil yang paling bawah sebagai cutoff.
    const headerNoItems = items.filter(
      (it) => it.str.trim() === "No" && Math.abs(it.x - COL_NO_X) <= COL_X_TOLERANCE,
    );
    const headerCutoffY =
      headerNoItems.length > 0
        ? Math.min(...headerNoItems.map((h) => h.y)) - 5
        : viewport.height;

    const noItems = items
      .filter(
        (it) =>
          NO_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_NO_X) <= COL_X_TOLERANCE &&
          it.y < headerCutoffY,
      )
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < noItems.length; i++) {
      const noItem = noItems[i];
      const yCenter = noItem.y;
      const yTop = yCenter + 15;
      const yBottom =
        i + 1 < noItems.length ? noItems[i + 1].y + 15 : yCenter - 50;
      const rowItems = items.filter((it) => it.y < yTop && it.y > yBottom);

      // Date item
      const dateItem = rowItems.find(
        (it) =>
          DATE_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_DATE_X) <= COL_X_TOLERANCE,
      );
      if (!dateItem) continue;
      const dt = parseDate(dateItem.str.trim());
      if (!dt) continue;

      // Time
      const timeItem = rowItems.find(
        (it) =>
          TIME_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_DATE_X) <= COL_X_TOLERANCE,
      );
      const waktu = timeItem?.str.trim().replace(/\s+WIB$/, "") ?? "";

      // Nominal: +X,XX or -X,XX
      const nominalItem = rowItems.find(
        (it) =>
          NOMINAL_RE.test(it.str.trim()) &&
          it.x >= COL_NOMINAL_X - 30 &&
          it.x <= COL_NOMINAL_X + 30 &&
          Math.abs(it.y - yCenter) <= Y_TOLERANCE,
      );
      if (!nominalItem) continue;
      const m = nominalItem.str.trim().match(NOMINAL_RE);
      if (!m) continue;
      const sign = m[1];
      const amount = parseAmountID(`${m[2]},${m[3]}`);
      if (amount === 0) continue;

      const isKredit = sign === "+";

      // Saldo
      const saldoItem = rowItems.find(
        (it) =>
          SALDO_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_SALDO_X) <= COL_X_TOLERANCE &&
          Math.abs(it.y - yCenter) <= Y_TOLERANCE,
      );
      const saldo = saldoItem ? parseAmountID(saldoItem.str.trim()) : null;

      // Keterangan multi-line di kolom desc
      const descItems = rowItems
        .filter(
          (it) =>
            Math.abs(it.x - COL_DESC_X) <= COL_X_TOLERANCE &&
            it.str.trim().length > 0,
        )
        .sort((a, b) => b.y - a.y);
      const deskripsi = descItems.map((d) => d.str.trim()).join(" ").trim();

      rows.push({
        no: parseInt(noItem.str.trim(), 10),
        page: pageNum,
        tanggal: dt.ddmmyyyy,
        tanggalDate: dt.date,
        waktu,
        namaPengirim: "",
        namaPenerima: "",
        deskripsi,
        noRef: null, // Mandiri tidak punya no.ref explicit
        saldo,
        kredit: isKredit ? amount : 0,
        debet: isKredit ? 0 : amount,
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
