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
import { SessionInputsClient } from "./session-inputs-client";

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

export type InputRow = {
  id: string;
  tanggal_input: string;
  outlet_id: string | null;
  bank_id: string | null;
  nominal: number;
  jenis: "kredit" | "debet";
  match_status: "matched" | "no_candidate" | "all_taken" | "manual_claimed" | null;
  matched_tx_id: string | null;
  conflict_count: number | null;
  conflict_dates: string[] | null;
  manual_claim_reason: string | null;
  claim_category: string | null;
  deleted_at: string | null;
};

export type OutletLite = { id: string; nama: string; warna_hex: string };
export type BankLite = { id: string; kode: string; label: string | null };

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
      .is("deleted_at", null)
      .order("created_at"),
    supabase.from("outlets").select("id, nama, warna_hex"),
    supabase.from("banks").select("id, kode, label"),
  ]);

  if (sessionRes.error || !sessionRes.data) notFound();
  const session = sessionRes.data as SessionRow;
  const inputs = (inputsRes.data ?? []) as InputRow[];
  const outlets = (outletsRes.data ?? []) as OutletLite[];
  const banks = (banksRes.data ?? []) as BankLite[];

  const created = new Date(session.created_at);
  const periodStart = session.period_mutasi_start
    ? parseDateISO(session.period_mutasi_start)
    : null;
  const periodEnd = session.period_mutasi_end
    ? parseDateISO(session.period_mutasi_end)
    : null;

  const matched = inputs.filter(
    (i) => i.match_status === "matched" || i.match_status === "manual_claimed",
  ).length;
  const unmatched = inputs.filter((i) => i.match_status === "no_candidate").length;
  const conflict = inputs.filter((i) => i.match_status === "all_taken").length;
  const totalNominalInput = inputs.reduce((s, i) => s + i.nominal, 0);
  const totalNominalMatched = inputs
    .filter((i) => i.match_status === "matched" || i.match_status === "manual_claimed")
    .reduce((s, i) => s + i.nominal, 0);

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

      {/* Summary cards (live count after delete) */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500">Total Input</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{inputs.length}</div>
          <div className="text-xs text-slate-600">Rp {formatRupiah(totalNominalInput)}</div>
        </div>
        <div className="card p-4 bg-green-50 border-green-200">
          <div className="text-xs text-green-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Match
          </div>
          <div className="mt-1 text-lg font-semibold text-green-700">{matched}</div>
          <div className="text-xs text-green-700">Rp {formatRupiah(totalNominalMatched)}</div>
        </div>
        <div className="card p-4 bg-red-50 border-red-200">
          <div className="text-xs text-red-700 flex items-center gap-1">
            <XCircle className="h-3 w-3" /> Tidak Match
          </div>
          <div className="mt-1 text-lg font-semibold text-red-700">{unmatched}</div>
        </div>
        <div className="card p-4 bg-amber-50 border-amber-200">
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Bentrok
          </div>
          <div className="mt-1 text-lg font-semibold text-amber-700">{conflict}</div>
        </div>
      </div>

      <SessionInputsClient
        inputs={inputs}
        outlets={outlets}
        banks={banks}
        accountId={ctx.account.id}
        userId={ctx.user.id}
        brandName={ctx.account.brand_name || "CekTransfer"}
        session={{
          id: session.id,
          jenis: session.jenis,
          period_mutasi_start: session.period_mutasi_start,
          period_mutasi_end: session.period_mutasi_end,
          created_at: session.created_at,
          carry_over_used: session.carry_over_used,
          multi_bank_used: session.multi_bank_used,
        }}
      />

      <div className="card p-4 text-xs text-slate-500">
        <p>
          {matched} match · {unmatched} tidak ketemu · {conflict} bentrok.
          {session.carry_over_used && " Carry-over dipakai."}
          {session.multi_bank_used && " Multi-bank cross-search dipakai."}
        </p>
      </div>
    </div>
  );
}
