// Parser untuk BSI mutasi via BSINet (web).
// Format: PDF dengan tabel transaksi, kolom posisi X di-detect dynamic dari header
// "Waktu" dan "Kredit" supaya adaptif ke variasi layout.

import type { ParsedDocument, ParsedTxRow, ParseOptions } from "./types";
import { parseDateID } from "@/lib/format";

const ROW_HEIGHT = 45;
const ROW_TOLERANCE = 22;
const COL_X_TOLERANCE = 30;

const DATE_RE = /^\d{2}-\d{2}-\d{4}$/;
const KREDIT_RE = /^[\d,]+\.\d{2}$/;
const DEBET_RE = /^[\d,]+\.\d{2}-?$/; // debet kadang ada minus di akhir

const DEFAULT_WAKTU_X = 91.6;
const DEFAULT_KREDIT_X = 937;
const DEFAULT_DEBET_X = 847;

type RawItem = { str: string; x: number; y: number; width: number; height: number };

function parseAmount(s: string): number {
  const cleaned = s.replace(/,/g, "").replace(/-$/, "");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

async function detectColumnXs(
  pdf: { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> },
): Promise<{ waktuX: number; kreditX: number; debetX: number }> {
  let waktuX: number | null = null;
  let kreditX: number | null = null;
  let debetX: number | null = null;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (waktuX !== null && kreditX !== null && debetX !== null) break;
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const obj = it as { str?: string; transform?: number[] };
      if (typeof obj.str !== "string" || !Array.isArray(obj.transform)) continue;
      const s = obj.str.trim();
      const x = obj.transform[4];
      if (s === "Waktu" && waktuX === null) waktuX = x;
      if (s === "Kredit" && kreditX === null) kreditX = x;
      if (s === "Debet" && debetX === null) debetX = x;
    }
  }

  return {
    waktuX: waktuX ?? DEFAULT_WAKTU_X,
    kreditX: kreditX ?? DEFAULT_KREDIT_X,
    debetX: debetX ?? DEFAULT_DEBET_X,
  };
}

export async function parseBsiBsinet(
  file: File,
  _opts?: ParseOptions,
): Promise<ParsedDocument> {
  const ab = await file.arrayBuffer();
  const fileBuffer = new Uint8Array(ab);
  const { getDocument } = await import("../pdf/pdf-loader");
  const pdf = await getDocument(fileBuffer);

  const { waktuX, kreditX, debetX } = await detectColumnXs(pdf);

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

    const noItems = items
      .filter((it) =>
        /^\d{1,4}$/.test(it.str.trim()) && it.x < 50 && it.str.trim() !== "",
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
        (it) =>
          Math.abs(it.x - waktuX) <= COL_X_TOLERANCE && /^\d{1,2}\.\d{2}$/.test(it.str.trim()),
      );
      const waktu = timeItem?.str.trim() ?? "";

      const kreditItem = rowItems.find(
        (it) => Math.abs(it.x - kreditX) <= COL_X_TOLERANCE && KREDIT_RE.test(it.str.trim()),
      );
      const debetItem = rowItems.find(
        (it) => Math.abs(it.x - debetX) <= COL_X_TOLERANCE && DEBET_RE.test(it.str.trim()),
      );

      const kredit = kreditItem ? parseAmount(kreditItem.str.trim()) : 0;
      const debet = debetItem ? parseAmount(debetItem.str.trim()) : 0;

      // Skip kalau tidak ada nominal sama sekali
      if (kredit === 0 && debet === 0) continue;

      // Nama pengirim: di antara waktu dan kolom tengah (Bank Pengirim ~ Nama Penerima)
      const namaXMin = waktuX + 80;
      const namaXMax = waktuX + 250;
      const namaItems = rowItems
        .filter((it) => it.x >= namaXMin && it.x <= namaXMax && it.str.trim().length > 0)
        .sort((a, b) => b.y - a.y);
      const namaPengirim = namaItems.map((i) => i.str.trim()).join(" ").trim();

      // Nama penerima: kolom Penerima (sekitar kredit X - 200)
      const namaPenerimaXMin = kreditX - 320;
      const namaPenerimaXMax = kreditX - 200;
      const namaPenerimaItems = rowItems
        .filter(
          (it) =>
            it.x >= namaPenerimaXMin &&
            it.x <= namaPenerimaXMax &&
            it.str.trim().length > 0,
        )
        .sort((a, b) => b.y - a.y);
      const namaPenerima = namaPenerimaItems.map((i) => i.str.trim()).join(" ").trim();

      // Deskripsi
      const deskXMin = kreditX - 240;
      const deskXMax = kreditX - 60;
      const deskItems = rowItems
        .filter((it) => it.x >= deskXMin && it.x <= deskXMax && it.str.trim().length > 0)
        .sort((a, b) => b.y - a.y);
      const deskripsi = deskItems.map((i) => i.str.trim()).join(" ").trim();

      // No.Referensi: kolom No.Referensi, biasanya x ~155-170
      const refXMin = waktuX + 60;
      const refXMax = waktuX + 105;
      const refItem = rowItems.find(
        (it) =>
          it.x >= refXMin && it.x <= refXMax && /FT[A-Z0-9]+/i.test(it.str.trim()),
      );
      const noRef = refItem?.str.trim() ?? null;

      // Saldo: di kolom saldo, x ~kreditX + 86
      const saldoXMin = kreditX + 60;
      const saldoXMax = kreditX + 110;
      const saldoItem = rowItems.find(
        (it) =>
          it.x >= saldoXMin &&
          it.x <= saldoXMax &&
          /^[\d,]+\.\d{2}$/.test(it.str.trim()),
      );
      const saldo = saldoItem ? parseAmount(saldoItem.str.trim()) : null;

      rows.push({
        no,
        page: pageNum,
        tanggal: dateItem.str.trim(),
        tanggalDate,
        waktu,
        namaPengirim,
        namaPenerima,
        deskripsi,
        noRef,
        saldo,
        kredit,
        debet,
        bbox: {
          xLeft: 0,
          yBottom: yCenter - ROW_TOLERANCE,
          width: viewport.width,
          height: ROW_HEIGHT,
        },
      });
    }
  }

  return { rows, pages, fileBuffer };
}
