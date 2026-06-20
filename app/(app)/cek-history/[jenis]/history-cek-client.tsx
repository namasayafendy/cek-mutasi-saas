"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import {
  Globe,
  Loader2,
  History as HistoryIcon,
  Search,
  ArrowLeft,
  Download,
  CheckCircle2,
} from "lucide-react";
import { InputPanel } from "../../check/input-panel";
import { SummaryPanel } from "../../check/summary-panel";
import { pushGadaiResults } from "../../check/actions-gadai";

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

// Klaim transfer KELUAR Aceh Gadai (id "TFKD-") dicocokkan KETAT: tanggal PERSIS
// (lookback 0) + nominal PERSIS. Beda dari kredit (default H-3).
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

type FilterState = {
  from: string;
  to: string;
  bankIds: string[]; // empty = semua bank aktif
};

function defaultFilter(): FilterState {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return {
    from: toDateISO(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))),
    to: toDateISO(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))),
    bankIds: [],
  };
}

export default function HistoryCekClient({
  outlets,
  banks,
  rules: rulesAll,
  jenis,
  accountId,
  userId,
  debetHighlightSameColor,
  gadaiSyncEnabled,
}: {
  outlets: Outlet[];
  banks: Bank[];
  rules: MatchRulePreset[];
  jenis: Jenis;
  accountId: string;
  userId: string;
  debetHighlightSameColor: boolean;
  gadaiSyncEnabled?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterState>(defaultFilter);
  const [pool, setPool] = useState<PdfTransaction[]>([]);
  const [poolLoaded, setPoolLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<UserInput[]>([]);
  const [leftoverReRun, setLeftoverReRun] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [savedSessionInfo, setSavedSessionInfo] = useState<{ matched: number; total: number } | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [kirimBusy, setKirimBusy] = useState(false);
  const [kirimMsg, setKirimMsg] = useState<string | null>(null);

  // Filter rules by jenis (sama seperti di /check)
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

  // Banks dropdown source — kalau filter.bankIds kosong, pakai semua active banks
  const filteredBanks = useMemo(() => {
    if (filter.bankIds.length === 0) return banks;
    return banks.filter((b) => filter.bankIds.includes(b.id));
  }, [banks, filter.bankIds]);

  async function loadPool() {
    setLoading(true);
    setLoadError(null);
    setSaveSuccess(false);
    setSavedSessionInfo(null);
    try {
      const supabase = createClient();
      const bankList = filter.bankIds.length > 0 ? filter.bankIds : banks.map((b) => b.id);
      const allTx: PdfTransaction[] = [];
      // Query per-bank supaya bisa tag bankId di hasil
      for (const bid of bankList) {
        let q = supabase
          .from("parsed_transactions")
          .select(
            "id, bank_id, no_ref, tanggal, jam, nominal_kredit, nominal_debet, nama_pengirim, nama_penerima, deskripsi, saldo, page, bbox_y_bottom, bbox_height",
          )
          .eq("account_id", accountId)
          .eq("bank_id", bid)
          .is("claimed_by_input_id", null)
          .is("deleted_at", null)
          .gte("tanggal", filter.from)
          .lte("tanggal", filter.to);
        if (jenis === "kredit") q = q.gt("nominal_kredit", 0);
        else q = q.gt("nominal_debet", 0);
        const { data, error } = await q.order("tanggal", { ascending: true }).limit(5000);
        if (error) throw new Error(error.message);
        let i = 0;
        for (const r of data ?? []) {
          const amount = jenis === "kredit" ? r.nominal_kredit : r.nominal_debet;
          if (!amount || amount <= 0) continue;
          const m = r.tanggal.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (!m) continue;
          const tgl = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12));
          allTx.push({
            no: -(allTx.length + 1), // sentinel negative (mirip carryover)
            page: 0,
            tanggal: `${m[3]}-${m[2]}-${m[1]}`,
            tanggalDate: tgl,
            waktu: r.jam ?? "",
            namaPengirim: r.nama_pengirim ?? r.nama_penerima ?? "",
            deskripsi: r.deskripsi ?? "",
            kredit: amount,
            bbox: {
              yBottom: r.bbox_y_bottom ?? 0,
              height: r.bbox_height ?? 0,
              xLeft: 0,
              width: 0,
            },
            parsedTxId: r.id,
            source: "carryover", // treat as carryover — no PDF page highlight
            bankId: bid,
          });
          i++;
        }
        void i;
      }
      setPool(allTx);
      setPoolLoaded(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Gagal memuat data history");
      setPool([]);
      setPoolLoaded(false);
    } finally {
      setLoading(false);
    }
  }

  const round1 = useMemo(() => {
    if (!poolLoaded || inputs.length === 0) {
      return {
        inputs,
        summary: {
          totalInput: 0,
          matched: 0,
          noCandidate: [],
          allTaken: [],
          unclaimed: pool,
        } as MatchSummary,
      };
    }
    return runMatching(inputs, pool, outletColors, {
      getRulesForInput: (input) => gadaiAwareRules(input, rulesById),
    });
  }, [inputs, poolLoaded, pool, outletColors, rulesById]);

  const matchResult = useMemo(() => {
    if (!leftoverReRun || round1.summary.noCandidate.length === 0) return round1;
    return runMatching(round1.inputs, pool, outletColors, {
      getRulesForInput: (input) => gadaiAwareRules(input, rulesById),
      forceCrossBank: true,
      mode: "leftover-only",
    });
  }, [round1, pool, outletColors, rulesById, leftoverReRun]);

  const matchedInputs = matchResult.inputs;
  const summary = matchResult.summary;

  // Kirim hasil cocok klaim Aceh Gadai (kredit "TFK-" / debet "TFKD-") + alert.
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

  // GABUNGAN (alur Aceh Gadai): kirim hasil + alert ke Aceh Gadai, LALU
  // selesai & tandai mutasi (claimed) + simpan. Tombol "Selesai & Download"
  // manual tetap terpisah utk cek tanpa Aceh Gadai.
  async function handleKirimDanSelesai() {
    await handleKirimGadai();
    await handleSave();
  }

  const leftoverEligibleForReRun = useMemo(
    () => summary.noCandidate.filter((i) => !!i.bankId),
    [summary.noCandidate],
  );

  const addInputs = useCallback((newInputs: UserInput[]) => {
    setInputs((prev) => [...prev, ...newInputs]);
    setLeftoverReRun(false);
  }, []);

  const removeInput = useCallback((id: string) => {
    setInputs((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    if (!confirm("Hapus semua input?")) return;
    setInputs([]);
    setLeftoverReRun(false);
  }, []);

  async function handleSave() {
    if (matchedInputs.length === 0 || saving) return;
    setSaving(true);
    setDownloadError(null);
    try {
      const supabase = createClient();
      const { saveSession } = await import("@/lib/sessions/save");

      // Group inputs by bank yang ke-match (atau bank-input kalau "semua bank")
      const inputsByBank = new Map<string, UserInput[]>();
      for (const i of matchedInputs) {
        const bid =
          (i.match?.status === "matched" && i.match.txBankId) || i.bankId || (filter.bankIds[0] ?? banks[0]?.id ?? "");
        if (!bid) continue;
        const arr = inputsByBank.get(bid) ?? [];
        arr.push(i);
        inputsByBank.set(bid, arr);
      }

      // Period mutasi = range filter
      const m1 = filter.from.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const m2 = filter.to.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const periodStart =
        m1 ? new Date(Date.UTC(parseInt(m1[1]), parseInt(m1[2]) - 1, parseInt(m1[3]), 12)) : null;
      const periodEnd =
        m2 ? new Date(Date.UTC(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]), 12)) : null;

      for (const [bid, bankInputs] of inputsByBank) {
        const subSummary: MatchSummary = {
          totalInput: bankInputs.length,
          matched: bankInputs.filter((i) => i.match?.status === "matched").length,
          noCandidate: bankInputs.filter((i) => i.match?.status === "no_candidate"),
          allTaken: bankInputs.filter((i) => i.match?.status === "all_taken"),
          unclaimed: [],
        };
        try {
          await saveSession(supabase, {
            accountId,
            userId,
            bankId: bid,
            jenis,
            inputs: bankInputs,
            summary: subSummary,
            matchingPool: pool,
            pdfTotalAmount: 0,
            periodStart,
            periodEnd,
            carryOverUsed: false,
            multiBankUsed: inputsByBank.size > 1 || leftoverReRun,
            fromHistory: true,
          });
        } catch (e) {
          console.error("Save session failed for bank:", bid, e);
        }
      }

      // Update last_input_date_*
      const latestDate = matchedInputs.reduce(
        (max, i) => (i.tanggal.getTime() > max.getTime() ? i.tanggal : max),
        matchedInputs[0].tanggal,
      );
      const updateField = jenis === "kredit" ? "last_input_date_kredit" : "last_input_date_debet";
      await supabase
        .from("account_settings")
        .update({
          [updateField]: toDateISO(latestDate),
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", accountId);

      setSaveSuccess(true);
      setSavedSessionInfo({ matched: summary.matched, total: summary.totalInput });
      router.refresh();
    } catch (err) {
      console.error(err);
      setDownloadError(err instanceof Error ? err.message : "Gagal menyimpan session");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownloadRekap() {
    if (matchedInputs.length === 0) return;
    setDownloadingPdf(true);
    setDownloadError(null);
    try {
      const { generateMultiBankPdf } = await import("@/lib/pdf/highlight");
      const bytes = await generateMultiBankPdf({
        uploads: [],
        outlets,
        passes: [{ jenis, inputs: matchedInputs, summary }],
        debetHighlightSameColor,
      });
      const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = toDateISO(new Date());
      a.href = url;
      a.download = `cek-history-${jenis}-${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      setDownloadError(err instanceof Error ? err.message : "Gagal generate rekap PDF");
    } finally {
      setDownloadingPdf(false);
    }
  }

  const totalPoolNominal = pool.reduce((s, t) => s + t.kredit, 0);

  if (saveSuccess && savedSessionInfo) {
    return (
      <div className="space-y-4">
        <div className="card p-6 border-emerald-200 bg-emerald-50 text-center">
          <CheckCircle2 className="h-12 w-12 mx-auto text-emerald-600" />
          <h2 className="mt-3 text-xl font-semibold text-emerald-900">
            Berhasil disimpan
          </h2>
          <p className="mt-1 text-sm text-emerald-700">
            {savedSessionInfo.matched} dari {savedSessionInfo.total} input ter-match dan
            sudah ke-claim di history Mutasi. Highlight di /history Mutasi tab akan
            terupdate.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={handleDownloadRekap}
              disabled={downloadingPdf}
              className="btn-secondary text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              {downloadingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Download Rekap PDF (opsional)
            </button>
            <Link href="/history" className="btn-primary text-sm">
              Lihat Mutasi History
            </Link>
            <button
              type="button"
              onClick={() => {
                setSaveSuccess(false);
                setSavedSessionInfo(null);
                setInputs([]);
                setPool([]);
                setPoolLoaded(false);
                setLeftoverReRun(false);
              }}
              className="text-sm text-emerald-700 hover:underline"
            >
              Cek lagi dari history
            </button>
          </div>
          {downloadError && (
            <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {downloadError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/history"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali ke History
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">
          Cek Mutasi {jenis === "kredit" ? "Kredit (Masuk)" : "Debet (Keluar)"} dari History
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Match input customer ke transaksi mutasi yang sudah pernah di-upload tapi belum
          ke-claim. Tidak perlu upload PDF baru.
        </p>
      </div>

      {/* Filter */}
      <div className="card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <HistoryIcon className="h-4 w-4" /> Filter pool history
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs text-slate-500">Dari tanggal</label>
            <input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter((p) => ({ ...p, from: e.target.value }))}
              className="input mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Sampai tanggal</label>
            <input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter((p) => ({ ...p, to: e.target.value }))}
              className="input mt-1"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Bank (kosongkan = semua)</label>
            <select
              multiple
              value={filter.bankIds}
              onChange={(e) =>
                setFilter((p) => ({
                  ...p,
                  bankIds: Array.from(e.target.selectedOptions, (o) => o.value),
                }))
              }
              className="input mt-1 h-20 text-xs"
            >
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label || b.kode}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadPool}
            disabled={loading}
            className="btn-primary text-sm inline-flex items-center gap-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Muat Data History
          </button>
          {poolLoaded && (
            <span className="text-xs text-slate-600">
              {pool.length} transaksi unclaimed ditemukan
              {pool.length > 0 && (
                <span className="text-slate-400 ml-1">
                  (Rp {formatRupiah(totalPoolNominal)})
                </span>
              )}
            </span>
          )}
        </div>
        {loadError && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {loadError}
          </div>
        )}
      </div>

      {/* Cross-bank toggle */}
      {!leftoverReRun && leftoverEligibleForReRun.length > 0 && (
        <div className="card p-3 border-purple-200 bg-purple-50">
          <div className="flex items-start gap-2">
            <Globe className="h-4 w-4 text-purple-700 mt-0.5 flex-shrink-0" />
            <div className="text-sm flex-1">
              <div className="font-medium text-purple-900">
                {leftoverEligibleForReRun.length} input belum ketemu di bank yang dipilih
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

      {poolLoaded && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <InputPanel
            outlets={outlets}
            banks={filteredBanks}
            rules={rules}
            defaultBankId={filteredBanks[0]?.id ?? ""}
            onAdd={addInputs}
            enableGadaiPull={!!gadaiSyncEnabled}
            gadaiArah={jenis === "debet" ? "debet" : "kredit"}
          />
          <SummaryPanel
            summary={summary}
            inputs={matchedInputs}
            outlets={outlets}
            banks={banks}
            rules={rules}
            multiBank={filteredBanks.length > 1}
            onRemove={removeInput}
            onClearAll={clearAll}
            onDownload={handleSave}
            generating={saving}
            downloadError={downloadError}
            // Phase B props — disable Lanjut button di flow ini
            jenis={jenis}
            oppositeJenis={jenis === "kredit" ? "debet" : "kredit"}
            canLanjut={false}
            isFinalPass={false}
            onLanjut={() => {}}
            switching={false}
          />
        </div>
      )}

      {poolLoaded && gadaiSyncEnabled && (
        <div className="card p-4">
          <button
            type="button"
            onClick={handleKirimDanSelesai}
            disabled={kirimBusy || saving}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {(kirimBusy || saving)
              ? "Memproses..."
              : `Kirim ke Aceh Gadai + Alert & Selesai${jenis === "debet" ? " (transfer keluar)" : ""}`}
          </button>
          <p className="mt-1 text-[11px] text-slate-500">
            Sekali klik: kirim hasil + alert ke Aceh Gadai, lalu tandai mutasi (claimed) + simpan. Untuk cek manual tanpa Aceh Gadai, pakai tombol &quot;Selesai &amp; Download&quot; di panel kanan.
          </p>
          {kirimMsg && <p className="mt-1 text-[11px] text-slate-600">{kirimMsg}</p>}
        </div>
      )}

      {!poolLoaded && !loading && (
        <div className="card p-8 text-center text-sm text-slate-500">
          Klik &quot;Muat Data History&quot; untuk mulai. Pool berisi transaksi mutasi yang
          sudah pernah di-upload tapi belum ke-claim siapa pun.
        </div>
      )}
    </div>
  );
}
