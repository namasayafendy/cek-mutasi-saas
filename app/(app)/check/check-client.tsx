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
import { pushGadaiResults } from "./actions-gadai";
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

// Klaim transfer KELUAR dari Aceh Gadai (id diawali "TFKD-") dicocokkan KETAT:
// tanggal PERSIS (lookback 0) + nominal PERSIS. Beda dari kredit (default H-3).
const GADAI_DEBET_RULES: MatchRules = {
  lookback_days: 0,
  forward_window_days: 0,
  match_mode: "exact",
  tolerance_rp: 0,
  tolerance_pct: 0,
};
function gadaiAwareRules(
  input: UserInput,
  rulesById: Map<string, MatchRulePreset>,
): MatchRules {
  if (String(input.id).startsWith("TFKD-")) return GADAI_DEBET_RULES;
  return ruleToMatchRules(rulesById.get(input.matchRuleId));
}

type CompletedPass = {
  jenis: Jenis;
  inputs: UserInput[];
  summary: MatchSummary;
  matchingPool: PdfTransaction[];
  carryoverByBank: Map<string, PdfTransaction[]>;
  useCarryover: boolean;
  leftoverReRun: boolean;
};

export function CheckClient({
  outlets,
  banks,
  rules: rulesAll,
  initialJenis,
  accountId,
  userId,
  debetHighlightSameColor,
  gadaiSyncEnabled,
}: {
  outlets: Outlet[];
  banks: Bank[];
  rules: MatchRulePreset[];
  initialJenis: Jenis;
  accountId: string;
  userId: string;
  debetHighlightSameColor: boolean;
  gadaiSyncEnabled?: boolean;
}) {
  const router = useRouter();
  const [jenis, setJenis] = useState<Jenis>(initialJenis);
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
  const [kirimBusy, setKirimBusy] = useState(false);
  const [kirimMsg, setKirimMsg] = useState<string | null>(null);
  const [previousPass, setPreviousPass] = useState<CompletedPass | null>(null);
  const [switching, setSwitching] = useState(false);

  const rules = useMemo(
    () => rulesAll.filter((r) => r.jenis === jenis || r.jenis === "both"),
    [rulesAll, jenis],
  );

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

  function txsForJenis(up: BankUpload): PdfTransaction[] {
    return jenis === "kredit"
      ? up.parsedKredit.transactions
      : up.parsedDebet.transactions;
  }

  const activeUpload = useMemo(
    () => uploads.find((u) => u.bank.id === activeBankId) ?? uploads[0] ?? null,
    [uploads, activeBankId],
  );

  const activeUploadParsed = useMemo(() => {
    if (!activeUpload) return null;
    return jenis === "kredit" ? activeUpload.parsedKredit : activeUpload.parsedDebet;
  }, [activeUpload, jenis]);

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
          const txs = jenis === "kredit"
            ? up.parsedKredit.transactions
            : up.parsedDebet.transactions;
          const txDates = txs.map((t) => t.tanggalDate.getTime());
          if (txDates.length === 0) continue;
          const periodStart = new Date(Math.min(...txDates));
          const fromDate = new Date(periodStart);
          fromDate.setUTCDate(fromDate.getUTCDate() - maxLookback * 3);
          const carryTxs = await loadCarryoverPdfTxs(supabase, {
            accountId,
            bankId: up.bank.id,
            jenis,
            fromDate: toDateISO(fromDate),
            beforeDate: toDateISO(periodStart),
          });
          const tagged = carryTxs.map((t) => ({ ...t, bankId: up.bank.id }));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      const txs = jenis === "kredit"
        ? up.parsedKredit.transactions
        : up.parsedDebet.transactions;
      for (const tx of txs) {
        pool.push({ ...tx, source: "current", bankId: up.bank.id });
      }
    }
    if (useCarryover) {
      for (const arr of carryoverByBank.values()) {
        for (const tx of arr) pool.push(tx);
      }
    }
    return pool;
  }, [uploads, useCarryover, carryoverByBank, jenis]);

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
      getRulesForInput: (input) => gadaiAwareRules(input, rulesById),
    });
  }, [inputs, uploads.length, matchingPool, outletColors, rulesById]);

  const matchResult = useMemo(() => {
    if (!leftoverReRun || round1.summary.noCandidate.length === 0) {
      return round1;
    }
    return runMatching(round1.inputs, matchingPool, outletColors, {
      getRulesForInput: (input) => gadaiAwareRules(input, rulesById),
      forceCrossBank: true,
      mode: "leftover-only",
    });
  }, [round1, matchingPool, outletColors, rulesById, leftoverReRun]);

  const matchedInputs = matchResult.inputs;

  // Phase 2-E: kirim hasil match transfer Aceh Gadai (id klaim diawali "TFK-")
  async function handleKirimGadai() {
    setKirimMsg(null);
    setKirimBusy(true);
    try {
      const prefix = jenis === "debet" ? "TFKD-" : "TFK-";
      const gadaiInputs = matchedInputs.filter((i) => String(i.id).startsWith(prefix));
      if (gadaiInputs.length === 0) {
        setKirimMsg("Tidak ada transfer dari Aceh Gadai di daftar ini.");
        return;
      }
      const results = gadaiInputs.map((i) => ({
        id: i.id,
        matched: i.match?.status === "matched",
      }));
      const res = await pushGadaiResults(results, jenis === "debet" ? "debet" : "kredit");
      if (!res.ok) {
        setKirimMsg("❌ " + res.error);
        return;
      }
      setKirimMsg(
        `✅ Terkirim. ${res.updated} cocok, ${res.unmatched} belum ketemu.` +
          (res.alertSent ? " Alert Telegram terkirim." : " (alert gagal terkirim)"),
      );
    } catch (e) {
      setKirimMsg("❌ " + String(e));
    } finally {
      setKirimBusy(false);
    }
  }

  // GABUNGAN (alur Aceh Gadai): kirim hasil + alert, LALU selesai & download
  // (generate PDF + tandai mutasi claimed + simpan). Tombol "Selesai & Download"
  // manual tetap terpisah utk cek tanpa Aceh Gadai.
  async function handleKirimDanSelesai() {
    await handleKirimGadai();
    await handleDownload();
  }
  const summary = matchResult.summary;

  const leftoverEligibleForReRun = useMemo(() => {
    return summary.noCandidate.filter((i) => !!i.bankId);
  }, [summary.noCandidate]);

  const addInputs = useCallback((newInputs: UserInput[]) => {
    setInputs((prev) => [...prev, ...newInputs]);
    setLeftoverReRun(false);
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
    if (!confirm("Reset total - upload mutasi baru? Input dan PDF saat ini akan hilang.")) return;
    setUploads([]);
    setActiveBankId("");
    setInputs([]);
    setDownloadError(null);
    setCarryoverByBank(new Map());
    setUseCarryover(true);
    setLeftoverReRun(false);
    setPreviousPass(null);
    setJenis(initialJenis);
  }, [initialJenis]);

  const matchedTxMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeUpload) return map;
    const activeBankId2 = activeUpload.bank.id;

    function applyPass(passJenis: Jenis, inputsArr: UserInput[]) {
      const passTxs =
        passJenis === "kredit"
          ? activeUpload!.parsedKredit.transactions
          : activeUpload!.parsedDebet.transactions;
      for (const input of inputsArr) {
        const m = input.match;
        if (m && m.status === "matched") {
          if (m.txBankId && m.txBankId !== activeBankId2) continue;
          const tx = passTxs.find(
            (t) =>
              t.no === m.txNo &&
              t.tanggalDate.getTime() === m.txDate.getTime() &&
              t.kredit === input.nominal,
          );
          if (tx) {
            const useDebetSpecial = passJenis === "debet" && !debetHighlightSameColor;
            const color = useDebetSpecial ? "#475569" : m.colorHex;
            map.set(`${tx.page}-${tx.no}`, color);
          }
        }
      }
    }

    if (previousPass) applyPass(previousPass.jenis, previousPass.inputs);
    applyPass(jenis, matchedInputs);

    return map;
  }, [matchedInputs, activeUpload, previousPass, jenis, debetHighlightSameColor]);

  async function saveAllSessionsForPass(
    passJenis: Jenis,
    passInputs: UserInput[],
    passSummary: MatchSummary,
    passPool: PdfTransaction[],
    passCarryover: Map<string, PdfTransaction[]>,
    passUseCarryover: boolean,
    passLeftoverReRun: boolean,
  ) {
    // passSummary is intentionally unused here — we recompute per-bank subSummary.
    void passSummary;
    const supabase = createClient();
    const { saveSession } = await import("@/lib/sessions/save");

    for (const up of uploads) {
      const upTxs = passJenis === "kredit" ? up.parsedKredit.transactions : up.parsedDebet.transactions;
      const inputsForBank = passInputs.filter(
        (i) => i.bankId === up.bank.id || !i.bankId,
      );
      if (inputsForBank.length === 0) continue;
      const carryForBank = (passCarryover.get(up.bank.id) ?? []).length;
      const txDates = upTxs.map((t) => t.tanggalDate.getTime());
      const periodStart = txDates.length > 0 ? new Date(Math.min(...txDates)) : null;
      const periodEnd = txDates.length > 0 ? new Date(Math.max(...txDates)) : null;
      const pdfTotalAmount = upTxs.reduce((s, t) => s + t.kredit, 0);

      const subSummary: MatchSummary = {
        totalInput: inputsForBank.length,
        matched: inputsForBank.filter((i) => i.match?.status === "matched").length,
        noCandidate: inputsForBank.filter((i) => i.match?.status === "no_candidate"),
        allTaken: inputsForBank.filter((i) => i.match?.status === "all_taken"),
        unclaimed: passPool.filter(
          (t) =>
            t.bankId === up.bank.id &&
            t.source === "current" &&
            !inputsForBank.some(
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
          jenis: passJenis,
          inputs: inputsForBank,
          summary: subSummary,
          matchingPool: passPool,
          pdfTotalAmount,
          periodStart,
          periodEnd,
          carryOverUsed: passUseCarryover && carryForBank > 0,
          multiBankUsed: uploads.length > 1 || passLeftoverReRun,
        });
      } catch (e) {
        console.error("Save session failed for bank:", up.bank.kode, e);
      }
    }

    if (passInputs.length > 0) {
      const latestDate = passInputs.reduce(
        (max, i) => (i.tanggal.getTime() > max.getTime() ? i.tanggal : max),
        passInputs[0].tanggal,
      );
      const updateField =
        passJenis === "kredit" ? "last_input_date_kredit" : "last_input_date_debet";
      await supabase
        .from("account_settings")
        .update({
          [updateField]: toDateISO(latestDate),
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", accountId);
    }
  }

  async function handleLanjut() {
    if (uploads.length === 0 || matchedInputs.length === 0 || switching) return;
    setSwitching(true);
    setDownloadError(null);
    try {
      await saveAllSessionsForPass(
        jenis,
        matchedInputs,
        summary,
        matchingPool,
        carryoverByBank,
        useCarryover,
        leftoverReRun,
      );

      setPreviousPass({
        jenis,
        inputs: matchedInputs,
        summary,
        matchingPool,
        carryoverByBank,
        useCarryover,
        leftoverReRun,
      });

      const newJenis: Jenis = jenis === "kredit" ? "debet" : "kredit";
      setJenis(newJenis);
      setInputs([]);
      setLeftoverReRun(false);
      setUseCarryover(true);
    } finally {
      setSwitching(false);
    }
  }

  async function handleDownload() {
    if (uploads.length === 0) return;
    setGenerating(true);
    setDownloadError(null);
    try {
      const { generateMultiBankPdf } = await import("@/lib/pdf/highlight");

      const passes: { jenis: Jenis; inputs: UserInput[]; summary: MatchSummary }[] = [];
      if (previousPass) {
        passes.push({
          jenis: previousPass.jenis,
          inputs: previousPass.inputs,
          summary: previousPass.summary,
        });
      }
      if (matchedInputs.length > 0) {
        passes.push({ jenis, inputs: matchedInputs, summary });
      }

      const bytes = await generateMultiBankPdf({
        uploads: uploads.map((u) => ({
          bank: u.bank,
          fileBuffer: u.parsed.fileBuffer,
          kreditTransactions: u.parsedKredit.transactions,
          debetTransactions: u.parsedDebet.transactions,
        })),
        outlets,
        passes,
        debetHighlightSameColor,
      });

      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = toDateISO(new Date());
      a.href = url;
      const banksTag = uploads.map((u) => u.bank.kode).join("-");
      const jenisTag = passes.length > 1 ? "kredit-debet" : passes[0].jenis;
      a.download = `mutasi-${jenisTag}-${banksTag}-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      if (matchedInputs.length > 0) {
        await saveAllSessionsForPass(
          jenis,
          matchedInputs,
          summary,
          matchingPool,
          carryoverByBank,
          useCarryover,
          leftoverReRun,
        );
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
    (s, u) => s + txsForJenis(u).reduce((s2, t) => s2 + t.kredit, 0),
    0,
  );

  const oppositeJenis: Jenis = jenis === "kredit" ? "debet" : "kredit";
  const canLanjut = matchedInputs.length > 0 && !previousPass;
  const isFinalPass = !!previousPass;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit (Masuk)" : "Debet (Keluar)"}
            <span className="ml-2 text-base font-normal text-slate-500">
              - {uploads.length} bank
            </span>
            {previousPass && (
              <span className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                Pass 2 - lanjutan dari {previousPass.jenis === "kredit" ? "Kredit" : "Debet"}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {uploads.reduce((s, u) => s + txsForJenis(u).length, 0)} transaksi {jenis} dari{" "}
            {uploads.length} bank.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn-secondary text-xs">
            Upload baru
          </button>
        </div>
      </div>

      {previousPass && (
        <div className="card p-3 border-emerald-200 bg-emerald-50 text-sm text-emerald-900">
          <div className="font-medium">
            Pass {previousPass.jenis === "kredit" ? "Kredit" : "Debet"} selesai -{" "}
            {previousPass.summary.matched} match dari {previousPass.summary.totalInput} input.
          </div>
          <div className="text-xs text-emerald-700 mt-0.5">
            Highlight pass-1 sudah ke-save. Sekarang lanjut input{" "}
            {jenis === "kredit" ? "transaksi masuk" : "transaksi keluar"}. Saat klik
            &quot;Selesai &amp; Download&quot;, PDF berisi highlight kredit + debet gabungan.
          </div>
        </div>
      )}

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
                      ({txsForJenis(u).length})
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="px-4 py-2 border-b border-slate-200 bg-slate-50/50 text-xs text-slate-600 flex items-center justify-between">
            <span>
              Mutasi {activeUpload?.bank.label || activeUpload?.bank.kode || "-"} (highlight realtime)
            </span>
            <span>
              Total {jenis} (semua bank): Rp {formatRupiah(totalAllAmount)}
            </span>
          </div>
          {activeUpload && activeUploadParsed && (
            <PdfViewer
              pages={activeUpload.pages}
              matchedTxMap={matchedTxMap}
              parsed={activeUploadParsed}
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
            enableGadaiPull={!!gadaiSyncEnabled}
            gadaiArah={jenis === "debet" ? "debet" : "kredit"}
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
            jenis={jenis}
            oppositeJenis={oppositeJenis}
            canLanjut={canLanjut}
            isFinalPass={isFinalPass}
            onLanjut={handleLanjut}
            switching={switching}
          />
          {gadaiSyncEnabled && (
            <div className="card p-4">
              <button
                type="button"
                onClick={handleKirimDanSelesai}
                disabled={kirimBusy || generating}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {(kirimBusy || generating)
                  ? "Memproses..."
                  : `Kirim ke Aceh Gadai + Alert & Selesai${jenis === "debet" ? " (transfer keluar)" : ""}`}
              </button>
              <p className="mt-1 text-[11px] text-slate-500">
                Sekali klik: kirim hasil + alert ke Aceh Gadai, lalu selesai (PDF + tandai mutasi). Untuk cek manual, pakai &quot;Selesai &amp; Download&quot; di panel kanan.
              </p>
              {kirimMsg && <p className="mt-1 text-[11px] text-slate-600">{kirimMsg}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
