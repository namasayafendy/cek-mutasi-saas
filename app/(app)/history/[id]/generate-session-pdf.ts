// Generate PDF for one session (history detail page).
// Layout: A4 portrait. Sections: header + summary + claimed inputs +
// leftover inputs + matched mutasi list.

import { formatRupiah, formatDateID, parseDateISO } from "@/lib/format";
import {
  PdfBuilder,
  asciiSafe,
  truncate,
  downloadPdfBytes,
  PAGE_W,
  MARGIN_X,
  TEXT,
  MUTED,
  BORDER,
  HEADER_BG,
  GREEN,
  RED,
  AMBER,
  BLUE,
  BRAND_GREEN,
  BRAND_DARK,
} from "@/lib/pdf/builder";

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

export type SessionInfo = {
  id: string;
  jenis: "kredit" | "debet";
  period_mutasi_start: string | null;
  period_mutasi_end: string | null;
  created_at: string;
  carry_over_used: boolean | null;
  multi_bank_used: boolean | null;
};

export type InputRow = {
  id: string;
  tanggal_input: string;
  outlet_id: string | null;
  bank_id: string | null;
  nominal: number;
  jenis: "kredit" | "debet";
  match_status: "matched" | "no_candidate" | "all_taken" | "manual_claimed" | null;
  matched_tx_id: string | null;
  conflict_count: number | null;
  conflict_dates: string[] | null;
  manual_claim_reason: string | null;
  claim_category: string | null;
};

export type MatchedTxRow = {
  id: string;
  bank_id: string | null;
  tanggal: string;
  jam: string | null;
  nominal_kredit: number;
  nominal_debet: number;
  nama_pengirim: string | null;
  nama_penerima: string | null;
  deskripsi: string | null;
  claimed_by_input_id: string | null;
  manual_claim_reason: string | null;
};

function inputStatusLabel(s: InputRow["match_status"]): {
  text: string;
  color: ReturnType<typeof TEXT>;
} {
  if (s === "matched") return { text: "Match", color: GREEN };
  if (s === "manual_claimed") return { text: "Manual claim", color: BLUE };
  if (s === "no_candidate") return { text: "Tidak ada di mutasi", color: RED };
  if (s === "all_taken") return { text: "Bentrok", color: AMBER };
  return { text: "-", color: MUTED };
}

function categoryLabel(c: string | null): string {
  if (!c || c === "customer") return "";
  if (c === "bunga") return "Bunga bank";
  if (c === "admin") return "Admin/biaya";
  if (c === "lain") return "Lain-lain";
  return c;
}

export async function generateSessionPdf(args: {
  brandName: string;
  session: SessionInfo;
  inputs: InputRow[];
  matchedTxs: MatchedTxRow[];
  outlets: OutletLite[];
  banks: BankLite[];
}): Promise<Uint8Array> {
  const { brandName, session, inputs, matchedTxs, outlets, banks } = args;
  const outletMap = new Map(outlets.map((o) => [o.id, o]));
  const bankMap = new Map(banks.map((b) => [b.id, b]));

  const b = new PdfBuilder();
  await b.init();

  // ===== HEADER =====
  b.text(asciiSafe(brandName), MARGIN_X, b.y, 16, b.fontBold, BRAND_DARK);
  const brandW = b.fontBold.widthOfTextAtSize(asciiSafe(brandName), 16);
  b.page.drawCircle({ x: MARGIN_X + brandW + 6, y: b.y + 5, size: 2.5, color: BRAND_GREEN });
  const dt = `Dibuat ${formatDateID(new Date())} ${new Date().toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  b.textRight(asciiSafe(dt), PAGE_W - MARGIN_X, b.y + 4, 9, b.font, MUTED);
  b.y -= 22;

  const titleText = `Cek Mutasi ${session.jenis === "kredit" ? "Kredit" : "Debet"}`;
  b.text(titleText, MARGIN_X, b.y, 13, b.fontBold);
  b.y -= 18;

  // Session info
  const created = new Date(session.created_at);
  const createdStr =
    formatDateID(created) +
    " " +
    created.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const periodStart = session.period_mutasi_start ? parseDateISO(session.period_mutasi_start) : null;
  const periodEnd = session.period_mutasi_end ? parseDateISO(session.period_mutasi_end) : null;
  const periode =
    periodStart && periodEnd ? `${formatDateID(periodStart)} sd ${formatDateID(periodEnd)}` : "-";
  const flags: string[] = [];
  if (session.carry_over_used) flags.push("carry-over");
  if (session.multi_bank_used) flags.push("multi-bank");
  const flagsStr = flags.length > 0 ? flags.join(", ") : "tidak";

  for (const line of [
    `Sesi dibuat: ${createdStr}`,
    `Periode mutasi: ${periode}`,
    `Opsi: ${flagsStr}`,
  ]) {
    b.text(asciiSafe(line), MARGIN_X, b.y, 9, b.font, MUTED);
    b.y -= 12;
  }
  b.y -= 6;
  b.hLine(MARGIN_X, PAGE_W - MARGIN_X, b.y);
  b.y -= 14;

  // ===== SUMMARY =====
  const matchedInputs = inputs.filter(
    (i) => i.match_status === "matched" || i.match_status === "manual_claimed",
  );
  const leftover = inputs.filter((i) => i.match_status === "no_candidate");
  const conflict = inputs.filter((i) => i.match_status === "all_taken");
  const totalNominal = inputs.reduce((s, i) => s + i.nominal, 0);
  const matchedNominal = matchedInputs.reduce((s, i) => s + i.nominal, 0);

  b.text("Ringkasan", MARGIN_X, b.y, 11, b.fontBold);
  b.y -= 14;

  const cardW = (PAGE_W - 2 * MARGIN_X - 3 * 8) / 4;
  const cardH = 50;
  const cardY = b.y - cardH;
  const cards: { label: string; value: string; sub: string; color: ReturnType<typeof TEXT> }[] = [
    {
      label: "Total Input",
      value: String(inputs.length),
      sub: `Rp ${formatRupiah(totalNominal)}`,
      color: TEXT,
    },
    {
      label: "Match",
      value: String(matchedInputs.length),
      sub: `Rp ${formatRupiah(matchedNominal)}`,
      color: GREEN,
    },
    {
      label: "Belum Match",
      value: String(leftover.length),
      sub: leftover.length > 0 ? "perlu tindak lanjut" : "semua ketemu",
      color: leftover.length > 0 ? RED : MUTED,
    },
    {
      label: "Bentrok",
      value: String(conflict.length),
      sub: conflict.length > 0 ? "duplikat tanggal" : "tidak ada",
      color: conflict.length > 0 ? AMBER : MUTED,
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

  // ===== SECTION 1: ALL INPUTS =====
  drawSection(b, `Detail Input (${inputs.length})`);
  drawInputsTable(b, inputs, outletMap, bankMap);

  // ===== SECTION 2: LEFTOVER (only if any) =====
  if (leftover.length > 0) {
    b.y -= 10;
    drawSection(b, `Belum Match - Perlu Tindak Lanjut (${leftover.length})`);
    drawInputsTable(b, leftover, outletMap, bankMap, /*compact*/ true);
  }

  // ===== SECTION 3: MATCHED MUTASI =====
  if (matchedTxs.length > 0) {
    b.y -= 10;
    drawSection(b, `Transaksi Mutasi yang Ke-claim (${matchedTxs.length})`);
    drawMatchedTxTable(b, matchedTxs, bankMap);
  }

  b.drawPageNumber();
  return await b.pdf.save();
}

function drawSection(b: PdfBuilder, title: string) {
  b.ensure(28);
  b.text(asciiSafe(title), MARGIN_X, b.y, 11, b.fontBold);
  b.y -= 14;
}

function drawInputsTable(
  b: PdfBuilder,
  rows: InputRow[],
  outletMap: Map<string, OutletLite>,
  bankMap: Map<string, BankLite>,
  compact = false,
) {
  const COL = {
    tgl: { x: MARGIN_X, w: 70 },
    outlet: { x: MARGIN_X + 70, w: 110 },
    bank: { x: MARGIN_X + 70 + 110, w: 70 },
    nominal: { x: MARGIN_X + 70 + 110 + 70, w: 90 },
    status: { x: MARGIN_X + 70 + 110 + 70 + 90, w: 175 },
  };
  const HEADER_H = 16;
  const ROW_H = compact ? 18 : 20;

  function drawHeader() {
    b.rect(MARGIN_X, b.y - HEADER_H, PAGE_W - 2 * MARGIN_X, HEADER_H, HEADER_BG);
    const ty = b.y - HEADER_H + 4;
    b.text("Tgl Input", COL.tgl.x + 4, ty, 8, b.fontBold, MUTED);
    b.text("Outlet", COL.outlet.x + 4, ty, 8, b.fontBold, MUTED);
    b.text("Bank", COL.bank.x + 4, ty, 8, b.fontBold, MUTED);
    b.textRight("Nominal", COL.nominal.x + COL.nominal.w - 4, ty, 8, b.fontBold, MUTED);
    b.text("Status / Catatan", COL.status.x + 4, ty, 8, b.fontBold, MUTED);
    b.y -= HEADER_H;
  }

  drawHeader();

  if (rows.length === 0) {
    b.y -= 14;
    b.text("(kosong)", MARGIN_X + 4, b.y, 8, b.font, MUTED);
    b.y -= 6;
    return;
  }

  for (const i of rows) {
    if (b.y - ROW_H < 60) {
      b.drawPageNumber();
      b.newPage();
      drawHeader();
    }
    const rowTop = b.y;
    const rowBottom = b.y - ROW_H;
    b.hLine(MARGIN_X, PAGE_W - MARGIN_X, rowBottom);

    const tgl = parseDateISO(i.tanggal_input);
    b.text(tgl ? formatDateID(tgl) : i.tanggal_input, COL.tgl.x + 4, rowTop - 11, 8, b.font);

    const outlet = i.outlet_id ? outletMap.get(i.outlet_id) : null;
    if (outlet) {
      b.text(
        asciiSafe(truncate(b.font, outlet.nama, 8, COL.outlet.w - 8)),
        COL.outlet.x + 4,
        rowTop - 11,
        8,
        b.font,
      );
    } else {
      b.text("-", COL.outlet.x + 4, rowTop - 11, 8, b.font, MUTED);
    }

    const bank = i.bank_id ? bankMap.get(i.bank_id) : null;
    b.text(
      asciiSafe(truncate(b.font, bank ? bank.label || bank.kode : "-", 8, COL.bank.w - 8)),
      COL.bank.x + 4,
      rowTop - 11,
      8,
      b.font,
      bank ? TEXT : MUTED,
    );

    b.textRight(
      `Rp ${formatRupiah(i.nominal)}`,
      COL.nominal.x + COL.nominal.w - 4,
      rowTop - 11,
      8,
      b.font,
    );

    const st = inputStatusLabel(i.match_status);
    let statusText = st.text;
    const cat = categoryLabel(i.claim_category);
    if (cat) statusText += ` [${cat}]`;
    if (i.match_status === "all_taken" && i.conflict_dates && i.conflict_dates.length > 0) {
      statusText += ` (tgl: ${i.conflict_dates.slice(0, 3).join(",")}${
        i.conflict_dates.length > 3 ? "..." : ""
      })`;
    }
    b.text(
      asciiSafe(truncate(b.font, statusText, 8, COL.status.w - 8)),
      COL.status.x + 4,
      rowTop - 11,
      8,
      b.font,
      st.color,
    );

    if (i.manual_claim_reason && !compact) {
      // tambahkan baris alasan kalau ada (tidak menambah ROW_H, tapi nempel di bawah status — skip kalau ROW_H kurang)
      // Kalau ROW_H = 20 dan font 7, masih cukup
      if (ROW_H >= 20) {
        b.text(
          asciiSafe(truncate(b.font, `"${i.manual_claim_reason}"`, 7, COL.status.w - 8)),
          COL.status.x + 4,
          rowTop - 19,
          7,
          b.font,
          MUTED,
        );
      }
    }

    b.y = rowBottom;
  }
}

function drawMatchedTxTable(
  b: PdfBuilder,
  rows: MatchedTxRow[],
  bankMap: Map<string, BankLite>,
) {
  const COL = {
    tgl: { x: MARGIN_X, w: 70 },
    bank: { x: MARGIN_X + 70, w: 70 },
    desc: { x: MARGIN_X + 70 + 70, w: 195 },
    kredit: { x: MARGIN_X + 70 + 70 + 195, w: 90 },
    debet: { x: MARGIN_X + 70 + 70 + 195 + 90, w: 90 },
  };
  const HEADER_H = 16;
  const ROW_H = 22;

  function drawHeader() {
    b.rect(MARGIN_X, b.y - HEADER_H, PAGE_W - 2 * MARGIN_X, HEADER_H, HEADER_BG);
    const ty = b.y - HEADER_H + 4;
    b.text("Tgl/Jam", COL.tgl.x + 4, ty, 8, b.fontBold, MUTED);
    b.text("Bank", COL.bank.x + 4, ty, 8, b.fontBold, MUTED);
    b.text("Pengirim / Keterangan", COL.desc.x + 4, ty, 8, b.fontBold, MUTED);
    b.textRight("Kredit", COL.kredit.x + COL.kredit.w - 4, ty, 8, b.fontBold, MUTED);
    b.textRight("Debet", COL.debet.x + COL.debet.w - 4, ty, 8, b.fontBold, MUTED);
    b.y -= HEADER_H;
  }

  drawHeader();

  for (const r of rows) {
    if (b.y - ROW_H < 60) {
      b.drawPageNumber();
      b.newPage();
      drawHeader();
    }
    const rowTop = b.y;
    const rowBottom = b.y - ROW_H;
    b.hLine(MARGIN_X, PAGE_W - MARGIN_X, rowBottom);

    const tgl = parseDateISO(r.tanggal);
    b.text(tgl ? formatDateID(tgl) : r.tanggal, COL.tgl.x + 4, rowTop - 9, 8, b.font);
    if (r.jam) {
      b.text(r.jam, COL.tgl.x + 4, rowTop - 18, 7, b.font, MUTED);
    }

    const bank = r.bank_id ? bankMap.get(r.bank_id) : null;
    b.text(
      asciiSafe(truncate(b.font, bank ? bank.label || bank.kode : "-", 8, COL.bank.w - 8)),
      COL.bank.x + 4,
      rowTop - 9,
      8,
      b.font,
      bank ? TEXT : MUTED,
    );

    const name = r.nama_pengirim || r.nama_penerima || "-";
    b.text(
      asciiSafe(truncate(b.fontBold, name, 8, COL.desc.w - 8)),
      COL.desc.x + 4,
      rowTop - 9,
      8,
      b.fontBold,
    );
    if (r.deskripsi) {
      b.text(
        asciiSafe(truncate(b.font, r.deskripsi, 7, COL.desc.w - 8)),
        COL.desc.x + 4,
        rowTop - 18,
        7,
        b.font,
        MUTED,
      );
    }

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
    if (r.manual_claim_reason) {
      b.text(
        asciiSafe(truncate(b.font, `[manual] "${r.manual_claim_reason}"`, 7, COL.desc.w - 8)),
        COL.desc.x + 4,
        rowTop - 18,
        7,
        b.font,
        BLUE,
      );
    }

    b.y = rowBottom;
  }
}

export async function downloadSessionPdf(args: Parameters<typeof generateSessionPdf>[0]) {
  const bytes = await generateSessionPdf(args);
  const dt = new Date(args.session.created_at);
  const datePart = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
  const idPart = args.session.id.slice(0, 8);
  const fname = `sesi_${args.session.jenis}_${datePart}_${idPart}.pdf`;
  downloadPdfBytes(bytes, fname);
}
