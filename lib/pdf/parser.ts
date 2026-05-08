// Parser untuk PDF mutasi rekening Bank Syariah Indonesia (BSI).
//
// Kolom posisi X dideteksi dynamic dari header "Waktu" dan "Kredit"
// supaya adaptif kalau BSI ubah layout PDF.

import type { PdfTransaction } from "@/lib/types";
import { parseDateID } from "@/lib/format";

export type ParsedPdf = {
  transactions: PdfTransaction[];
  pages: { width: number; height: number }[];
  fileBuffer: Uint8Array;
};

type RawItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const ROW_HEIGHT = 45;
const ROW_TOLERANCE = 22;
const COL_X_TOLERANCE = 30;

const DATE_RE = /^\d{2}-\d{2}-\d{4}$/;
const KREDIT_RE = /^[\d,]+\.\d{2}$/;

const DEFAULT_WAKTU_X = 91.6;
const DEFAULT_KREDIT_X = 937;

function parseKreditNumber(s: string): number | null {
  const cleaned = s.replace(/,/g, "");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

/** Cari X posisi kolom Kredit dan Waktu dari header. Scan semua halaman. */
async function detectColumnXs(
  pdf: { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> },
): Promise<{ waktuX: number; kreditX: number }> {
  let waktuX: number | null = null;
  let kreditX: number | null = null;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (waktuX !== null && kreditX !== null) break;
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const obj = it as { str?: string; transform?: number[] };
      if (typeof obj.str !== "string" || !Array.isArray(obj.transform)) continue;
      const s = obj.str.trim();
      const x = obj.transform[4];
      if (s === "Waktu" && waktuX === null) waktuX = x;
      if (s === "Kredit" && kreditX === null) kreditX = x;
    }
  }

  return {
    waktuX: waktuX ?? DEFAULT_WAKTU_X,
    kreditX: kreditX ?? DEFAULT_KREDIT_X,
  };
}

export async function parsePdfFile(file: File): Promise<ParsedPdf> {
  const ab = await file.arrayBuffer();
  const fileBuffer = new Uint8Array(ab);
  const { getDocument } = await import("./pdf-loader");
  const pdf = await getDocument(fileBuffer);

  const { waktuX, kreditX } = await detectColumnXs(pdf);

  const transactions: PdfTransaction[] = [];
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

    const noItems = items
      .filter((it) =>
        /^\d{1,4}$/.test(it.str.trim()) &&
        it.x < 50 &&
        it.str.trim() !== "",
      )
      .sort((a, b) => b.y - a.y);

    for (const noItem of noItems) {
      const no = parseInt(noItem.str.trim(), 10);
      const yCenter = noItem.y;
      const yMin = yCenter - ROW_TOLERANCE;
      const yMax = yCenter + ROW_TOLERANCE;
      const rowItems = items.filter((it) => it.y >= yMin && it.y <= yMax);

      const dateItem = rowItems.find(
        (it) => Math.abs(it.x - waktuX) <= COL_X_TOLERANCE && DATE_RE.test(it.str.trim()),
      );
      if (!dateItem) continue;
      const tanggalDate = parseDateID(dateItem.str.trim());
      if (!tanggalDate) continue;

      const timeItem = rowItems.find(
        (it) => Math.abs(it.x - waktuX) <= COL_X_TOLERANCE && /^\d{1,2}\.\d{2}$/.test(it.str.trim()),
      );
      const waktu = timeItem?.str.trim() ?? "";

      const kreditItem = rowItems.find(
        (it) => Math.abs(it.x - kreditX) <= COL_X_TOLERANCE && KREDIT_RE.test(it.str.trim()),
      );
      if (!kreditItem) continue;
      const kredit = parseKreditNumber(kreditItem.str.trim());
      if (!kredit) continue;

      // Nama pengirim: cari di antara waktu dan kredit
      const namaXMin = waktuX + 80;
      const namaXMax = waktuX + 250;
      const namaItems = rowItems
        .filter((it) => it.x >= namaXMin && it.x <= namaXMax && it.str.trim().length > 0)
        .sort((a, b) => b.y - a.y);
      const namaPengirim = namaItems.map((i) => i.str.trim()).join(" ").trim();

      // Deskripsi: cari di kolom sebelum kredit
      const deskXMin = kreditX - 240;
      const deskXMax = kreditX - 60;
      const deskItems = rowItems
        .filter((it) => it.x >= deskXMin && it.x <= deskXMax && it.str.trim().length > 0)
        .sort((a, b) => b.y - a.y);
      const deskripsi = deskItems.map((i) => i.str.trim()).join(" ").trim();

      transactions.push({
        no,
        page: pageNum,
        tanggal: dateItem.str.trim(),
        tanggalDate,
        waktu,
        namaPengirim,
        deskripsi,
        kredit,
        bbox: {
          xLeft: 0,
          yBottom: yCenter - ROW_TOLERANCE,
          width: viewport.width,
          height: ROW_HEIGHT,
        },
      });
    }
  }

  return { transactions, pages, fileBuffer };
}
