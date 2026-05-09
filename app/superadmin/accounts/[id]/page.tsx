import { notFound } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchUserEmails } from "@/lib/supabase/user-emails";
import AccountDetailClient from "./detail-client";
import { ChevronLeft } from "lucide-react";

type AccountRow = {
  id: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  brand_name: string | null;
  support_email: string | null;
  support_wa: string | null;
  staff_limit?: number | null;
  owner_user_id: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  user_id: string;
  role: "owner" | "staff";
  joined_at: string | null;
  invited_at: string | null;
  last_active_at: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  jenis: "kredit" | "debet";
  total_input: number;
  total_matched: number;
  total_nominal_matched: number;
  created_at: string;
};

type AuditLog = {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type Counts = {
  banks: number;
  outlets: number;
  parsedTransactions: number;
  manualClaims: number;
};

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const admin = createAdminClient();

  const [
    accountRes,
    membersRes,
    sessionsRes,
    auditRes,
    banksCount,
    outletsCount,
    parsedCount,
    manualCount,
  ] = await Promise.all([
    admin.from("accounts").select("*").eq("id", id).maybeSingle(),
    admin
      .from("team_members")
      .select("id, user_id, role, joined_at, invited_at, last_active_at")
      .eq("account_id", id),
    admin
      .from("cek_sessions")
      .select("id, user_id, jenis, total_input, total_matched, total_nominal_matched, created_at")
      .eq("account_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    admin
      .from("audit_logs")
      .select("*")
      .eq("account_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    admin.from("banks").select("id", { count: "exact", head: true }).eq("account_id", id),
    admin.from("outlets").select("id", { count: "exact", head: true }).eq("account_id", id),
    admin
      .from("parsed_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id),
    admin
      .from("cek_inputs")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id)
      .not("manual_claim_reason", "is", null),
  ]);

  const account = accountRes.data as AccountRow | null;
  if (!account) notFound();

  const members = (membersRes.data ?? []) as MemberRow[];
  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const auditLogs = (auditRes.data ?? []) as AuditLog[];
  const counts: Counts = {
    banks: banksCount.count ?? 0,
    outlets: outletsCount.count ?? 0,
    parsedTransactions: parsedCount.count ?? 0,
    manualClaims: manualCount.count ?? 0,
  };

  // Phase 8.6: batch lookup email (avoid N+1)
  const userIds = Array.from(
    new Set([
      ...members.map((m) => m.user_id),
      ...sessions.map((s) => s.user_id),
      ...auditLogs.map((l) => l.user_id).filter((v): v is string => !!v),
    ]),
  );
  const emailMap = await fetchUserEmails(admin, userIds);
  const userEmails: Record<string, string> = Object.fromEntries(emailMap);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/superadmin/accounts"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ChevronLeft className="h-4 w-4" /> Kembali ke daftar
        </Link>
      </div>

      <AccountDetailClient
        account={account}
        members={members}
        sessions={sessions}
        auditLogs={auditLogs}
        counts={counts}
        userEmails={userEmails}
      />
    </div>
  );
}
