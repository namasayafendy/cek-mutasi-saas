"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Link2,
  Loader2,
  Printer,
  Layers,
  ListChecks,
} from "lucide-react";
import { formatRupiah, formatDateID, parseDateISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { ManualMatchModal } from "./manual-match-modal";
import type { InputRow, OutletLite, BankLite } from "./page";
import {
  downloadSessionPdf,
  type SessionInfo,
  type MatchedTxRow,
} from "./generate-session-pdf";
import { GroupClaimModal } from "./group-claim-modal";

type FilterKey = "all" | "matched" | "unmatched" | "conflict";

export function SessionInputsClient({
  inputs,
  outlets,
  banks,
  accountId,
  userId,
  brandName,
  session,
}: {
  inputs: InputRow[];
  outlets: OutletLite[];
  banks: BankLite[];
  accountId: string;
  userId: string;
  brandName: string;
  session: SessionInfo;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [matchingInput, setMatchingInput] = useState<InputRow | null>(null);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);
  const [printing, setPrinting] = useState(false);
  const [groupSelected, setGroupSelected] = useState<Set<string>>(new Set());
  const [showGroup, setShowGroup] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("all");

  // Derive counts + totals from inputs (used for filter cards AND filtered table).
  const { matchedCount, unmatchedCount, conflictCount, totalNominalInput, totalNominalMatched } = useMemo(() => {
    let m = 0;
    let u = 0;
    let c = 0;
    let tni = 0;
    let tnm = 0;
    for (const i of inputs) {
      tni += i.nominal;
      if (i.match_status === "matched" || i.match_status === "manual_claimed") {
        m++;
        tnm += i.nominal;
      } else if (i.match_status === "no_candidate") u++;
      else if (i.match_status === "all_taken") c++;
    }
    return {
      matchedCount: m,
      unmatchedCount: u,
      conflictCount: c,
      totalNominalInput: tni,
      totalNominalMatched: tnm,
    };
  }, [inputs]);

  const filteredInputs = useMemo(() => {
    if (filter === "all") return inputs;
    if (filter === "matched")
      return inputs.filter(
        (i) => i.match_status === "matched" || i.match_status === "manual_claimed",
      );
    if (filter === "unmatched") return inputs.filter((i) => i.match_status === "no_candidate");
    if (filter === "conflict") return inputs.filter((i) => i.match_status === "all_taken");
    return inputs;
  }, [inputs, filter]);

  async function handlePrint() {
    if (printing) return;
    setPrinting(true);
    setFeedback(null);
    try {
      const supabase = createClient();
      const matchedInputIds = inputs
        .filter((i) => i.match_status === "matched" || i.match_status === "manual_claimed")
        .map((i) => i.id);

      let matchedTxs: MatchedTxRow[] = [];
      if (matchedInputIds.length > 0) {
        const CHUNK = 200;
        const collected: MatchedTxRow[] = [];
        for (let i = 0; i < matchedInputIds.length; i += CHUNK) {
          const slice = matchedInputIds.slice(i, i + CHUNK);
          const { data, error } = await supabase
            .from("parsed_transactions")
            .select(
              "id, bank_id, tanggal, jam, nominal_kredit, nominal_debet, nama_pengirim, nama_penerima, deskripsi, claimed_by_input_id, manual_claim_reason",
            )
            .in("claimed_by_input_id", slice)
            .is("deleted_at", null)
            .order("tanggal", { ascending: true });
          if (error) throw error;
          collected.push(...((data ?? []) as MatchedTxRow[]));
        }
        matchedTxs = collected;
      }

      await downloadSessionPdf({
        brandName,
        session,
        inputs,
        matchedTxs,
        outlets,
        banks,
      });
      setFeedback({ type: "success", message: "PDF sesi berhasil di-download." });
    } catch (err) {
      console.error("Failed to generate session PDF", err);
      setFeedback({
        type: "error",
        message: "Gagal generate PDF: " + (err instanceof Error ? err.message : "unknown"),
      });
    } finally {
      setPrinting(false);
    }
  }

  const outletMap = new Map(outlets.map((o) => [o.id, o]));
  const bankMap = new Map(banks.map((b) => [b.id, b]));

  function toggleGroup(id: string) {
    setGroupSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const leftoverInputs = inputs.filter((i) => i.match_status === "no_candidate" || i.match_status === "all_taken");
  const groupSelectedInputs = leftoverInputs.filter((i) => groupSelected.has(i.id));

  function handleDelete(input: InputRow) {
    if (!confirm(`Hapus input Rp ${formatRupiah(input.nominal)}? (mis. customer cash, salah input)`)) return;
    setFeedback(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("cek_inputs")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", input.id);
      if (error) {
        setFeedback({ type: "error", message: error.message });
        return;
      }
      await supabase.from("audit_logs").insert({
        account_id: accountId,
        user_id: userId,
        action: "input.deleted",
        target_type: "cek_input",
        target_id: input.id,
        metadata: {
          nominal: input.nominal,
          jenis: input.jenis,
          reason: "leftover_ignored",
        },
      });
      setFeedback({ type: "success", message: "Input dihapus." });
      router.refresh();
    });
  }

  return (
    <>
      {/* Filter cards (formerly summary cards in page.tsx) — now clickable */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <FilterCard
          variant="total"
          active={filter === "all"}
          onClick={() => setFilter("all")}
          icon={<ListChecks className="h-3.5 w-3.5" />}
          label="Total Input"
          count={inputs.length}
          footer={`Rp ${formatRupiah(totalNominalInput)}`}
        />
        <FilterCard
          variant="match"
          active={filter === "matched"}
          onClick={() => setFilter("matched")}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="Match"
          count={matchedCount}
          footer={`Rp ${formatRupiah(totalNominalMatched)}`}
        />
        <FilterCard
          variant="unmatch"
          active={filter === "unmatched"}
          onClick={() => setFilter("unmatched")}
          icon={<XCircle className="h-3.5 w-3.5" />}
          label="Tidak Match"
          count={unmatchedCount}
          footer={unmatchedCount > 0 ? "Perlu tindak lanjut" : "Semua ketemu"}
        />
        <FilterCard
          variant="conflict"
          active={filter === "conflict"}
          onClick={() => setFilter("conflict")}
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="Bentrok"
          count={conflictCount}
          footer={conflictCount > 0 ? "Duplikat tanggal" : "Tidak ada"}
        />
      </div>

      {feedback && (
        <div
          className={`card p-3 text-sm flex items-start gap-2 ${
            feedback.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-medium text-slate-900">
            Detail Input{" "}
            <span className="text-slate-500 font-normal">
              ({filteredInputs.length}
              {filter !== "all" && ` dari ${inputs.length}`})
            </span>
            {filter !== "all" && (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="ml-2 text-xs text-emerald-700 hover:underline font-normal"
              >
                · Reset filter
              </button>
            )}
            {filter === "all" && leftoverInputs.length > 1 && groupSelected.size === 0 && (
              <span className="ml-2 text-xs text-slate-500 font-normal">
                · centang 2+ baris kalau mau cocokkan banyak input ke 1 tx mutasi
              </span>
            )}
            {groupSelected.size >= 2 && (
              <span className="ml-2 text-xs text-emerald-700 font-normal">
                · {groupSelected.size} input ke-centang — klik &quot;Cocokkan&quot; di salah satu baris atau tombol hijau
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {groupSelectedInputs.length >= 2 && (
              <button
                type="button"
                onClick={() => setShowGroup(true)}
                className="text-xs inline-flex items-center gap-1.5 bg-[#10B981] hover:bg-[#0ea571] text-white rounded-md px-3 py-1.5 font-medium transition-colors"
                title="Group Claim — cocokkan beberapa input sekaligus dengan beberapa tx"
              >
                <Layers className="h-3.5 w-3.5" />
                Group Claim ({groupSelectedInputs.length})
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing || inputs.length === 0}
              className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Print laporan sesi (PDF lengkap)"
            >
              {printing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Printer className="h-3.5 w-3.5" />
              )}
              Print Sesi PDF
            </button>
          </div>
        </div>
        {filteredInputs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {filter === "all"
              ? "Belum ada input."
              : "Tidak ada input dengan status yang dipilih."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <span className="sr-only">Pilih untuk Group Claim</span>
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Tanggal Input
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Outlet
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Bank
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Nominal
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredInputs.map((i) => {
                const outlet = i.outlet_id ? outletMap.get(i.outlet_id) : null;
                const bank = i.bank_id ? bankMap.get(i.bank_id) : null;
                const isLeftover = i.match_status === "no_candidate" || i.match_status === "all_taken";
                return (
                  <tr
                    key={i.id}
                    className={
                      isLeftover && groupSelected.has(i.id) ? "bg-emerald-50" : ""
                    }
                  >
                    <td className="px-3 py-2">
                      {isLeftover ? (
                        <input
                          type="checkbox"
                          checked={groupSelected.has(i.id)}
                          onChange={() => toggleGroup(i.id)}
                          className="h-4 w-4 accent-emerald-600 cursor-pointer"
                          title="Pilih untuk Group Claim"
                        />
                      ) : (
                        <span className="text-slate-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-700">
                      {formatDateID(parseDateISO(i.tanggal_input)!)}
                    </td>
                    <td className="px-4 py-2">
                      {outlet ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: outlet.warna_hex }}
                          />
                          {outlet.nama}
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600 text-xs">
                      {bank ? bank.label || bank.kode : "-"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      Rp {formatRupiah(i.nominal)}
                    </td>
                    <td className="px-4 py-2">
                      {i.match_status === "matched" && (
                        <span className="inline-flex items-center gap-1 text-green-700 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Match
                        </span>
                      )}
                      {i.match_status === "no_candidate" && (
                        <span className="inline-flex items-center gap-1 text-red-700 text-xs">
                          <XCircle className="h-3.5 w-3.5" /> Tidak ada di mutasi
                        </span>
                      )}
                      {i.match_status === "all_taken" && (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <AlertTriangle className="h-3.5 w-3.5" /> Bentrok ({i.conflict_count}x)
                          </span>
                          {i.conflict_dates && i.conflict_dates.length > 0 && (
                            <div className="text-[10px] text-amber-700 mt-0.5">
                              di tgl: {i.conflict_dates.join(", ")}
                            </div>
                          )}
                        </div>
                      )}
                      {i.match_status === "manual_claimed" && (
                        <span className="inline-flex items-center gap-1 text-blue-700 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Manual claim
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isLeftover && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (groupSelected.size >= 2 && groupSelected.has(i.id)) {
                                setShowGroup(true);
                              } else {
                                setMatchingInput(i);
                              }
                            }}
                            disabled={pending}
                            className="text-xs text-slate-700 hover:text-slate-900 inline-flex items-center gap-1"
                            title={
                              groupSelected.size >= 2 && groupSelected.has(i.id)
                                ? "Cocokkan SEMUA input yang ke-centang (Group Claim)"
                                : "Cocokkan input ini ke transaksi mutasi"
                            }
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            {groupSelected.size >= 2 && groupSelected.has(i.id)
                              ? `Cocokkan (${groupSelected.size})`
                              : "Cocokkan"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(i)}
                            disabled={pending}
                            className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                            title="Hapus input ini (mis. customer cash / salah input)"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Hapus
                          </button>
                        </div>
                      )}
                      {pending && isLeftover && (
                        <Loader2 className="inline-block h-3 w-3 animate-spin text-slate-400 ml-1" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showGroup && groupSelectedInputs.length >= 2 && (
        <GroupClaimModal
          inputs={groupSelectedInputs}
          outlets={outlets}
          banks={banks}
          accountId={accountId}
          userId={userId}
          onClose={() => {
            setShowGroup(false);
            setGroupSelected(new Set());
          }}
        />
      )}

      {matchingInput && (
        <ManualMatchModal
          input={matchingInput}
          banks={banks}
          accountId={accountId}
          userId={userId}
          onClose={() => setMatchingInput(null)}
        />
      )}
    </>
  );
}

// ===== Filter card =====

function FilterCard({
  variant,
  active,
  onClick,
  icon,
  label,
  count,
  footer,
}: {
  variant: "total" | "match" | "unmatch" | "conflict";
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  footer: string;
}) {
  const palette: Record<
    typeof variant,
    {
      activeBg: string;
      activeRing: string;
      activeText: string;
      activeCount: string;
      activeFooter: string;
      inactiveBg: string;
      inactiveText: string;
      inactiveCount: string;
      inactiveFooter: string;
      blob: string;
    }
  > = {
    total: {
      activeBg: "bg-gradient-to-br from-[#0F2E1F] to-[#1a4530] border-[#0F2E1F]",
      activeRing: "ring-2 ring-[#0F2E1F]/40",
      activeText: "text-white",
      activeCount: "text-white",
      activeFooter: "text-white/80",
      inactiveBg:
        "bg-gradient-to-br from-[#FAFAF7] to-white border-slate-200 hover:border-slate-400",
      inactiveText: "text-slate-500",
      inactiveCount: "text-[#0F2E1F]",
      inactiveFooter: "text-slate-600",
      blob: "bg-[#0F2E1F]/5",
    },
    match: {
      activeBg: "bg-gradient-to-br from-[#10B981] to-[#059669] border-[#10B981]",
      activeRing: "ring-2 ring-[#10B981]/40",
      activeText: "text-white",
      activeCount: "text-white",
      activeFooter: "text-white/85",
      inactiveBg:
        "bg-gradient-to-br from-[#10B981]/10 via-white to-[#10B981]/5 border-[#10B981]/30 hover:border-[#10B981]/60",
      inactiveText: "text-[#10B981]",
      inactiveCount: "text-[#10B981]",
      inactiveFooter: "text-[#10B981]",
      blob: "bg-[#10B981]/15",
    },
    unmatch: {
      activeBg: "bg-gradient-to-br from-red-600 to-red-700 border-red-600",
      activeRing: "ring-2 ring-red-500/40",
      activeText: "text-white",
      activeCount: "text-white",
      activeFooter: "text-white/85",
      inactiveBg:
        "bg-gradient-to-br from-red-50 via-white to-red-50/50 border-red-200 hover:border-red-400",
      inactiveText: "text-red-700",
      inactiveCount: "text-red-700",
      inactiveFooter: "text-red-600",
      blob: "bg-red-200/30",
    },
    conflict: {
      activeBg: "bg-gradient-to-br from-amber-500 to-amber-600 border-amber-500",
      activeRing: "ring-2 ring-amber-400/40",
      activeText: "text-white",
      activeCount: "text-white",
      activeFooter: "text-white/85",
      inactiveBg:
        "bg-gradient-to-br from-amber-50 via-white to-amber-50/50 border-amber-200 hover:border-amber-400",
      inactiveText: "text-amber-700",
      inactiveCount: "text-amber-700",
      inactiveFooter: "text-amber-600",
      blob: "bg-amber-200/40",
    },
  };
  const p = palette[variant];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl border p-4 shadow-sm text-left transition-all hover:-translate-y-0.5 cursor-pointer ${
        active ? `${p.activeBg} ${p.activeRing}` : p.inactiveBg
      }`}
    >
      <div className={`absolute -top-8 -right-8 h-20 w-20 rounded-full ${active ? "bg-white/15" : p.blob}`} />
      <div className="relative">
        <div
          className={`text-xs font-semibold uppercase tracking-wider flex items-center gap-1 ${
            active ? p.activeText : p.inactiveText
          }`}
        >
          {icon}
          {label}
        </div>
        <div
          className={`mt-2 text-3xl font-bold ${active ? p.activeCount : p.inactiveCount}`}
        >
          {count}
        </div>
        <div
          className={`mt-1 text-[11px] ${active ? p.activeFooter : p.inactiveFooter} font-mono`}
        >
          {footer}
        </div>
      </div>
    </button>
  );
}
