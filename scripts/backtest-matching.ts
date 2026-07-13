// Backtest matcher Fase B (3-pass REF → NAMA+JAM → NOMINAL) vs perilaku lama
// (NOMINAL saja) menggunakan klaim gadai riil + kredit mutasi riil dari DB.
//
// Pakai: npx tsx scripts/backtest-matching.ts <path-klaim.json>
//   klaim.json = array [{f,n,d,j,r,m,s}] (no_faktur, nominal, tgl_transfer,
//   jam, ref_transfer, nama_nasabah, status-lama). Data TIDAK di-commit
//   (berisi nama nasabah) — simpan di luar repo.
//
// Asumsi pool "fresh": semua kredit dianggap belum ter-claim, untuk kedua
// matcher — perbandingan apel-ke-apel murni logika matching.
// READ-ONLY: tidak menulis apa pun ke DB.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { runMatching } from "../lib/matching";
import type { PdfTransaction, UserInput } from "../lib/types";

type Klaim = {
  f: string; n: number; d: string; j: string | null;
  r: string | null; m: string; s: string;
};

function loadEnv(): { url: string; key: string } {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const mm = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (mm) env[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ada di .env.local");
  return { url, key };
}

function extractFtToken(ref: string | null): string | null {
  const mm = String(ref ?? "").toUpperCase().match(/FT\d{5}[A-Z0-9]{4,}/);
  return mm ? mm[0] : null;
}

function isoToDate(iso: string): Date {
  const mm = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!mm) throw new Error("tanggal tak valid: " + iso);
  return new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3], 12));
}

async function main() {
  const klaimPath = process.argv[2];
  if (!klaimPath) throw new Error("Pakai: npx tsx scripts/backtest-matching.ts <path-klaim.json>");
  const klaim: Klaim[] = JSON.parse(readFileSync(klaimPath, "utf8"));

  const { url, key } = loadEnv();
  const db = createClient(url, key);

  // Pool kredit: exact-mode hanya melihat kredit bernominal sama ATAU ber-ref sama —
  // cukup fetch subset itu (ekuivalen dgn pool penuh utk matcher exact).
  const nominals = [...new Set(klaim.map((k) => k.n))];
  const refs = [...new Set(klaim.map((k) => extractFtToken(k.r)).filter(Boolean))] as string[];

  const { data: byNom, error: e1 } = await db
    .from("parsed_transactions")
    .select("id, bank_id, no_ref, tanggal, jam, nominal_kredit, nama_pengirim")
    .is("deleted_at", null)
    .gt("nominal_kredit", 0)
    .in("nominal_kredit", nominals)
    .gte("tanggal", "2026-05-20")
    .lte("tanggal", "2026-07-13");
  if (e1) throw e1;

  const orExpr = refs.map((r) => `no_ref.ilike.${r}*`).join(",");
  const { data: byRef, error: e2 } = refs.length
    ? await db
        .from("parsed_transactions")
        .select("id, bank_id, no_ref, tanggal, jam, nominal_kredit, nama_pengirim")
        .is("deleted_at", null)
        .gt("nominal_kredit", 0)
        .or(orExpr)
    : { data: [], error: null };
  if (e2) throw e2;

  const seen = new Set<string>();
  const rows = [...(byNom ?? []), ...(byRef ?? [])].filter((r: any) => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }) as any[];

  const pool: PdfTransaction[] = rows.map((r, i) => {
    const mm = String(r.tanggal).match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
    return {
      no: i + 1,
      page: 1,
      tanggal: `${mm[3]}-${mm[2]}-${mm[1]}`,
      tanggalDate: isoToDate(r.tanggal),
      waktu: r.jam ?? "",
      namaPengirim: r.nama_pengirim ?? "",
      deskripsi: "",
      kredit: Number(r.nominal_kredit),
      bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 },
      parsedTxId: r.id,
      source: "current" as const,
      bankId: r.bank_id,
      noRef: r.no_ref,
    };
  });

  function buildInputs(withNewFields: boolean): UserInput[] {
    return klaim.map((k, i) => ({
      id: `TFK-BT-${i}`,
      tanggal: isoToDate(k.d),
      outletId: "",
      bankId: "", // cross-bank (1 rekening di data ini)
      matchRuleId: "",
      nominal: k.n,
      ...(withNewFields
        ? {
            refFt: extractFtToken(k.r),
            jamResi: k.j,
            // nama_pengirim historis belum ada (baru dibaca AI ke depan) — Pass 2
            // di-backtest terpisah dgn unit test sintetis di bawah.
            namaPengirimResi: null,
          }
        : {}),
    }));
  }

  const colors = new Map<string, string>();
  const RULES_OLD = { lookback_days: 3, forward_window_days: 0, match_mode: "exact" as const, tolerance_rp: 0, tolerance_pct: 0 };
  const RULES_NEW = { ...RULES_OLD, forward_window_days: 1 };

  const oldRun = runMatching(buildInputs(false), pool, colors, { getRulesForInput: () => RULES_OLD });
  const newRun = runMatching(buildInputs(true), pool, colors, { getRulesForInput: () => RULES_NEW });

  const poolByKey = new Map(pool.map((t) => [`${t.bankId}-${t.page}-${t.no}`, t]));
  function describe(inp: UserInput): string {
    const m = inp.match;
    if (!m) return "-";
    if (m.status === "matched") {
      const tx = poolByKey.get(`${m.txBankId}-1-${m.txNo}`);
      return `matched[${(m as any).matchedBy ?? "?"}] -> ${tx?.tanggal} ${tx?.waktu} ${tx?.namaPengirim} ref=${tx?.noRef ?? "-"}`;
    }
    if (m.status === "all_taken") return `BENTROK(${m.conflictCount}x ${m.conflictDates.join(",")})${m.refIssue ? " " + m.refIssue : ""}`;
    return `TIDAK-KETEMU${m.refIssue ? " " + m.refIssue : ""}`;
  }

  console.log(`\n=== BACKTEST MATCHER (${klaim.length} klaim, pool ${pool.length} kredit) ===`);
  const count = (run: typeof oldRun, st: string) => run.inputs.filter((i) => i.match?.status === st).length;
  console.log(`LAMA : matched=${count(oldRun, "matched")} bentrok=${count(oldRun, "all_taken")} tak-ketemu=${count(oldRun, "no_candidate")}`);
  console.log(`BARU : matched=${count(newRun, "matched")} bentrok=${count(newRun, "all_taken")} tak-ketemu=${count(newRun, "no_candidate")}`);
  const byRefN = newRun.inputs.filter((i) => i.match?.status === "matched" && (i.match as any).matchedBy === "REF").length;
  console.log(`BARU via REF: ${byRefN}; refIssue: ${newRun.inputs.filter((i) => i.match?.refIssue).length}`);

  console.log(`\n--- Perbedaan per klaim (LAMA vs BARU) ---`);
  let diffs = 0;
  klaim.forEach((k, i) => {
    const o = describe(oldRun.inputs[i]);
    const n = describe(newRun.inputs[i]);
    if (o !== n) {
      diffs++;
      console.log(`* ${k.f} Rp${k.n.toLocaleString("id-ID")} tgl ${k.d}${extractFtToken(k.r) ? " ref " + extractFtToken(k.r) : ""}`);
      console.log(`    LAMA: ${o}`);
      console.log(`    BARU: ${n}`);
    }
  });
  console.log(`Total beda: ${diffs} dari ${klaim.length}`);

  // ── Unit test sintetis Pass 2 (NAMA+JAM) — data historis belum punya nama resi ──
  console.log(`\n--- Unit test Pass 2 (nama+jam) ---`);
  const synthPool: PdfTransaction[] = [
    { no: 1, page: 1, tanggal: "01-07-2026", tanggalDate: isoToDate("2026-07-01"), waktu: "13.20", namaPengirim: "MUHAMMAD YUSUF ARIEL", deskripsi: "", kredit: 50000, bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 }, bankId: "b1", noRef: null },
    { no: 2, page: 1, tanggal: "10-07-2026", tanggalDate: isoToDate("2026-07-10"), waktu: "16.05", namaPengirim: "DADING YUDHISTIRA", deskripsi: "", kredit: 50000, bbox: { yBottom: 0, height: 0, xLeft: 0, width: 0 }, bankId: "b1", noRef: null },
  ];
  const synthIn = (over: Partial<UserInput>): UserInput => ({
    id: "TFK-S", tanggal: isoToDate("2026-07-12"), outletId: "", bankId: "", matchRuleId: "", nominal: 50000, ...over,
  });
  const t1 = runMatching([synthIn({ namaPengirimResi: "M YUSUF ARIEL", jamResi: "13:20" })], synthPool, colors).inputs[0].match!;
  const t2 = runMatching([synthIn({ namaPengirimResi: "M****D Y***F", jamResi: "13:20" })], synthPool, colors).inputs[0].match!;
  const t3 = runMatching([synthIn({ namaPengirimResi: "M YUSUF ARIEL", jamResi: "14:30" })], synthPool, colors).inputs[0].match!;
  const ok1 = t1.status === "matched" && (t1 as any).matchedBy === "NAMA_JAM" && t1.status === "matched" && t1.txNo === 1;
  // nama tersensor -> pass 2 skip -> pass 3 (jendela 3 hari) ambil kredit 10-07 (tebakan lama)
  const ok2 = t2.status === "matched" && (t2 as any).matchedBy === "NOMINAL" && t2.txNo === 2;
  // jam meleset >5 mnt -> pass 2 skip -> pass 3
  const ok3 = t3.status === "matched" && (t3 as any).matchedBy === "NOMINAL" && t3.txNo === 2;
  console.log(`1) nama+jam cocok tembus jendela 14 hari (harus NAMA_JAM ke kredit 01-07): ${ok1 ? "OK" : "GAGAL " + JSON.stringify(t1)}`);
  console.log(`2) nama tersensor -> turun mulus ke nominal-jendela: ${ok2 ? "OK" : "GAGAL " + JSON.stringify(t2)}`);
  console.log(`3) jam meleset >5 menit -> turun mulus ke nominal-jendela: ${ok3 ? "OK" : "GAGAL " + JSON.stringify(t3)}`);
  if (!ok1 || !ok2 || !ok3) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
