// Generate PDF for filtered Mutasi list (tab Mutasi @ /history).
// Layout: A4 portrait, header + filter info + summary cards + table of tx.

import { formatRupiah, formatDateID, parseDateISO } from "@/lib/format";
import {
  PdfBuilder,
  asciiSafe,
  truncate,
  downloadPdfBytes,
  hexToRgbColor,
  PAGE_W,
  MARGIN_X,
  TEXT,
  MUTED,
  BORDER,
  HEADER_BG,
  GREEN,
  RED,
  BRAND_GREEN,
  BRAND_DARK,
  type RgbColor,
} from "@/lib/pdf/builder";

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

type MutasiRow = {
  id: string;
  bank_id: string | null;
  no_ref: string | null;
  tanggal: string;
  jam: string | null;
  nominal_kredit: number;
  nominal_debet: number;
  nama_pengirim: string | null;
  nama_penerima: string | null;
  deskripsi: string | null;
  saldo: number | null;
  claimed_by_input_id: string | null;
  manual_claim_reason: string | null;
};

type ClaimedInputInfo = {
  id: string;
  outlet_id: string | null;
  manual_claim_reason: string | null;
};

type FilterState = {
  from: string;
  to: string;
  jenis: "all" | "kredit" | "debet";
  status: "all" | "matched" | "unmatched";
};

function jenisLabel(j: FilterState["jenis"]) {
  if (j === "kredit") return "Kredit (masuk)";
  if (j === "debet") return "Debet (keluar)";
  return "Semua";
}
function statusLabel(s: FilterState["status"]) {
  if (s === "matched") return "Sudah match";
  if (s === "unmatched") return "Belum match";
  return "Semua";
}

export async function generateMutasiPdf(args: {
  brandName: string;
  bank: BankLite | null;
  filter: FilterState;
  rows: MutasiRow[];
  inputsMap: Map<string, ClaimedInputInfo>;
  outlets: OutletLite[];
}): Promise<Uint8Array> {
  const { brandName, bank, filter, rows, inputsMap, outlets } = args;
  const outletMap = new Map(outlets.map((o) => [o.id, o]));

  const b = new PdfBuilder();
  await b.init();

  // ===== HEADER =====
  b.text(asciiSafe(brandName), MARGIN_X, b.y, 16, b.fontBold, BRAND_DARK);
  // Brand accent dot (kecil) di sebelah brand
  const brandW = b.fontBold.widthOfTextAtSize(asciiSafe(brandName), 16);
  b.page.drawCircle({
    x: MARGIN_X + brandW + 6,
    y: b.y + 5,
    size: 2.5,
    color: BRAND_GREEN,
  });
  const dt = `Dibuat ${formatDateID(new Date())} ${new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  b.textRight(asciiSafe(dt), PAGE_W - MARGIN_X, b.y + 4, 9, b.font, MUTED);
  b.y -= 22;

  const bankLabel = bank ? bank.label || bank.kode : "Semua bank";
  b.text(`Mutasi Rekening - ${bankLabel}`, MARGIN_X, b.y, 13, b.fontBold);
  b.y -= 18;

  // Filter info
  const fromD = parseDateISO(filter.from);
  const toD = parseDateISO(filter.to);
  const periode =
    fromD && toD ? `${formatDateID(fromD)} sd ${formatDateID(toD)}` : `${filter.from} - ${filter.to}`;
  const filterLines = [
    `Periode: ${periode}`,
    `Filter: ${jenisLabel(filter.jenis)} | Status: ${statusLabel(filter.status)}`,
  ];
  for (const line of filterLines) {
    b.text(asciiSafe(line), MARGIN_X, b.y, 9, b.font, MUTED);
    b.y -= 12;
  }
  b.y -= 6;
  b.hLine(MARGIN_X, PAGE_W - MARGIN_X, b.y);
  b.y -= 14;

  // ===== SUMMARY =====
  let totalKredit = 0;
  let totalDebet = 0;
  let countKredit = 0;
  let countDebet = 0;
  let matched = 0;
  let unmatched = 0;
  for (const r of rows) {
    if (r.nominal_kredit > 0) {
      totalKredit += r.nominal_kredit;
      countKredit += 1;
    }
    if (r.nominal_debet > 0) {
      totalDebet += r.nominal_debet;
      countDebet += 1;
    }
    if (r.claimed_by_input_id) matched += 1;
    else unmatched += 1;
  }

  b.text("Ringkasan", MARGIN_X, b.y, 11, b.fontBold);
  b.y -= 14;

  const cardW = (PAGE_W - 2 * MARGIN_X - 3 * 8) / 4;
  const cardH = 50;
  const cardY = b.y - cardH;
  const cards: { label: string; value: string; sub: string; color: RgbColor }[] = [
    {
      label: "Total Tx",
      value: String(rows.length),
      sub: `${countKredit} kredit | ${countDebet} debet`,
      color: TEXT,
    },
    {
      label: "Total Kredit",
      value: `Rp ${formatRupiah(totalKredit)}`,
      sub: `${countKredit} transaksi`,
      color: GREEN,
    },
    {
      label: "Total Debet",
      value: `Rp ${formatRupiah(totalDebet)}`,
      sub: `${countDebet} transaksi`,
      color: RED,
    },
    {
      label: "Match Status",
      value: `${matched} / ${rows.length}`,
      sub: `${unmatched} belum match`,
      color: TEXT,
    },
  ];
  for (let i = 0; i < cards.length; i++) {
    const cx = MARGIN_X + i * (cardW + 8);
    b.rectStroke(cx, cardY, cardW, cardH, BORDER);
    b.text(asciiSafe(cards[i].label), cx + 8, cardY + cardH - 14, 8, b.font, MUTED);
    b.text(asciiSafe(cards[i].value), cx + 8, cardY + cardH - 30, 13, b.fontBold, cards[i].color);
    b.text(asciiSafe(cards[i].sub), cx + 8, cardY + 8, 7, b.font, MUTED);
  }
  b.y = cardY - 16;

  // ===== TABLE =====
  b.text(`Daftar Transaksi (${rows.length})`, MARGIN_X, b.y, 11, b.fontBold);
  b.y -= 14;

  // Column layout (sum = 515)
  const COL = {
    tgl: { x: MARGIN_X, w: 60 },
    desc: { x: MARGIN_X + 60, w: 195 },
    kredit: { x: MARGIN_X + 60 + 195, w: 70 },
    debet: { x: MARGIN_X + 60 + 195 + 70, w: 70 },
    outlet: { x: MARGIN_X + 60 + 195 + 70 + 70, w: 120 },
  };
  const ROW_H = 22;
  const HEADER_H = 18;

  function drawTableHeader() {
    b.rect(MARGIN_X, b.y - HEADER_H, PAGE_W - 2 * MARGIN_X, HEADER_H, HEADER_BG);
    const ty = b.y - HEADER_H + 5;
    b.text("Tgl/Jam", COL.tgl.x + 4, ty, 8, b.fontBold, MUTED);
    b.text("Pengirim / Keterangan", COL.desc.x + 4, ty, 8, b.fontBold, MUTED);
    b.textRight("Kredit", COL.kredit.x + COL.kredit.w - 4, ty, 8, b.fontBold, MUTED);
    b.textRight("Debet", COL.debet.x + COL.debet.w - 4, ty, 8, b.fontBold, MUTED);
    b.text("Outlet / Status", COL.outlet.x + 4, ty, 8, b.fontBold, MUTED);
    b.y -= HEADER_H;
  }

  drawTableHeader();

  if (rows.length === 0) {
    b.y -= 20;
    b.text("Tidak ada transaksi sesuai filter.", MARGIN_X + 4, b.y, 9, b.font, MUTED);
  } else {
    for (const r of rows) {
      // Page break check
      if (b.y - ROW_H < 60) {
        b.drawPageNumber();
        b.newPage();
        drawTableHeader();
      }

      const rowTop = b.y;
      const rowBottom = b.y - ROW_H;

      // Highlight background — mimics /history mutasi tab visual:
      // - Auto-matched + outlet → outlet color (20% opacity)
      // - Manual claim (any) → slate-700 (13% opacity)
      if (r.claimed_by_input_id) {
        const ci = inputsMap.get(r.claimed_by_input_id);
        const outlet = ci?.outlet_id ? outletMap.get(ci.outlet_id) : null;
        const isManual = !!ci?.manual_claim_reason || !!r.manual_claim_reason;
        if (isManual) {
          b.rectFill(
            MARGIN_X,
            rowBottom,
            PAGE_W - 2 * MARGIN_X,
            ROW_H,
            hexToRgbColor("#334155"),
            0.13,
          );
        } else if (outlet) {
          b.rectFill(
            MARGIN_X,
            rowBottom,
            PAGE_W - 2 * MARGIN_X,
            ROW_H,
            hexToRgbColor(outlet.warna_hex),
            0.2,
          );
        }
      }

      // Row separator
      b.hLine(MARGIN_X, PAGE_W - MARGIN_X, rowBottom);

      // Tgl/Jam
      const tgl = parseDateISO(r.tanggal);
      const tglStr = tgl ? formatDateID(tgl) : r.tanggal;
      b.text(asciiSafe(tglStr), COL.tgl.x + 4, rowTop - 9, 8, b.font);
      if (r.jam) {
        b.text(asciiSafe(r.jam), COL.tgl.x + 4, rowTop - 18, 7, b.font, MUTED);
      }

      // Desc (line 1: pengirim/penerima, line 2: deskripsi truncated)
      const name = r.nama_pengirim || r.nama_penerima || "-";
      b.text(
        asciiSafe(truncate(b.fontBold, name, 8, COL.desc.w - 8)),
        COL.desc.x + 4,
        rowTop - 9,
        8,
        b.fontBold,
      );
      const sub = r.deskripsi || (r.no_ref ? `Ref: ${r.no_ref}` : "");
      if (sub) {
        b.text(
          asciiSafe(truncate(b.font, sub, 7, COL.desc.w - 8)),
          COL.desc.x + 4,
          rowTop - 18,
          7,
          b.font,
          MUTED,
        );
      }

      // Kredit
      if (r.nominal_kredit > 0) {
        b.textRight(
          formatRupiah(r.nominal_kredit),
          COL.kredit.x + COL.kredit.w - 4,
          rowTop - 9,
          8,
          b.font,
          GREEN,
        );
      }
      // Debet
      if (r.nominal_debet > 0) {
        b.textRight(
          formatRupiah(r.nominal_debet),
          COL.debet.x + COL.debet.w - 4,
          rowTop - 9,
          8,
          b.font,
          RED,
        );
      }

      // Outlet / Status
      if (r.claimed_by_input_id) {
        const ci = inputsMap.get(r.claimed_by_input_id);
        const outlet = ci?.outlet_id ? outletMap.get(ci.outlet_id) : null;
        const isManual = !!ci?.manual_claim_reason || !!r.manual_claim_reason;
        const label = outlet ? outlet.nama : "(no outlet)";
        const suffix = isManual ? " [manual]" : "";
        b.text(
          asciiSafe(truncate(b.font, label + suffix, 8, COL.outlet.w - 8)),
          COL.outlet.x + 4,
          rowTop - 9,
          8,
          b.font,
          GREEN,
        );
      } else {
        b.text("belum match", COL.outlet.x + 4, rowTop - 9, 8, b.font, MUTED);
      }

      b.y = rowBottom;
    }
  }

  b.drawPageNumber();
  return await b.pdf.save();
}

export async function downloadMutasiPdf(args: Parameters<typeof generateMutasiPdf>[0]) {
  const bytes = await generateMutasiPdf(args);
  const bankPart = args.bank ? (args.bank.label || args.bank.kode).replace(/\s+/g, "_") : "all";
  const fname = `mutasi_${bankPart}_${args.filter.from}_sd_${args.filter.to}.pdf`;
  downloadPdfBytes(bytes, fname);
}
