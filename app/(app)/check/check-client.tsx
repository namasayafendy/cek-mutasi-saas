"use client";

import { useState, useMemo, useCallback } from "react";
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
  settings,
}: {
  outlets: Outlet[];
  banks: Bank[];
  jenis: Jenis;
  accountId: string;
  settings: AccountSettings | null;
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedPdf | null>(null);
  const [activeBank, setActiveBank] = useState<Bank | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [inputs, setInputs] = useState<UserInput[]>([]);
  const [generating, setGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const rules = useMemo(() => rulesFromSettings(settings, jenis), [settings, jenis]);

  const outletColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of outlets) m.set(o.id, o.warna_hex);
    return m;
  }, [outlets]);

  const matchResult = useMemo(() => {
    if (!parsed || inputs.length === 0) {
      return {
        inputs: inputs,
        summary: {
          totalInput: 0,
          matched: 0,
          noCandidate: [],
          allTaken: [],
          unclaimed: parsed?.transactions ?? [],
        } as MatchSummary,
      };
    }
    return runMatching(inputs, parsed.transactions, outletColors, rules);
  }, [inputs, parsed, outletColors, rules]);

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
  }, []);

  const matchedTxMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!parsed) return map;
    for (const input of matchedInputs) {
      const m = input.match;
      if (m && m.status === "matched") {
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

      // Update last_input_date in account_settings (jenis-specific)
      if (matchedInputs.length > 0) {
        const latestDate = matchedInputs.reduce(
          (max, i) => (i.tanggal.getTime() > max.getTime() ? i.tanggal : max),
          matchedInputs[0].tanggal,
        );
        const supabase = createClient();
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
