import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import ActivityClient from "./activity-client";

type LogRow = {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type TeamMemberRow = { id: string; user_id: string; role: "owner" | "staff" };
type BankLite = { id: string; kode: string; label: string | null };
type OutletLite = { id: string; nama: string; warna_hex: string };

export default async function ActivityPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  if (ctx.member.role !== "owner") redirect("/dashboard");

  const supabase = await createClient();
  const admin = createAdminClient();

  // 30 hari terakhir secara default (filter di-handle di client)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [logsRes, membersRes, banksRes, outletsRes] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("*")
      .gte("created_at", thirtyDaysAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("team_members")
      .select("id, user_id, role")
      .eq("account_id", ctx.account.id),
    supabase.from("banks").select("id, kode, label"),
    supabase.from("outlets").select("id, nama, warna_hex"),
  ]);

  const logs = (logsRes.data ?? []) as LogRow[];
  const members = (membersRes.data ?? []) as TeamMemberRow[];
  const banks = (banksRes.data ?? []) as BankLite[];
  const outlets = (outletsRes.data ?? []) as OutletLite[];

  // Lookup email for each member
  const userEmails = new Map<string, string>();
  for (const m of members) {
    const { data: userRes } = await admin.auth.admin.getUserById(m.user_id);
    if (userRes?.user?.email) userEmails.set(m.user_id, userRes.user.email);
  }

  return (
    <ActivityClient
      logs={logs}
      members={members}
      userEmails={Object.fromEntries(userEmails)}
      banks={banks}
      outlets={outlets}
      error={logsRes.error?.message ?? null}
    />
  );
}
