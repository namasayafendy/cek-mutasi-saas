// Generate PDF output: merged multi-bank PDF + overlay highlight + halaman rekap.
//
// Supports either single-jenis output (legacy "cek kredit saja" flow) OR
// combined kredit+debet output when user uses the "Lanjut Cek Debet/Kredit"
// continuation flow.

import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import type { PdfTransaction, UserInput, MatchSummary, Outlet, Bank, Jenis } from "@/lib/types";
import { hexToRgb01 } from "@/lib/colors";
import { formatDateID, formatRupiah, formatDateLong } from "@/lib/format";

const HIGHLIGHT_OPACITY = 0.4;

// Default warna highlight untuk debet kalau setting debetHighlightSameColor = false.
const DEFAULT_DEBET_COLOR_HEX = "#475569";

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

export type BankUploadForPdf = {
  bank: Bank;
  fileBuffer: Uint8Array;
  kreditTransactions: PdfTransaction[];
  debetTransactions: PdfTransaction[];
};

export type CekPass = {
  jenis: Jenis;
  inputs: UserInput[];
  summary: MatchSummary;
};

export type MultiBankInput = {
  uploads: BankUploadForPdf[];
  outlets: Outlet[];
  passes: CekPass[];
  debetHighlightSameColor: boolean;
};

export async function generateMultiBankPdf(args: MultiBankInput): Promise<Uint8Array> {
  const { uploads, outlets, passes, debetHighlightSameColor } = args;
  const merged = await PDFDocument.create();
  const helvetica = await merged.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await merged.embedFont(StandardFonts.HelveticaBold);
  const outletById = new Map(outlets.map((o) => [o.id, o]));

  drawCoverPage({
    pdf: merged,
    fontRegular: helvetica,
    fontBold: helveticaBold,
    uploads,
    passes,
  });

  for (const up of uploads) {
    drawBankDivider(merged, helveticaBold, helvetica, up.bank);

    const copy = new Uint8Array(up.fileBuffer);
    const sourceDoc = await PDFDocument.load(copy);
    const sourcePages = sourceDoc.getPages();

    for (const pass of passes) {
      const passTransactions = pass.jenis === "kredit" ? up.kreditTransactions : up.debetTransactions;
      const inputsForBank = pass.inputs.filter((i) => i.bankId === up.bank.id || !i.bankId);

      for (const input of inputsForBank) {
        const m = input.match;
        if (!m || m.status !== "matched") continue;
        if (m.txBankId && m.txBankId !== up.bank.id) continue;
        const outlet = outletById.get(input.outletId);

        const matchedTx = passTransactions.find(
          (t) =>
            t.no === m.txNo &&
            t.tanggalDate.getTime() === m.txDate.getTime() &&
            t.kredit === input.nominal,
        );
        if (!matchedTx) continue;

        const pageIndex = matchedTx.page - 1;
        if (pageIndex < 0 || pageIndex >= sourcePages.length) continue;
        const page = sourcePages[pageIndex];

        const hex =
          pass.jenis === "debet" && !debetHighlightSameColor
            ? DEFAULT_DEBET_COLOR_HEX
            : outlet?.warna_hex ?? DEFAULT_DEBET_COLOR_HEX;
        const { r, g, b } = hexToRgb01(hex);

        page.drawRectangle({
          x: matchedTx.bbox.xLeft,
          y: matchedTx.bbox.yBottom,
          width: matchedTx.bbox.width,
          height: matchedTx.bbox.height,
          color: rgb(r, g, b),
          opacity: HIGHLIGHT_OPACITY,
        });
      }
    }

    const copiedPages = await merged.copyPages(sourceDoc, sourceDoc.getPageIndices());
    for (const p of copiedPages) merged.addPage(p);
  }

  drawRecapPages({
    pdfDoc: merged,
    fontRegular: helvetica,
    fontBold: helveticaBold,
    outlets,
    uploads,
    passes,
    debetHighlightSameColor,
  });

  return await merged.save();
}

// Legacy backward-compat API — kept so any old import path still compiles.
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
    outlets,
    uploads: [],
    passes: [{ jenis: "kredit", inputs, summary }],
    debetHighlightSameColor: true,
  });
  return await pdfDoc.save();
}

function asciiSafe(s: string): string {
  return s.replace(/[^\x00-\xFF]/g, "?");
}

function passLabel(jenis: Jenis): string {
  return jenis === "kredit" ? "Kredit (Masuk)" : "Debet (Keluar)";
}

function drawCoverPage(args: {
  pdf: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  uploads: BankUploadForPdf[];
  passes: CekPass[];
}) {
  const { pdf, fontRegular, fontBold, uploads, passes } = args;
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const titleText =
    passes.length === 1
      ? `Rekap Cek Mutasi ${passes[0].jenis === "kredit" ? "Kredit" : "Debet"}`
      : `Rekap Cek Mutasi (Kredit + Debet)`;

  page.drawText(asciiSafe(titleText), {
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
    const kreditTotal = up.kreditTransactions.reduce((s, t) => s + t.kredit, 0);
    const debetTotal = up.debetTransactions.reduce((s, t) => s + t.kredit, 0);
    page.drawText(
      asciiSafe(
        `- ${up.bank.label || up.bank.kode} | Kredit: ${up.kreditTransactions.length} tx (Rp ${formatRupiah(kreditTotal)}) | Debet: ${up.debetTransactions.length} tx (Rp ${formatRupiah(debetTotal)})`,
      ),
      { x: MARGIN, y: y - 10, size: 9, font: fontRegular, color: rgb(0.15, 0.15, 0.2) },
    );
    y -= 14;
  }

  y -= 8;
  for (const pass of passes) {
    page.drawText(asciiSafe(`Ringkasan ${passLabel(pass.jenis)}:`), {
      x: MARGIN,
      y: y - 13,
      size: 12,
      font: fontBold,
      color: rgb(0.1, 0.1, 0.15),
    });
    y -= 18;
    const lines = [
      `Total input: ${pass.summary.totalInput}`,
      `Match: ${pass.summary.matched}`,
      `Tidak ditemukan: ${pass.summary.noCandidate.length}`,
      `Bentrok: ${pass.summary.allTaken.length}`,
      `Mutasi belum di-claim: ${pass.summary.unclaimed.length}`,
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
    y -= 6;
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
  outlets: Outlet[];
  uploads: BankUploadForPdf[];
  passes: CekPass[];
  debetHighlightSameColor: boolean;
};

function drawRecapPages(args: DrawRecapArgs) {
  const { pdfDoc, fontRegular, fontBold, outlets, uploads, passes, debetHighlightSameColor } = args;
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

  const titleText =
    passes.length === 1
      ? `Lampiran Rekap Cek Mutasi ${passes[0].jenis === "kredit" ? "Kredit" : "Debet"}`
      : `Lampiran Rekap Cek Mutasi (Kredit + Debet)`;
  title(titleText);
  line(`Dibuat: ${formatDateLong(new Date())}`);
  spacer(6);

  const totalInput = passes.reduce((s, p) => s + p.summary.totalInput, 0);
  const totalMatched = passes.reduce((s, p) => s + p.summary.matched, 0);
  const totalNoCandidate = passes.reduce((s, p) => s + p.summary.noCandidate.length, 0);
  const totalAllTaken = passes.reduce((s, p) => s + p.summary.allTaken.length, 0);
  const totalUnclaimed = passes.reduce((s, p) => s + p.summary.unclaimed.length, 0);

  subtitle("Ringkasan Keseluruhan");
  line(`Total input: ${totalInput}`);
  line(`Berhasil ter-match: ${totalMatched}`, { color: [0.05, 0.4, 0.1] });
  line(`Tidak ada nominal di mutasi: ${totalNoCandidate}`, { color: [0.7, 0.1, 0.1] });
  line(`Bentrok (sudah ke-claim input lain): ${totalAllTaken}`, { color: [0.7, 0.4, 0.05] });
  line(`Transaksi mutasi tidak di-claim: ${totalUnclaimed}`);
  spacer(8);

  if (uploads.length > 0) {
    subtitle("Bank yang di-cek");
    for (const up of uploads) {
      const kt = up.kreditTransactions.reduce((s, t) => s + t.kredit, 0);
      const dt = up.debetTransactions.reduce((s, t) => s + t.kredit, 0);
      line(
        `- ${up.bank.label || up.bank.kode}: Kredit ${up.kreditTransactions.length} tx (Rp ${formatRupiah(kt)}), Debet ${up.debetTransactions.length} tx (Rp ${formatRupiah(dt)})`,
      );
    }
    spacer(8);
  }

  subtitle("Legend warna outlet");
  for (const o of outlets) colorBox(o.warna_hex, o.nama);
  if (passes.some((p) => p.jenis === "debet") && !debetHighlightSameColor) {
    colorBox(DEFAULT_DEBET_COLOR_HEX, "Debet (warna khusus)");
  }
  spacer(8);

  for (const pass of passes) {
    subtitle(`Detail Pass ${passLabel(pass.jenis)}`);
    line(`Total input: ${pass.summary.totalInput}`);
    line(`Match: ${pass.summary.matched}`, { color: [0.05, 0.4, 0.1] });
    spacer(4);

    line(`Tidak ditemukan di mutasi (${pass.summary.noCandidate.length}):`, { bold: true });
    if (pass.summary.noCandidate.length === 0) {
      line("  Tidak ada.", { color: [0.4, 0.4, 0.5] });
    } else {
      for (const i of pass.summary.noCandidate) {
        const o = outletById.get(i.outletId);
        const bk = uploads.length > 0 ? ` [${bankLabel(i.bankId)}]` : "";
        line(`  - ${formatDateID(i.tanggal)}${bk} | ${o?.nama ?? "?"} | Rp ${formatRupiah(i.nominal)}`);
      }
    }
    spacer(4);

    line(`Bentrok (${pass.summary.allTaken.length}):`, { bold: true });
    if (pass.summary.allTaken.length === 0) {
      line("  Tidak ada.", { color: [0.4, 0.4, 0.5] });
    } else {
      for (const i of pass.summary.allTaken) {
        const o = outletById.get(i.outletId);
        const m = i.match;
        const conflictCount = m?.status === "all_taken" ? m.conflictCount : 0;
        const conflictDates = m?.status === "all_taken" ? m.conflictDates.join(", ") : "";
        const bk = uploads.length > 0 ? ` [${bankLabel(i.bankId)}]` : "";
        line(
          `  - ${formatDateID(i.tanggal)}${bk} | ${o?.nama ?? "?"} | Rp ${formatRupiah(i.nominal)} (${conflictCount}x ke-claim di ${conflictDates})`,
        );
      }
    }
    spacer(4);

    line(`Mutasi tidak di-claim (${pass.summary.unclaimed.length}):`, { bold: true });
    if (pass.summary.unclaimed.length === 0) {
      line("  Tidak ada.", { color: [0.4, 0.4, 0.5] });
    } else {
      for (const tx of pass.summary.unclaimed) {
        const bk = uploads.length > 0 ? ` [${bankLabel(tx.bankId)}]` : "";
        const carry = tx.source === "carryover" ? " (carry-over)" : "";
        line(
          `  - ${tx.tanggal} ${tx.waktu}${bk}${carry} | ${tx.namaPengirim || "?"} | Rp ${formatRupiah(tx.kredit)}`,
        );
      }
    }
    spacer(10);
  }
}
