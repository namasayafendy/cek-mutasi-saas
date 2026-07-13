"use client";

import { useState } from "react";
import type { MatchSummary, Outlet, UserInput, Bank, MatchRulePreset, Jenis } from "@/lib/types";
import { formatRupiah, formatDateID } from "@/lib/format";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Trash2,
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  Globe,
  ArrowRight,
} from "lucide-react";

export function SummaryPanel({
  summary,
  inputs,
  outlets,
  banks,
  rules,
  multiBank,
  onRemove,
  onClearAll,
  onDownload,
  generating,
  downloadError,
  jenis,
  oppositeJenis,
  canLanjut,
  isFinalPass,
  onLanjut,
  switching,
}: {
  summary: MatchSummary;
  inputs: UserInput[];
  outlets: Outlet[];
  banks: Bank[];
  rules: MatchRulePreset[];
  multiBank: boolean;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  onDownload: () => void;
  generating: boolean;
  downloadError: string | null;
  jenis: Jenis;
  oppositeJenis: Jenis;
  canLanjut: boolean;
  isFinalPass: boolean;
  onLanjut: () => void;
  switching: boolean;
}) {
  const [showInputs, setShowInputs] = useState(true);
  const [showUnclaimed, setShowUnclaimed] = useState(false);
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Ringkasan</h3>
        {inputs.length > 0 && (
          <button onClick={onClearAll} className="text-xs text-red-600 hover:underline">
            Hapus semua
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-500">Total input</div>
          <div className="text-base font-semibold text-slate-900">{summary.totalInput}</div>
        </div>
        <div className="rounded-md bg-green-50 px-3 py-2">
          <div className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Match
          </div>
          <div className="text-base font-semibold text-green-700">{summary.matched}</div>
        </div>
        <div className="rounded-md bg-red-50 px-3 py-2">
          <div className="text-xs text-red-700 flex items-center gap-1">
            <XCircle className="h-3 w-3" /> Tidak ada
          </div>
          <div className="text-base font-semibold text-red-700">{summary.noCandidate.length}</div>
        </div>
        <div className="rounded-md bg-amber-50 px-3 py-2">
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Bentrok
          </div>
          <div className="text-base font-semibold text-amber-700">{summary.allTaken.length}</div>
        </div>
      </div>

      <div className="border-t pt-3">
        <button
          onClick={() => setShowInputs((v) => !v)}
          className="w-full flex items-center justify-between text-xs font-medium text-slate-700 hover:text-slate-900"
        >
          <span>Input ({inputs.length})</span>
          {showInputs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showInputs && (
          <div className="mt-2 max-h-64 overflow-y-auto space-y-1">
            {inputs.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2">Belum ada input.</p>
            ) : (
              inputs.map((i) => {
                const o = outletById.get(i.outletId);
                const bank = i.bankId ? bankById.get(i.bankId) : null;
                const rule = ruleById.get(i.matchRuleId);
                const status = i.match?.status;
                const isAllBank = !i.bankId;
                return (
                  <div
                    key={i.id}
                    className="text-xs px-2 py-1.5 rounded bg-slate-50 hover:bg-slate-100"
                  >
                    <div className="flex items-center gap-2">
                      {o && (
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: o.warna_hex }}
                        />
                      )}
                      {status === "matched" && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                      )}
                      {status === "no_candidate" && (
                        <XCircle className="h-3.5 w-3.5 text-red-600 flex-shrink-0" />
                      )}
                      {status === "all_taken" && (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                      )}
                      <span className="text-slate-700 flex-shrink-0">{formatDateID(i.tanggal)}</span>
                      <span className="text-slate-500 truncate">{o?.nama ?? "?"}</span>
                      {multiBank && (
                        <span
                          className={`text-[10px] px-1 rounded border flex-shrink-0 ${
                            isAllBank
                              ? "bg-purple-50 border-purple-200 text-purple-700"
                              : "bg-white border-slate-200 text-slate-400"
                          }`}
                          title={isAllBank ? "Cross-bank (semua bank)" : bank?.label || bank?.kode}
                        >
                          {isAllBank ? (
                            <Globe className="inline-block h-2.5 w-2.5" />
                          ) : (
                            bank?.label || bank?.kode || "?"
                          )}
                        </span>
                      )}
                      {rule && (
                        <span
                          className="text-[10px] text-slate-400 px-1 rounded bg-white border border-slate-200 flex-shrink-0"
                          title={`Aturan: ${rule.name}`}
                        >
                          {rule.name.length > 8 ? rule.name.slice(0, 8) + "..." : rule.name}
                        </span>
                      )}
                      {i.match?.status === "matched" && i.match.matchedBy && i.match.matchedBy !== "NOMINAL" && (
                        <span
                          className="text-[10px] px-1 rounded border flex-shrink-0 bg-emerald-50 border-emerald-200 text-emerald-700 font-medium"
                          title={
                            i.match.matchedBy === "REF"
                              ? "Match pasti: no referensi resi ketemu persis di mutasi"
                              : "Match kuat: nama pengirim + jam resi cocok dengan mutasi"
                          }
                        >
                          {i.match.matchedBy === "REF" ? "REF" : "JAM"}
                        </span>
                      )}
                      {i.match?.refIssue && (
                        <span
                          className="text-[10px] px-1 rounded border flex-shrink-0 bg-red-50 border-red-300 text-red-700 font-medium"
                          title={
                            i.match.refIssue === "REF_NOMINAL_BEDA"
                              ? "Ref resi ketemu di mutasi tapi NOMINALNYA BEDA — cek: salah baca AI atau resi diedit"
                              : "Ref resi menunjuk mutasi yang SUDAH dipakai input lain — cek kemungkinan salah-pasang sesi lama"
                          }
                        >
                          ⚠ REF
                        </span>
                      )}
                      <span className="ml-auto font-mono text-slate-900 flex-shrink-0">
                        {formatRupiah(i.nominal)}
                      </span>
                      <button
                        onClick={() => onRemove(i.id)}
                        className="text-slate-400 hover:text-red-600 flex-shrink-0"
                        title="Hapus"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    {status === "all_taken" && i.match?.status === "all_taken" && (
                      <div className="mt-1 ml-5 text-[10px] text-amber-700 leading-tight">
                        Sudah ke-claim ({i.match.conflictCount}x di tgl {i.match.conflictDates.join(", ")})
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {summary.unclaimed.length > 0 && (
        <div className="border-t pt-3">
          <button
            onClick={() => setShowUnclaimed((v) => !v)}
            className="w-full flex items-center justify-between text-xs font-medium text-slate-700 hover:text-slate-900"
          >
            <span>Tidak di-claim siapa pun ({summary.unclaimed.length})</span>
            {showUnclaimed ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {showUnclaimed && (
            <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
              {summary.unclaimed.map((tx) => {
                const isCarryover = tx.source === "carryover";
                const bank = tx.bankId ? bankById.get(tx.bankId) : null;
                return (
                  <div
                    key={`${tx.bankId ?? "_"}-${tx.page}-${tx.no}`}
                    className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                      isCarryover ? "bg-blue-50/60" : "bg-slate-50"
                    }`}
                  >
                    {isCarryover && (
                      <span
                        className="inline-flex items-center rounded bg-blue-100 text-blue-700 px-1 text-[10px] font-medium flex-shrink-0"
                        title="Dari upload sebelumnya (carry-over)"
                      >
                        carry
                      </span>
                    )}
                    <span className="text-slate-700 flex-shrink-0">{tx.tanggal}</span>
                    {multiBank && bank && (
                      <span className="text-[10px] text-slate-400 px-1 rounded bg-white border border-slate-200 flex-shrink-0">
                        {bank.label || bank.kode}
                      </span>
                    )}
                    <span className="text-slate-500 truncate">{tx.namaPengirim || "-"}</span>
                    <span className="ml-auto font-mono text-slate-900 flex-shrink-0">
                      {formatRupiah(tx.kredit)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="border-t pt-3 space-y-2">
        <button
          onClick={onDownload}
          disabled={generating || switching || inputs.length === 0}
          className="btn-primary w-full"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Generating PDF...
            </>
          ) : isFinalPass ? (
            <>
              <Download className="h-4 w-4" /> Selesai &amp; Download PDF (Kredit + Debet)
            </>
          ) : (
            <>
              <Download className="h-4 w-4" /> Selesai &amp; Download PDF ({jenis === "kredit" ? "Kredit" : "Debet"} saja)
            </>
          )}
        </button>
        {downloadError && (
          <div className="mt-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {downloadError}
          </div>
        )}
      </div>

      {canLanjut && (
        <div className="border-t pt-3 -mx-4 -mb-4 px-4 pb-4 bg-gradient-to-br from-emerald-50 to-emerald-100/40 rounded-b-lg">
          <button
            onClick={onLanjut}
            disabled={switching || generating || inputs.length === 0}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-4 px-4 text-sm shadow-md transition-colors"
          >
            {switching ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Menyimpan pass {jenis === "kredit" ? "kredit" : "debet"}...
              </>
            ) : (
              <>
                Lanjut Cek Mutasi {oppositeJenis === "kredit" ? "Kredit (Masuk)" : "Debet (Keluar)"}
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
          <p className="mt-2 text-[11px] text-emerald-800 text-center leading-tight">
            Sudah selesai input semua{" "}
            {jenis === "kredit" ? "transferan masuk" : "transferan keluar"}? Klik untuk lanjut cek{" "}
            {oppositeJenis === "kredit" ? "transaksi masuk (kredit)" : "transaksi keluar (debet)"} di PDF yang sama.
            <br />
            PDF final nanti akan berisi highlight kredit + debet gabungan.
          </p>
        </div>
      )}
    </div>
  );
}
