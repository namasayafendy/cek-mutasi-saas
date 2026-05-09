import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import HistoryClient from "./history-client";

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
  carry_over_used: boolean | null;
  multi_bank_used: boolean | null;
  created_at: string;
};

type UnclaimedTx = {
  id: string;
  bank_id: string | null;
  no_ref: string | null;
  tanggal: string;
  jam: string | null;
  nominal_kredit: number;
  nominal_debet: number;
  nama_pengirim: string | null;
  nama_penerima: string | null;
  deskripsi: string | null;
};

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null; is_active: boolean };

export default async function HistoryPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();

  // Carry-over window: 12 bulan terakhir untuk listing belum-match
  const yearAgo = new Date();
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  const yearAgoIso = yearAgo.toISOString().split("T")[0];

  const [sessionsRes, unclaimedRes, outletsRes, banksRes] = await Promise.all([
    supabase
      .from("cek_sessions")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("parsed_transactions")
      .select(
        "id, bank_id, no_ref, tanggal, jam, nominal_kredit, nominal_debet, nama_pengirim, nama_penerima, deskripsi",
      )
      .is("claimed_by_input_id", null)
      .is("deleted_at", null)
      .gte("tanggal", yearAgoIso)
      .order("tanggal", { ascending: false })
      .limit(500),
    supabase.from("outlets").select("id, nama, warna_hex").order("urutan_palette"),
    supabase.from("banks").select("id, kode, label, is_active").order("urutan"),
  ]);

  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const unclaimed = (unclaimedRes.data ?? []) as UnclaimedTx[];
  const outlets = (outletsRes.data ?? []) as OutletLite[];
  const banks = (banksRes.data ?? []) as BankLite[];

  return (
    <HistoryClient
      sessions={sessions}
      unclaimed={unclaimed}
      outlets={outlets}
      banks={banks}
      currentUserId={ctx.user.id}
      accountId={ctx.account.id}
      sessionsError={sessionsRes.error?.message ?? null}
      unclaimedError={unclaimedRes.error?.message ?? null}
      brandName={ctx.account.brand_name || "CekTransfer"}
    />
  );
}
