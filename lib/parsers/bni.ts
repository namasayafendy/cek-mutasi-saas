// Parser untuk BNI mutasi PDF (BNI Mobile Banking export).
// Format:
// - Single page (no pagination)
// - Date format YYYY-MM-DD di kolom kiri (~x=57)
// - Tipe: "Cr." (credit) atau "Db." (debit) di kolom tengah (~x=278)
// - Nominal: format Indonesia "10.000,00" (titik=thousands, koma=desimal) (~x=355)
// - Saldo: format sama (~x=490)
// - Uraian: multi-line text di kolom tengah (~x=125)
// - No No.Referensi tersedia

import type { ParsedDocument, ParsedTxRow, ParseOptions } from "./types";
import { parseDateISO } from "@/lib/format";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIPE_RE = /^(Cr|Db)\.$/;
const NOMINAL_RE = /^\d{1,3}(?:\.\d{3})*,\d{2}$/; // Indonesian format

const COL_DATE_X = 57;
const COL_URAIAN_X = 125;
const COL_TIPE_X = 278;
const COL_NOMINAL_X = 355;
const COL_SALDO_X = 490;
const COL_X_TOLERANCE = 30;
const Y_TOLERANCE = 5; // baris kompak, tipe/nominal di Y yang sama dengan date

type RawItem = { str: string; x: number; y: number; width: number; height: number };

function parseAmountID(s: string): number {
  // "10.000,00" → 10000
  // Buang titik (thousands), ganti koma dengan titik (desimal)
  const cleaned = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

export async function parseBni(file: File, _opts?: ParseOptions): Promise<ParsedDocument> {
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

    // Find date items (sort top to bottom)
    const dateItems = items
      .filter(
        (it) =>
          DATE_RE.test(it.str.trim()) && Math.abs(it.x - COL_DATE_X) <= COL_X_TOLERANCE,
      )
      .sort((a, b) => b.y - a.y);

    // Loop through dates, determine row Y range = from this date to next date
    for (let i = 0; i < dateItems.length; i++) {
      const dateItem = dateItems[i];
      const tanggalDate = parseDateISO(dateItem.str.trim());
      if (!tanggalDate) continue;

      const yTop = dateItem.y + Y_TOLERANCE;
      const yBottom =
        i + 1 < dateItems.length ? dateItems[i + 1].y + Y_TOLERANCE : 0;

      const rowItems = items.filter((it) => it.y < yTop && it.y > yBottom);

      // Tipe: di Y yang sama dengan date, kolom tipe
      const tipeItem = rowItems.find(
        (it) =>
          TIPE_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_TIPE_X) <= COL_X_TOLERANCE &&
          Math.abs(it.y - dateItem.y) <= Y_TOLERANCE,
      );
      if (!tipeItem) continue;

      const isKredit = tipeItem.str.trim().startsWith("Cr");

      // Nominal: di Y yang sama
      const nominalItem = rowItems.find(
        (it) =>
          NOMINAL_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_NOMINAL_X) <= COL_X_TOLERANCE &&
          Math.abs(it.y - dateItem.y) <= Y_TOLERANCE,
      );
      if (!nominalItem) continue;
      const nominal = parseAmountID(nominalItem.str.trim());
      if (nominal === 0) continue;

      // Saldo: di Y yang sama
      const saldoItem = rowItems.find(
        (it) =>
          NOMINAL_RE.test(it.str.trim()) &&
          Math.abs(it.x - COL_SALDO_X) <= COL_X_TOLERANCE &&
          Math.abs(it.y - dateItem.y) <= Y_TOLERANCE,
      );
      const saldo = saldoItem ? parseAmountID(saldoItem.str.trim()) : null;

      // Uraian: multi-line di kolom uraian, sort by Y desc
      const uraianItems = rowItems
        .filter(
          (it) =>
            Math.abs(it.x - COL_URAIAN_X) <= COL_X_TOLERANCE &&
            it.str.trim().length > 0,
        )
        .sort((a, b) => b.y - a.y);
      const deskripsi = uraianItems.map((u) => u.str.trim()).join(" ").trim();

      // Convert tanggalDate to DD-MM-YYYY string
      const dd = String(tanggalDate.getUTCDate()).padStart(2, "0");
      const mm = String(tanggalDate.getUTCMonth() + 1).padStart(2, "0");
      const yyyy = tanggalDate.getUTCFullYear();
      const tanggalDDMMYYYY = `${dd}-${mm}-${yyyy}`;

      rows.push({
        no: rows.length + 1, // BNI tidak ada No, generate sequential
        page: pageNum,
        tanggal: tanggalDDMMYYYY,
        tanggalDate,
        waktu: "",
        namaPengirim: "",
        namaPenerima: "",
        deskripsi,
        noRef: null, // BNI tidak ada
        saldo,
        kredit: isKredit ? nominal : 0,
        debet: isKredit ? 0 : nominal,
        bbox: {
          xLeft: 0,
          yBottom: yBottom,
          width: viewport.width,
          height: yTop - yBottom,
        },
      });
    }
  }

  return { rows, pages, fileBuffer };
}
