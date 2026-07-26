import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateLong, parseDateISO, formatDateID } from "@/lib/format";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
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
  /** id klaim Aceh Gadai — dipakai mengirim balik hasil cocok-manual */
  gadai_klaim_id?: string | null;
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
    supabase.from("cek_sessions").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
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

  return (
    <div className="space-y-6">
      <Link
        href="/history"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-[#0F2E1F]"
      >
        <ChevronLeft className="h-4 w-4" /> Kembali ke History
      </Link>

      {/* Hero header — themed gradient by jenis */}
      <div
        className={`rounded-2xl p-6 sm:p-7 border ${
          session.jenis === "kredit"
            ? "bg-gradient-to-br from-[#10B981]/10 via-white to-[#FAFAF7] border-[#10B981]/20"
            : "bg-gradient-to-br from-[#0F2E1F]/8 via-white to-[#FAFAF7] border-[#0F2E1F]/15"
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`inline-flex items-center justify-center w-12 h-12 rounded-xl shadow-md ${
              session.jenis === "kredit"
                ? "bg-gradient-to-br from-[#10B981] to-[#059669] text-white"
                : "bg-gradient-to-br from-[#1a4530] to-[#0F2E1F] text-white"
            }`}
          >
            {session.jenis === "kredit" ? (
              <ArrowDown className="h-6 w-6" />
            ) : (
              <ArrowUp className="h-6 w-6" />
            )}
          </div>
          <div>
            <div
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                session.jenis === "kredit"
                  ? "bg-[#10B981]/15 text-[#10B981]"
                  : "bg-[#0F2E1F]/10 text-[#0F2E1F]"
              }`}
            >
              {session.jenis === "kredit" ? "Transaksi Masuk" : "Transaksi Keluar"}
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
              Cek Mutasi {session.jenis === "kredit" ? "Kredit" : "Debet"}
            </h1>
          </div>
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Dilakukan {formatDateLong(created)}{" "}
          {created.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          {periodStart && periodEnd && (
            <>
              {" "}
              · Periode mutasi:{" "}
              <strong className="text-[#0F2E1F]">
                {formatDateID(periodStart)} - {formatDateID(periodEnd)}
              </strong>
            </>
          )}
        </p>
      </div>

      {/* Filter cards + detail table — rendered inside client component for
          interactive filter state. */}
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

      <div className="rounded-xl border border-slate-200 bg-[#FAFAF7] p-4 text-xs text-slate-600 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#10B981]/10 text-[#10B981] flex-shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5" />
        </span>
        <span>
          <strong className="text-[#0F2E1F]">{matched}</strong> match ·{" "}
          <strong className="text-red-700">{unmatched}</strong> tidak ketemu ·{" "}
          <strong className="text-amber-700">{conflict}</strong> bentrok.
          {session.carry_over_used && " · Carry-over dipakai."}
          {session.multi_bank_used && " · Multi-bank cross-search dipakai."}
        </span>
      </div>
    </div>
  );
}
