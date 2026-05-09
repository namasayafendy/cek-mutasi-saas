"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  Outlet,
  Bank,
  UserInput,
  MatchSummary,
  PdfTransaction,
  Jenis,
  MatchRulePreset,
} from "@/lib/types";
import { runMatching, type MatchRules, DEFAULT_RULES } from "@/lib/matching";
import { createClient } from "@/lib/supabase/client";
import { toDateISO, formatRupiah } from "@/lib/format";
import { loadCarryoverPdfTxs } from "@/lib/sessions/carryover";
import { History as HistoryIcon, Globe, Loader2 } from "lucide-react";
import { UploadStep, type BankUpload } from "./upload-step";
import { PdfViewer } from "./pdf-viewer";
import { InputPanel } from "./input-panel";
import { SummaryPanel } from "./summary-panel";

function ruleToMatchRules(rule: MatchRulePreset | undefined): MatchRules {
  if (!rule) return DEFAULT_RULES;
  return {
    lookback_days: rule.lookback_days,
    forward_window_days: rule.forward_window_days,
    match_mode: rule.match_mode,
    tolerance_rp: rule.tolerance_rp,
    tolerance_pct: Number(rule.tolerance_pct),
  };
}

export function CheckClient({
  outlets,
  banks,
  rules,
  jenis,
  accountId,
  userId,
}: {
  outlets: Outlet[];
  banks: Bank[];
  rules: MatchRulePreset[];
  jenis: Jenis;
  accountId: string;
  userId: string;
}) {
  const router = useRouter();
  const [uploads, setUploads] = useState<BankUpload[]>([]);
  const [activeBankId, setActiveBankId] = useState<string>("");
  const [inputs, setInputs] = useState<UserInput[]>([]);
  const [generating, setGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [carryoverByBank, setCarryoverByBank] = useState<Map<string, PdfTransaction[]>>(
    new Map(),
  );
  const [useCarryover, setUseCarryover] = useState(true);
  const [carryoverLoading, setCarryoverLoading] = useState(false);
  const [leftoverReRun, setLeftoverReRun] = useState(false);

  const rulesById = useMemo(() => {
    const m = new Map<string, MatchRulePreset>();
    for (const r of rules) m.set(r.id, r);
    return m;
  }, [rules]);

  const outletColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of outlets) m.set(o.id, o.warna_hex);
    return m;
  }, [outlets]);

  const activeUpload = useMemo(
    () => uploads.find((u) => u.bank.id === activeBankId) ?? uploads[0] ?? null,
    [uploads, activeBankId],
  );

  // Load carry-over per bank — pakai max lookback dari rules yang ada
  useEffect(() => {
    if (uploads.length === 0) {
      setCarryoverByBank(new Map());
      return;
    }
    let cancelled = false;
    const maxLookback = Math.max(...rules.map((r) => r.lookback_days), 30);

    async function load() {
      setCarryoverLoading(true);
      try {
        const supabase = createClient();
        const result = new Map<string, PdfTransaction[]>();
        for (const up of uploads) {
          const txDates = up.parsed.transactions.map((t) => t.tanggalDate.getTime());
          if (txDates.length === 0) continue;
          const periodStart = new Date(Math.min(...txDates));
          const fromDate = new Date(periodStart);
          fromDate.setUTCDate(fromDate.getUTCDate() - maxLookback * 3);
          const txs = await loadCarryoverPdfTxs(supabase, {
            accountId,
            bankId: up.bank.id,
            jenis,
            fromDate: toDateISO(fromDate),
            beforeDate: toDateISO(periodStart),
          });
          const tagged = txs.map((t) => ({ ...t, bankId: up.bank.id }));
          result.set(up.bank.id, tagged);
        }
        if (!cancelled) setCarryoverByBank(result);
      } finally {
        if (!cancelled) setCarryoverLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [uploads, accountId, jenis, rules]);

  const totalCarryoverCount = useMemo(() => {
    let n = 0;
    for (const arr of carryoverByBank.values()) n += arr.length;
    return n;
  }, [carryoverByBank]);

  const totalCarryoverNominal = useMemo(() => {
    let n = 0;
    for (const arr of carryoverByBank.values()) {
      for (const tx of arr) n += tx.kredit;
    }
    return n;
  }, [carryoverByBank]);

  const matchingPool: PdfTransaction[] = useMemo(() => {
    const pool: PdfTransaction[] = [];
    for (const up of uploads) {
      for (const tx of up.parsed.transactions) {
        pool.push({ ...tx, source: "current", bankId: up.bank.id });
      }
    }
    if (useCarryover) {
      for (const arr of carryoverByBank.values()) {
        for (const tx of arr) pool.push(tx);
      }
    }
    return pool;
  }, [uploads, useCarryover, carryoverByBank]);

  // Round 1: matching dengan per-input rules + bank filter (atau "semua bank" kalau dipilih)
  const round1 = useMemo(() => {
    if (uploads.length === 0 || inputs.length === 0) {
      return {
        inputs,
        summary: {
          totalInput: 0,
          matched: 0,
          noCandidate: [],
          allTaken: [],
          unclaimed: matchingPool,
        } as MatchSummary,
      };
    }
    return runMatching(inputs, matchingPool, outletColors, {
      getRulesForInput: (input) => ruleToMatchRules(rulesById.get(input.matchRuleId)),
    });
  }, [inputs, uploads.length, matchingPool, outletColors, rulesById]);

  // Round 2 (opsional): leftover re-run dengan crossBank
  const matchResult = useMemo(() => {
    if (!leftoverReRun || round1.summary.noCandidate.length === 0) {
      return round1;
    }
    return runMatching(round1.inputs, matchingPool, outletColors, {
      getRulesForInput: (input) => ruleToMatchRules(rulesById.get(input.matchRuleId)),
      forceCrossBank: true,
      mode: "leftover-only",
    });
  }, [round1, matchingPool, outletColors, rulesById, leftoverReRun]);

  const matchedInputs = matchResult.inputs;
  const summary = matchResult.summary;

  // Leftover yang originalnya pakai bank specific (bukan "Semua bank")
  // — kandidat untuk re-run cross-bank
  const leftoverEligibleForReRun = useMemo(() => {
    return summary.noCandidate.filter((i) => !!i.bankId);
  }, [summary.noCandidate]);

  const addInputs = useCallback((newInputs: UserInput[]) => {
    setInputs((prev) => [...prev, ...newInputs]);
    setLeftoverReRun(false); // reset re-run state saat ada input baru
  }, []);

  const removeInput = useCallback((id: string) => {
    setInputs((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    if (!confirm("Hapus semua input dan reset?")) return;
    setInputs([]);
    setLeftoverReRun(false);
  }, []);

  const reset = useCallback(() => {
    if (!confirm("Reset total — upload mutasi baru? Input dan PDF saat ini akan hilang.")) return;
    setUploads([]);
    setActiveBankId("");
    setInputs([]);
    setDownloadError(null);
    setCarryoverByBank(new Map());
    setUseCarryover(true);
    setLeftoverReRun(false);
  }, []);

  const matchedTxMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeUpload) return map;
    const activeBankId2 = activeUpload.bank.id;
    for (const input of matchedInputs) {
      const m = input.match;
      if (m && m.status === "matched") {
        if (m.txBankId && m.txBankId !== activeBankId2) continue;
        const tx = activeUpload.parsed.transactions.find(
          (t) =>
            t.no === m.txNo &&
            t.tanggalDate.getTime() === m.txDate.getTime() &&
            t.kredit === input.nominal,
        );
        if (tx) {
          map.set(`${tx.page}-${tx.no}`, m.colorHex);
        }
      }
    }
    return map;
  }, [matchedInputs, activeUpload]);

  async function handleDownload() {
    if (uploads.length === 0) return;
    setGenerating(true);
    setDownloadError(null);
    try {
      const { generateMultiBankPdf } = await import("@/lib/pdf/highlight");
      const bytes = await generateMultiBankPdf({
        uploads: uploads.map((u) => ({
          bank: u.bank,
          fileBuffer: u.parsed.fileBuffer,
          transactions: u.parsed.transactions,
        })),
        inputs: matchedInputs,
        summary,
        outlets,
        jenis,
      });
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = toDateISO(new Date());
      a.href = url;
      const banksTag = uploads.map((u) => u.bank.kode).join("-");
      a.download = `mutasi-${jenis}-${banksTag}-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (matchedInputs.length > 0) {
        const supabase = createClient();
        const { saveSession } = await import("@/lib/sessions/save");

        for (const up of uploads) {
          const inputsForBank = matchedInputs.filter(
            (i) => i.bankId === up.bank.id || !i.bankId,
            // input "Semua bank" (bankId="") dimasukkan ke session bank pertama (atau kita treat sebagai cross — saya simpan di bank yang match-nya)
          );
          if (inputsForBank.length === 0) continue;
          const carryForBank = (carryoverByBank.get(up.bank.id) ?? []).length;
          const txDates = up.parsed.transactions.map((t) => t.tanggalDate.getTime());
          const periodStart = txDates.length > 0 ? new Date(Math.min(...txDates)) : null;
          const periodEnd = txDates.length > 0 ? new Date(Math.max(...txDates)) : null;
          const pdfTotalAmount = up.parsed.transactions.reduce((s, t) => s + t.kredit, 0);

          const subSummary: MatchSummary = {
            totalInput: inputsForBank.length,
            matched: inputsForBank.filter((i) => i.match?.status === "matched").length,
            noCandidate: inputsForBank.filter((i) => i.match?.status === "no_candidate"),
            allTaken: inputsForBank.filter((i) => i.match?.status === "all_taken"),
            unclaimed: matchingPool.filter(
              (t) =>
                t.bankId === up.bank.id &&
                t.source === "current" &&
                !matchedInputs.some(
                  (i) =>
                    i.match?.status === "matched" &&
                    (i.match.txBankId ?? i.bankId) === up.bank.id &&
                    i.match.txNo === t.no &&
                    i.match.txDate.getTime() === t.tanggalDate.getTime(),
                ),
            ),
          };

          try {
            await saveSession(supabase, {
              accountId,
              userId,
              bankId: up.bank.id,
              jenis,
              inputs: inputsForBank,
              summary: subSummary,
              matchingPool,
              pdfTotalAmount,
              periodStart,
              periodEnd,
              carryOverUsed: useCarryover && carryForBank > 0,
              multiBankUsed: uploads.length > 1 || leftoverReRun,
            });
          } catch (e) {
            console.error("Save session failed for bank:", up.bank.kode, e);
          }
        }

        if (matchedInputs.length > 0) {
          const latestDate = matchedInputs.reduce(
            (max, i) => (i.tanggal.getTime() > max.getTime() ? i.tanggal : max),
            matchedInputs[0].tanggal,
          );
          const updateField =
            jenis === "kredit" ? "last_input_date_kredit" : "last_input_date_debet";
          await supabase
            .from("account_settings")
            .update({
              [updateField]: toDateISO(latestDate),
              updated_at: new Date().toISOString(),
            })
            .eq("account_id", accountId);
        }
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setDownloadError(err instanceof Error ? err.message : "Gagal generate PDF");
    } finally {
      setGenerating(false);
    }
  }

  if (uploads.length === 0) {
    return (
      <UploadStep
        banks={banks}
        jenis={jenis}
        accountId={accountId}
        onAllReady={(ups) => {
          setUploads(ups);
          setActiveBankId(ups[0]?.bank.id ?? "");
        }}
      />
    );
  }

  const totalAllAmount = uploads.reduce(
    (s, u) => s + u.parsed.transactions.reduce((s2, t) => s2 + t.kredit, 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"}
            <span className="ml-2 text-base font-normal text-slate-500">
              — {uploads.length} bank
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {uploads.reduce((s, u) => s + u.parsed.transactions.length, 0)} transaksi {jenis} dari{" "}
            {uploads.length} bank.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-secondary text-xs">
            Upload baru
          </button>
        </div>
      </div>

      {(carryoverLoading || totalCarryoverCount > 0) && (
        <div className="card p-3 border-blue-200 bg-blue-50">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useCarryover}
              onChange={(e) => setUseCarryover(e.target.checked)}
              className="mt-1"
              disabled={carryoverLoading}
            />
            <div className="text-sm text-blue-900 flex-1">
              <div className="font-medium flex items-center gap-1.5">
                <HistoryIcon className="h-3.5 w-3.5" />
                {carryoverLoading
                  ? "Mencari transaksi belum ter-claim dari history..."
                  : `Sertakan ${totalCarryoverCount} transaksi belum ter-claim dari upload sebelumnya`}
              </div>
              {!carryoverLoading && totalCarryoverCount > 0 && (
                <div className="text-xs text-blue-700 mt-0.5">
                  Total Rp {formatRupiah(totalCarryoverNominal)} dari {carryoverByBank.size} bank.
                </div>
              )}
            </div>
          </label>
        </div>
      )}

      {/* Phase 9.1: Leftover re-run banner */}
      {!leftoverReRun && leftoverEligibleForReRun.length > 0 && (
        <div className="card p-3 border-purple-200 bg-purple-50">
          <div className="flex items-start gap-2">
            <Globe className="h-4 w-4 text-purple-700 mt-0.5 flex-shrink-0" />
            <div className="text-sm flex-1">
              <div className="font-medium text-purple-900">
                {leftoverEligibleForReRun.length} input belum ketemu di bank yang dipilih
              </div>
              <div className="text-xs text-purple-700 mt-0.5">
                Mungkin Anda salah pilih bank saat input. Coba cari di semua bank?
              </div>
            </div>
            <button
              onClick={() => setLeftoverReRun(true)}
              className="btn-primary text-xs px-3 py-1.5"
            >
              <Globe className="h-3 w-3" /> Cari di Semua Bank
            </button>
          </div>
        </div>
      )}

      {leftoverReRun && (
        <div className="card p-3 border-purple-200 bg-purple-50">
          <div className="flex items-start gap-2">
            <Globe className="h-4 w-4 text-purple-700 mt-0.5 flex-shrink-0" />
            <div className="text-sm flex-1">
              <div className="font-medium text-purple-900">
                Mode cross-bank aktif untuk leftover
              </div>
              <div className="text-xs text-purple-700 mt-0.5">
                Input yang sebelumnya tidak ketemu sekarang dicari ke semua bank.
              </div>
            </div>
            <button
              onClick={() => setLeftoverReRun(false)}
              className="text-xs text-purple-700 hover:underline"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          {uploads.length > 1 && (
            <div className="border-b border-slate-200 bg-slate-50 flex items-center gap-1 overflow-x-auto px-2">
              {uploads.map((u) => {
                const isActive = u.bank.id === (activeUpload?.bank.id ?? "");
                return (
                  <button
                    key={u.bank.id}
                    onClick={() => setActiveBankId(u.bank.id)}
                    className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px whitespace-nowrap ${
                      isActive
                        ? "border-slate-900 text-slate-900"
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {u.bank.label || u.bank.kode}
                    <span className="ml-1.5 text-[10px] text-slate-400">
                      ({u.parsed.transactions.length})
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="px-4 py-2 border-b border-slate-200 bg-slate-50/50 text-xs text-slate-600 flex items-center justify-between">
            <span>
              Mutasi {activeUpload?.bank.label || activeUpload?.bank.kode || "—"} (highlight realtime)
            </span>
            <span>
              Total {jenis} (semua bank): Rp {formatRupiah(totalAllAmount)}
            </span>
          </div>
          {activeUpload && (
            <PdfViewer
              pages={activeUpload.pages}
              matchedTxMap={matchedTxMap}
              parsed={activeUpload.parsed}
            />
          )}
        </div>

        <div className="space-y-4">
          <InputPanel
            outlets={outlets}
            banks={uploads.map((u) => u.bank)}
            rules={rules}
            defaultBankId={activeUpload?.bank.id ?? ""}
            onAdd={addInputs}
          />
          <SummaryPanel
            summary={summary}
            inputs={matchedInputs}
            outlets={outlets}
            banks={uploads.map((u) => u.bank)}
            rules={rules}
            multiBank={uploads.length > 1}
            onRemove={removeInput}
            onClearAll={clearAll}
            onDownload={handleDownload}
            generating={generating}
            downloadError={downloadError}
          />
        </div>
      </div>
    </div>
  );
}
