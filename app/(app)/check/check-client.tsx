"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Outlet, UserInput, MatchSummary, PdfTransaction } from "@/lib/types";
import type { ParsedPdf } from "@/lib/pdf/parser";
import type { RenderedPage } from "@/lib/pdf/renderer";
import { runMatching } from "@/lib/matching";
import { createClient } from "@/lib/supabase/client";
import { toDateISO, formatRupiah } from "@/lib/format";
import { UploadStep } from "./upload-step";
import { PdfViewer } from "./pdf-viewer";
import { InputPanel } from "./input-panel";
import { SummaryPanel } from "./summary-panel";

export function CheckClient({ outlets }: { outlets: Outlet[] }) {
  const router = useRouter();
  const [parsed, setParsed] = useState<ParsedPdf | null>(null);
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [inputs, setInputs] = useState<UserInput[]>([]);
  const [generating, setGenerating] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const outletColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of outlets) m.set(o.id, o.warna_hex);
    return m;
  }, [outlets]);

  // Run matching whenever inputs change
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
    return runMatching(inputs, parsed.transactions, outletColors);
  }, [inputs, parsed, outletColors]);

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
    if (!confirm("Reset total — upload PDF baru? Input dan PDF saat ini akan hilang.")) return;
    setParsed(null);
    setPages([]);
    setInputs([]);
    setDownloadError(null);
  }, []);

  // Build map of matched tx → highlight color (for overlay in viewer)
  const matchedTxMap = useMemo(() => {
    const map = new Map<string, string>(); // key: `${page}-${no}` -> colorHex
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
      // Trigger download
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = toDateISO(new Date());
      a.href = url;
      a.download = `mutasi-cek-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Update last_input_date in supabase (latest input tanggal)
      if (matchedInputs.length > 0) {
        const latestDate = matchedInputs.reduce((max, i) =>
          i.tanggal.getTime() > max.getTime() ? i.tanggal : max,
        matchedInputs[0].tanggal);
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("user_settings").upsert({
            user_id: user.id,
            last_input_date: toDateISO(latestDate),
            updated_at: new Date().toISOString(),
          });
          router.refresh();
        }
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
        onParsed={(p, rendered) => {
          setParsed(p);
          setPages(rendered);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cek Mutasi</h1>
          <p className="mt-1 text-sm text-slate-600">
            {parsed.transactions.length} transaksi kredit ter-parse dari{" "}
            {parsed.pages.length} halaman PDF.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-secondary text-xs">
            Upload PDF baru
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="card overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center justify-between">
            <span>PDF Mutasi (highlight realtime)</span>
            <span>
              Total kredit: Rp{" "}
              {formatRupiah(parsed.transactions.reduce((s: number, t: PdfTransaction) => s + t.kredit, 0))}
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
