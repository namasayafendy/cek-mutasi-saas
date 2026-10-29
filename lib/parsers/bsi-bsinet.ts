// Parser untuk BSI mutasi via BSINet (web).
// Format: PDF dengan tabel transaksi, kolom posisi X di-detect dynamic dari header
// "Waktu" dan "Kredit" supaya adaptif ke variasi layout.

import type { ParsedDocument, ParsedTxRow, ParseOptions, StatementMeta } from "./types";
import { parseDateID } from "@/lib/format";

const ROW_HEIGHT = 45;
const ROW_TOLERANCE = 22;
const COL_X_TOLERANCE = 30;

const DATE_ANY_RE = /(\d{2}-\d{2}-\d{4})/; // tanggal di mana saja dalam string gabungan
const TIME_RE = /(\d{1,2}\.\d{2})/;        // jam HH.MM
const KREDIT_RE = /^[\d,]+\.\d{2}$/;
const DEBET_RE = /^[\d,]+\.\d{2}-?$/; // debet kadang ada minus di akhir

const DEFAULT_WAKTU_X = 91.6;
const DEFAULT_KREDIT_X = 937;
const DEFAULT_DEBET_X = 847;
const DEFAULT_KODE_X = 1120;

type RawItem = { str: string; x: number; y: number; width: number; height: number };

function parseAmount(s: string): number {
  const cleaned = s.replace(/,/g, "").replace(/-$/, "");
  const n = parseFloat(cleaned);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

async function detectColumnXs(
  pdf: { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> },
): Promise<{ waktuX: number; kreditX: number; debetX: number; kodeX: number }> {
  let waktuX: number | null = null;
  let kreditX: number | null = null;
  let debetX: number | null = null;
  let kodeX: number | null = null;

  for (let p = 1; p <= pdf.numPages; p++) {
    if (waktuX !== null && kreditX !== null && debetX !== null && kodeX !== null) break;
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
      if (s === "Kode" && kodeX === null) kodeX = x;
    }
  }

  return {
    waktuX: waktuX ?? DEFAULT_WAKTU_X,
    kreditX: kreditX ?? DEFAULT_KREDIT_X,
    debetX: debetX ?? DEFAULT_DEBET_X,
    kodeX: kodeX ?? DEFAULT_KODE_X,
  };
}

type MetaKepala = Pick<
  StatementMeta,
  | "printedKredit"
  | "printedDebet"
  | "saldoAwal"
  | "saldoAkhir"
  | "nomorRekening"
  | "mataUang"
  | "produk"
  | "periodeAwal"
  | "periodeAkhir"
>;

/** "YYYY-MM-DD" bila tanggal itu benar-benar ada di kalender, selain itu null. */
function tanggalSah(y: string, m: string, d: string): string | null {
  const iso = `${y}-${m}-${d}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

// Ekstrak ringkasan header (total tercetak + saldo awal/akhir + identitas
// rekening + periode) dari halaman 1.
// Nilai dari header = eksak (bukan hasil pembulatan per-baris).
//
// IDENTITAS REKENING: kepala PDF BSINet mencetak
//   "REKENING : IDR 1999881994 - BSI TABUNGAN BISNIS"
//   "Periode" ": 27/04/2026 s/d 30/04/2026"   (dua potongan teks, y sama)
// Nama pemilik TIDAK dicetak, jadi nomor inilah satu-satunya cara tahu PDF
// ini milik rekening mana. Dibaca per BARIS (potongan dengan y sama digabung
// urut x), bukan per potongan, supaya tetap terbaca kalau suatu hari BSI
// memecah teksnya jadi beberapa potongan.
async function extractStatementMeta(
  pdf: { getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> },
): Promise<MetaKepala> {
  const tc = await (await pdf.getPage(1)).getTextContent();
  const items: { s: string; x: number; y: number }[] = [];
  for (const it of tc.items) {
    const o = it as { str?: string; transform?: number[] };
    if (typeof o.str !== "string" || !Array.isArray(o.transform)) continue;
    items.push({ s: o.str, x: o.transform[4], y: o.transform[5] });
  }
  const num = (s: string): number | null => {
    const m = s.match(/([\d,]+\.\d{2})/);
    return m ? parseAmount(m[1]) : null;
  };
  const valNear = (line: { x: number; y: number }): number | null => {
    const v = items.find((it) => Math.abs(it.y - line.y) < 3 && it.x > line.x && /[\d,]+\.\d{2}/.test(it.s));
    return v ? num(v.s) : null;
  };
  const labeled = (label: string): number | null => {
    const lab = items.find((it) => it.s.includes(label));
    if (!lab) return null;
    return num(lab.s) ?? valNear(lab);
  };
  // "Saldo riil ... per [tgl]" muncul 2x: atas = awal, bawah = akhir.
  const saldoLines = items.filter((it) => it.s.includes("Saldo riil")).sort((a, b) => b.y - a.y);
  const saldoNum = (line?: { s: string; x: number; y: number }): number | null =>
    line ? (num(line.s) ?? valNear(line)) : null;

  // Teks satu baris utuh di ketinggian y (potongan berdekatan digabung urut x).
  const barisDi = (y: number): string =>
    items
      .filter((it) => Math.abs(it.y - y) < 3)
      .sort((a, b) => a.x - b.x)
      .map((it) => it.s)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  let nomorRekening: string | null = null;
  let mataUang: string | null = null;
  let produk: string | null = null;
  const labRek = items.find((it) => /REKENING\s*:/i.test(it.s));
  if (labRek) {
    const m = barisDi(labRek.y).match(/REKENING\s*:\s*([A-Z]{3})\s+(\d{6,20})\s*(?:-\s*(.+))?$/i);
    if (m) {
      mataUang = m[1].toUpperCase();
      nomorRekening = m[2];
      produk = m[3]?.trim() || null;
    }
  }

  // Periode: baris PERTAMA (paling atas) yang berpola "dd/mm/yyyy s/d dd/mm/yyyy".
  // Sengaja tidak mencari kata "Periode" — kata itu juga ada di
  // "Total Debet (Dalam Periode)".
  let periodeAwal: string | null = null;
  let periodeAkhir: string | null = null;
  const ySemua = [...new Set(items.map((it) => Math.round(it.y)))].sort((a, b) => b - a);
  for (const y of ySemua) {
    const m = barisDi(y).match(/(\d{2})\/(\d{2})\/(\d{4})\s*s\/d\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (m) {
      // Tanggal yang tidak ada di kalender (mis. 31/02) → null, bukan string
      // yang membuat penyimpanan catatan unggahan gagal di database.
      periodeAwal = tanggalSah(m[3], m[2], m[1]);
      periodeAkhir = tanggalSah(m[6], m[5], m[4]);
      break;
    }
  }

  return {
    printedKredit: labeled("Total Kredit"),
    printedDebet: labeled("Total Debet"),
    saldoAwal: saldoNum(saldoLines[0]),
    saldoAkhir: saldoNum(saldoLines[1]),
    nomorRekening,
    mataUang,
    produk,
    periodeAwal,
    periodeAkhir,
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
  return parseBsiBsinetDari(pdf, fileBuffer);
}

/**
 * Inti parser, menerima dokumen pdfjs yang SUDAH dibuka.
 *
 * Dipisah dari parseBsiBsinet hanya supaya bisa dijalankan di Node (skrip uji
 * memakai pdfjs-dist/legacy) terhadap PDF arsip sungguhan — tanpa browser dan
 * tanpa menulis apa pun ke database. Perilakunya identik.
 */
export async function parseBsiBsinetDari(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  fileBuffer: Uint8Array,
): Promise<ParsedDocument> {
  const { waktuX, kreditX, debetX, kodeX } = await detectColumnXs(pdf);

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

      // Tanggal & jam: BSINet kadang memecah jadi 2 baris ("01-05-" + "2026 10.21").
      // Gabungkan semua potongan di kolom Waktu lalu ekstrak via regex. Tetap
      // kompatibel dgn format lama yang utuh "01-05-2026".
      const waktuItems = rowItems
        .filter((it) => Math.abs(it.x - waktuX) <= COL_X_TOLERANCE && it.str.trim().length > 0)
        .sort((a, b) => b.y - a.y);
      const waktuJoined = waktuItems.map((i) => i.str.trim()).join(" ");
      const dateMatch = waktuJoined.replace(/\s+/g, "").match(DATE_ANY_RE);
      if (!dateMatch) continue;
      const tanggalStr = dateMatch[1];
      const tanggalDate = parseDateID(tanggalStr);
      if (!tanggalDate) continue;

      const timeMatch = waktuJoined.match(TIME_RE);
      const waktu = timeMatch ? timeMatch[1] : "";

      const kreditItem = rowItems.find(
        (it) => Math.abs(it.x - kreditX) <= COL_X_TOLERANCE && KREDIT_RE.test(it.str.trim()),
      );
      const debetItem = rowItems.find(
        (it) => Math.abs(it.x - debetX) <= COL_X_TOLERANCE && DEBET_RE.test(it.str.trim()),
      );

      let kredit = kreditItem ? parseAmount(kreditItem.str.trim()) : 0;
      let debet = debetItem ? parseAmount(debetItem.str.trim()) : 0;

      // Fallback: kadang pdfjs menggabung NOMINAL dgn teks deskripsi jadi 1 item
      // (mis. "Tf lhok - TRF Ke - M NASIR 1,240,000.00-") sehingga tak ada item
      // angka terpisah di kolom Debet/Kredit -> baris bisa hilang. Ekstrak dari
      // ekor teks: akhiran minus = debet, tanpa minus = kredit.
      if (kredit === 0 && debet === 0) {
        for (const it of rowItems) {
          const mm = it.str.trim().match(/^(.*\S)\s+([\d,]+\.\d{2})(-?)$/);
          if (mm && it.x >= waktuX + 100) {
            const v = parseAmount(mm[2] + mm[3]);
            if (v > 0) { if (mm[3] === "-") debet = v; else kredit = v; break; }
          }
        }
      }

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

      // Deskripsi: batasi sebelum kolom Debet supaya nominal debet (mis. x~857)
      // tidak ikut tergabung jadi teks keterangan; buang juga token nominal.
      const deskXMin = kreditX - 240;
      const deskXMax = debetX - 20;
      const deskItems = rowItems
        .filter(
          (it) =>
            it.x >= deskXMin &&
            it.x <= deskXMax &&
            it.str.trim().length > 0 &&
            !KREDIT_RE.test(it.str.trim()) &&
            !DEBET_RE.test(it.str.trim()),
        )
        .sort((a, b) => b.y - a.y);
      // Strip nominal yg menempel di ekor teks (kasus item gabungan) supaya
      // keterangan bersih tanpa angka.
      const deskripsi = deskItems
        .map((i) => i.str.trim().replace(/\s+[\d,]+\.\d{2}-?$/, "").trim())
        .filter((s) => s.length > 0)
        .join(" ")
        .trim();

      // No.Referensi (FT...) ada di kiri kolom Nama Pengirim. Satu transfer keluar
      // = 2 baris (pokok + biaya Rp6.500) berbagi ref yang SAMA, dibedakan kolom
      // Kode (213 vs 234) → ikutkan Kode supaya dedup tidak menabrakkan keduanya.
      const refItem = rowItems.find(
        (it) => it.x < namaXMin && /^FT[A-Z0-9]{5,}/i.test(it.str.trim()),
      );
      const kodeItem = rowItems.find(
        (it) => Math.abs(it.x - kodeX) <= COL_X_TOLERANCE && /^\d{2,4}$/.test(it.str.trim()),
      );
      const kode = kodeItem?.str.trim() ?? "";
      const noRef = refItem ? refItem.str.trim() + (kode ? `/${kode}` : "") : null;

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
        tanggal: tanggalStr,
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

  const dates = rows.map((r) => r.tanggalDate.getTime()).filter((t) => !Number.isNaN(t));
  const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
  const metaHeader = await extractStatementMeta(pdf);
  const statementMeta: StatementMeta = {
    ...metaHeader,
    firstDate: dates.length ? toISO(Math.min(...dates)) : null,
    lastDate: dates.length ? toISO(Math.max(...dates)) : null,
  };

  return { rows, pages, fileBuffer, statementMeta };
}
