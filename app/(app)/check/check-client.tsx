"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import type {
  Outlet,
  Bank,
  UserInput,
  MatchSummary,
  PdfTransaction,
  AccountSettings,
  Jenis,
} from "@/lib/types";
import type { ParsedPdf } from "@/lib/pdf/parser";
import type { RenderedPage } from "@/lib/pdf/renderer";
import { runMatching, type MatchRules, DEFAULT_RULES } from "@/lib/matching";
import { createClient } from "@/lib/supabase/client";
import { toDateISO, formatRupiah } from "@/lib/format";
import { loadCarryoverPdfTxs } from "@/lib/sessions/carryover";
import { History as HistoryIcon } from "lucide-react";
import { UploadStep } from "./upload-step";
import { PdfViewer } from "./pdf-viewer";
import { InputPanel } from "./input-panel";
import { SummaryPanel } from "./summary-panel";

function rulesFromSettings(settings: AccountSettings | null, jenis: Jenis): MatchRules {
  if (!settings) return DEFAULT_RULES;
  if (jenis === "kredit") {
    return {
      lookback_days: settings.lookback_days_kredit,
      forward_window_days: settings.forward_window_days_kredit,
      match_mode: settings.match_mode_kredit,
      tolerance_rp: settings.match_tolerance_rp_kredit,
      tolerance_pct: settings.match_tolerance_pct_kredit,
    };
  }
  return {
    lookback_days: settings.lookback_days_debet,
    forward_window_days: settings.forward_window_days_debet,
    match_mode: settings.match_mode_debet,
    tolerance_rp: settings.match_tolerance_rp_debet,
    tolerance_pct: settings.match_tolerance_pct_debet,
  };
}

export function CheckClient({
  outlets,
  banks,
  jenis,
  accountId,
  userId,
  settings,
}: {
  outlets: Outlet[];
  banks: Bank[];
  jenis: Jenis;
  accountId: string;
  userId: string;
  settings: AccountSettings | null;
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedPdf | null>(null);
  const [activeBank, setActiveBank] = useState<Bank | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [inputs, setInputs] = useState<UserInput[]>([]);
  const [generating, setGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [carryoverTxs, setCarryoverTxs] = useState<PdfTransaction[]>([]);
  const [useCarryover, setUseCarryover] = useState(true);
  const [carryoverLoading, setCarryoverLoading] = useState(false);

  const rules = useMemo(() => rulesFromSettings(settings, jenis), [settings, jenis]);

  const outletColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of outlets) m.set(o.id, o.warna_hex);
    return m;
  }, [outlets]);

  // Phase 4.3: load carry-over txs setelah parsing PDF
  useEffect(() => {
    if (!parsed || !activeBank) {
      setCarryoverTxs([]);
      return;
    }
    let cancelled = false;
    async function load() {
      setCarryoverLoading(true);
      try {
        // Hitung period start dari current PDF transactions
        const txDates = parsed!.transactions.map((t) => t.tanggalDate.getTime());
        if (txDates.length === 0) {
          setCarryoverTxs([]);
          return;
        }
        const periodStart = new Date(Math.min(...txDates));
        // Carryover range: lookback_days sebelum periodStart, sampai 1 hari sebelum periodStart
        const fromDate = new Date(periodStart);
        // Lookback agak panjang biar carry-over banyak ke-cover (90 hari atau lookback*3)
        const lookbackForCarryover = Math.max(rules.lookback_days * 3, 30);
        fromDate.setUTCDate(fromDate.getUTCDate() - lookbackForCarryover);
        const beforeDate = new Date(periodStart);

        const supabase = createClient();
        const txs = await loadCarryoverPdfTxs(supabase, {
          accountId,
          bankId: activeBank!.id,
          jenis,
          fromDate: toDateISO(fromDate),
          beforeDate: toDateISO(beforeDate),
        });
        if (!cancelled) setCarryoverTxs(txs);
      } finally {
        if (!cancelled) setCarryoverLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [parsed, activeBank, accountId, jenis, rules.lookback_days]);

  const matchingPool: PdfTransaction[] = useMemo(() => {
    if (!parsed) return [];
    const current = parsed.transactions.map((t) => ({ ...t, source: "current" as const }));
    if (useCarryover && carryoverTxs.length > 0) {
      return [...current, ...carryoverTxs];
    }
    return current;
  }, [parsed, useCarryover, carryoverTxs]);

  const matchResult = useMemo(() => {
    if (!parsed || inputs.length === 0) {
      return {
        inputs: inputs,
        summary: {
          totalInput: 0,
          matched: 0,
          noCandidate: [],
          allTaken: [],
          unclaimed: matchingPool,
        } as MatchSummary,
      };
    }
    return runMatching(inputs, matchingPool, outletColors, rules);
  }, [inputs, parsed, matchingPool, outletColors, rules]);

  const matchedInputs = matchResult.inputs;
  const summary = matchResult.summary;

  const addInputs = useCallback((newInputs: UserInput[]) => {
    setInputs((prev) => [...prev, ...newInputs]);
  }, []);

  const removeInput = useCallback((id: string) => {
    setInputs((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    if (!confirm("Hapus semua input dan reset?")) return;
    setInputs([]);
  }, []);

  const reset = useCallback(() => {
    if (!confirm("Reset total — upload mutasi baru? Input dan PDF saat ini akan hilang.")) return;
    setParsed(null);
    setActiveBank(null);
    setPages([]);
    setInputs([]);
    setDownloadError(null);
    setCarryoverTxs([]);
    setUseCarryover(true);
  }, []);

  const matchedTxMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!parsed) return map;
    for (const input of matchedInputs) {
      const m = input.match;
      if (m && m.status === "matched") {
        // Phase 4.3: cari di parsed.transactions saja (current PDF), skip carry-over
        // (carry-over txs page-nya 0 dan tidak ada di PDF saat ini, jadi tidak bisa di-highlight)
        const tx = parsed.transactions.find(
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
  }, [matchedInputs, parsed]);

  async function handleDownload() {
    if (!parsed) return;
    setGenerating(true);
    setDownloadError(null);
    try {
      const { generateHighlightedPdf } = await import("@/lib/pdf/highlight");
      const bytes = await generateHighlightedPdf({
        fileBuffer: parsed.fileBuffer,
        transactions: parsed.transactions,
        inputs: matchedInputs,
        summary,
        outlets,
      });
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = toDateISO(new Date());
      a.href = url;
      a.download = `mutasi-${jenis}-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Save session ke history
      if (parsed && activeBank && matchedInputs.length > 0) {
        const supabase = createClient();
        const { saveSession } = await import("@/lib/sessions/save");

        // Hitung period mutasi (first/last tanggal di transactions)
        const txDates = parsed.transactions.map((t) => t.tanggalDate.getTime());
        const periodStart = txDates.length > 0 ? new Date(Math.min(...txDates)) : null;
        const periodEnd = txDates.length > 0 ? new Date(Math.max(...txDates)) : null;
        const pdfTotalAmount = parsed.transactions.reduce(
          (s, t) => s + t.kredit,
          0,
        );

        try {
          await saveSession(supabase, {
            accountId,
            userId,
            bankId: activeBank.id,
            jenis,
            inputs: matchedInputs,
            summary,
            matchingPool,
            pdfTotalAmount,
            periodStart,
            periodEnd,
            carryOverUsed: useCarryover && carryoverTxs.length > 0,
          });
        } catch (e) {
          console.error("Save session failed:", e);
          // Non-blocking — download still proceeds
        }

        // Update last_input_date in account_settings (jenis-specific)
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
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      setDownloadError(err instanceof Error ? err.message : "Gagal generate PDF");
    } finally {
      setGenerating(false);
    }
  }

  if (!parsed) {
    return (
      <UploadStep
        banks={banks}
        jenis={jenis}
        accountId={accountId}
        onParsed={(p, rendered, bank) => {
          setParsed(p);
          setPages(rendered);
          setActiveBank(bank);
        }}
      />
    );
  }

  const totalAmount = parsed.transactions.reduce(
    (s: number, t: PdfTransaction) => s + t.kredit,
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"}
            {activeBank && (
              <span className="ml-2 text-base font-normal text-slate-500">
                — {activeBank.label || activeBank.kode}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {parsed.transactions.length} transaksi {jenis} ter-parse dari {parsed.pages.length}{" "}
            halaman.
            <span className="ml-2 text-xs text-slate-500">
              Aturan: lookback {rules.lookback_days}h, forward {rules.forward_window_days}h,{" "}
              {rules.match_mode}
              {rules.match_mode === "tol_rp" ? ` ±Rp${formatRupiah(rules.tolerance_rp)}` : ""}
              {rules.match_mode === "tol_pct" ? ` ±${rules.tolerance_pct}%` : ""}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-secondary text-xs">
            Upload baru
          </button>
        </div>
      </div>

      {/* Phase 4.3: Carry-over banner */}
      {(carryoverLoading || carryoverTxs.length > 0) && (
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
                  ? "Mencari transaksi belum ter-claim dari history…"
                  : `Sertakan ${carryoverTxs.length} transaksi belum ter-claim dari upload sebelumnya`}
              </div>
              {!carryoverLoading && carryoverTxs.length > 0 && (
                <div className="text-xs text-blue-700 mt-0.5">
                  Total Rp {formatRupiah(carryoverTxs.reduce((s, t) => s + t.kredit, 0))}.
                  Berguna kalau Anda upload mutasi terbaru tapi mau cocokkan input lama yang
                  belum ke-match. Default ON.
                </div>
              )}
            </div>
          </label>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center justify-between">
            <span>Mutasi (highlight realtime)</span>
            <span>
              Total {jenis}: Rp {formatRupiah(totalAmount)}
            </span>
          </div>
          <PdfViewer pages={pages} matchedTxMap={matchedTxMap} parsed={parsed} />
        </div>

        <div className="space-y-4">
          <InputPanel outlets={outlets} onAdd={addInputs} />
          <SummaryPanel
            summary={summary}
            inputs={matchedInputs}
            outlets={outlets}
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
