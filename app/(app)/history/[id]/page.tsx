import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateLong, parseDateISO, formatRupiah, formatDateID } from "@/lib/format";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronLeft,
} from "lucide-react";

type SessionRow = {
  id: string;
  user_id: string;
  jenis: "kredit" | "debet";
  period_mutasi_start: string | null;
  period_mutasi_end: string | null;
  total_input: number;
  total_matched: number;
  total_unmatched: number;
  total_conflict: number;
  total_nominal_input: number;
  total_nominal_matched: number;
  carry_over_used: boolean;
  multi_bank_used: boolean;
  created_at: string;
  completed_at: string | null;
};

type InputRow = {
  id: string;
  tanggal_input: string;
  outlet_id: string | null;
  bank_id: string | null;
  nominal: number;
  jenis: "kredit" | "debet";
  match_status: "matched" | "no_candidate" | "all_taken" | "manual_claimed" | null;
  conflict_count: number | null;
  conflict_dates: string[] | null;
  manual_claim_reason: string | null;
};

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  const supabase = await createClient();
  const [sessionRes, inputsRes, outletsRes, banksRes] = await Promise.all([
    supabase.from("cek_sessions").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("cek_inputs")
      .select("*")
      .eq("session_id", id)
      .order("created_at"),
    supabase.from("outlets").select("id, nama, warna_hex"),
    supabase.from("banks").select("id, kode, label"),
  ]);

  if (sessionRes.error || !sessionRes.data) notFound();
  const session = sessionRes.data as SessionRow;
  const inputs = (inputsRes.data ?? []) as InputRow[];
  const outletMap = new Map(((outletsRes.data ?? []) as OutletLite[]).map((o) => [o.id, o]));
  const bankMap = new Map(((banksRes.data ?? []) as BankLite[]).map((b) => [b.id, b]));

  const created = new Date(session.created_at);
  const periodStart = session.period_mutasi_start
    ? parseDateISO(session.period_mutasi_start)
    : null;
  const periodEnd = session.period_mutasi_end
    ? parseDateISO(session.period_mutasi_end)
    : null;

  const matched = inputs.filter((i) => i.match_status === "matched");
  const unmatched = inputs.filter((i) => i.match_status === "no_candidate");
  const conflict = inputs.filter((i) => i.match_status === "all_taken");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/history"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ChevronLeft className="h-4 w-4" /> Kembali ke History
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 flex items-center gap-2">
          {session.jenis === "kredit" ? (
            <ArrowDown className="h-5 w-5 text-green-600" />
          ) : (
            <ArrowUp className="h-5 w-5 text-red-600" />
          )}
          Cek Mutasi {session.jenis === "kredit" ? "Kredit" : "Debet"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Dilakukan {formatDateLong(created)}{" "}
          {created.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          {periodStart && periodEnd && (
            <>
              {" "}
              · Periode mutasi: {formatDateID(periodStart)} – {formatDateID(periodEnd)}
            </>
          )}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500">Total Input</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{session.total_input}</div>
          <div className="text-xs text-slate-600">
            Rp {formatRupiah(session.total_nominal_input)}
          </div>
        </div>
        <div className="card p-4 bg-green-50 border-green-200">
          <div className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Match
          </div>
          <div className="mt-1 text-lg font-semibold text-green-700">
            {session.total_matched}
          </div>
          <div className="text-xs text-green-700">
            Rp {formatRupiah(session.total_nominal_matched)}
          </div>
        </div>
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-xs text-red-700 flex items-center gap-1">
            <XCircle className="h-3 w-3" /> Tidak Match
          </div>
          <div className="mt-1 text-lg font-semibold text-red-700">
            {session.total_unmatched}
          </div>
        </div>
        <div className="card p-4 bg-amber-50 border-amber-200">
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Bentrok
          </div>
          <div className="mt-1 text-lg font-semibold text-amber-700">
            {session.total_conflict}
          </div>
        </div>
      </div>

      {/* Inputs table */}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {inputs.map((i) => {
                const outlet = i.outlet_id ? outletMap.get(i.outlet_id) : null;
                const bank = i.bank_id ? bankMap.get(i.bank_id) : null;
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4 text-xs text-slate-500">
        <p>
          {matched.length} match · {unmatched.length} tidak ketemu · {conflict.length} bentrok.
          {session.carry_over_used && " Carry-over dipakai."}
          {session.multi_bank_used && " Multi-bank cross-search dipakai."}
        </p>
      </div>
    </div>
  );
}
