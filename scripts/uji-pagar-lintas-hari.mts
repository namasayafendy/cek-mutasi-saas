// Meraka-ulang insiden SJB-1-0186 (13 Agustus 2026) di pencocok yang asli.
//
// Klaim kembar bertanggal 10 Agu Rp 460.000 diproses di sesi TERPISAH. Baris
// 10 Agu sudah dipegang klaim pertama, jadi klaim kedua dulu menebak ke baris
// 11 Agu dan mengambil uang milik kontrak lain.
//   npx tsx scripts/uji-pagar-lintas-hari.mts
import { runMatching } from "../lib/matching.ts";
import type { PdfTransaction, UserInput } from "../lib/types.ts";

const tx = (iso: string, jam: string, kredit: number, no: number, sudahDiklaim = false): PdfTransaction => ({
  no, tanggal: iso.split("-").reverse().join("/"),
  tanggalDate: new Date(`${iso}T12:00:00Z`), waktu: jam,
  namaPengirim: "", deskripsi: "", kredit,
  bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
  page: 1, noRef: null, bankId: "bank-1", parsedTxId: `tx-${no}`,
  claimedByOther: sudahDiklaim,
} as any);

const input = (iso: string, nominal: number, id: string): UserInput => ({
  id, tanggal: new Date(`${iso}T12:00:00Z`), nominal, jenis: "kredit",
  outletId: null, outletNama: "LHOKSEUMAWE", bankId: "bank-1",
  refFt: null, noFaktur: "SJB-1-0186",
} as any);

// Aturan produksi mengizinkan lompat maju 1 hari (transfer malam dibukukan bank
// besoknya). DEFAULT_RULES melarangnya (forward_window_days: 0), jadi uji ini
// WAJIB menyuplai aturan yang sebenarnya — kalau tidak, ia menguji dunia yang
// tidak pernah ada dan setiap kasus lompat-maju akan lulus karena tak pernah dicoba.
const ATURAN = {
  lookback_days: 3, forward_window_days: 1,
  match_mode: "exact" as const, tolerance_rp: 0, tolerance_pct: 0,
};

const jalan = (nama: string, inputs: UserInput[], txs: PdfTransaction[]) => {
  const { inputs: hasil } = runMatching(inputs, txs, new Map(), { getRulesForInput: () => ATURAN });
  console.log(`\n${nama}`);
  for (const h of hasil) {
    const m = h.match as any;
    const ket = m?.status === "matched"
      ? `✅ COCOK ke baris tgl ${m.txDate.toISOString().slice(0, 10)} (lewat ${m.matchedBy})`
      : `🛑 ${m?.status ?? "-"}${m?.conflictDates ? " · tgl kandidat: " + m.conflictDates.join(", ") : ""}`;
    console.log(`   ${(h as any).id.padEnd(24)} ${ket}`);
  }
};

// ── Kejadian asli: baris hari sendiri SUDAH diambil klaim kembar di sesi lain ──
jalan(
  "1. INSIDEN: klaim kembar, baris 10 Agu sudah dipegang orang lain",
  [input("2026-08-10", 460_000, "TFK-KEMBAR")],
  [tx("2026-08-10", "16.02", 460_000, 1, true),   // sudah diklaim sesi lalu
   tx("2026-08-11", "17.39", 460_000, 2, false)], // milik kontrak LAIN
);

// ── Yang SAH tidak boleh ikut tertolak ──
jalan(
  "2. SAH: transfer malam, hari sendiri TIDAK punya baris apa pun",
  [input("2026-08-10", 300_000, "TFK-MALAM")],
  [tx("2026-08-11", "09.10", 300_000, 3, false)],
);

jalan(
  "3. SAH: hari sendiri ADA dan masih bebas",
  [input("2026-08-10", 250_000, "TFK-NORMAL")],
  [tx("2026-08-10", "11.00", 250_000, 4, false),
   tx("2026-08-11", "11.00", 250_000, 5, false)],
);
