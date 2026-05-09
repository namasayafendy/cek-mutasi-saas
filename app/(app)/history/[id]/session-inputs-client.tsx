"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Link2,
  Loader2,
} from "lucide-react";
import { formatRupiah, formatDateID, parseDateISO } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import { ManualMatchModal } from "./manual-match-modal";
import type { InputRow, OutletLite, BankLite } from "./page";

export function SessionInputsClient({
  inputs,
  outlets,
  banks,
  accountId,
  userId,
}: {
  inputs: InputRow[];
  outlets: OutletLite[];
  banks: BankLite[];
  accountId: string;
  userId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [matchingInput, setMatchingInput] = useState<InputRow | null>(null);
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  const outletMap = new Map(outlets.map((o) => [o.id, o]));
  const bankMap = new Map(banks.map((b) => [b.id, b]));

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
      // Audit log
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
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="font-medium text-slate-900">Detail Input ({inputs.length})</h2>
        </div>
        {inputs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Belum ada input.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
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
              {inputs.map((i) => {
                const outlet = i.outlet_id ? outletMap.get(i.outlet_id) : null;
                const bank = i.bank_id ? bankMap.get(i.bank_id) : null;
                const isLeftover = i.match_status === "no_candidate";
                return (
                  <tr key={i.id}>
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
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600 text-xs">
                      {bank ? bank.label || bank.kode : "—"}
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
                            <AlertTriangle className="h-3.5 w-3.5" /> Bentrok ({i.conflict_count}×)
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
                            onClick={() => setMatchingInput(i)}
                            disabled={pending}
                            className="text-xs text-slate-700 hover:text-slate-900 inline-flex items-center gap-1"
                            title="Cocokkan input ini ke transaksi mutasi"
                          >
                            <Link2 className="h-3.5 w-3.5" /> Cocokkan
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
