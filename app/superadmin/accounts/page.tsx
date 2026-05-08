import { createAdminClient } from "@/lib/supabase/admin";
import AccountsClient from "./accounts-client";

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
  owner_user_id: string;
  created_at: string;
};

type EnrichedAccount = AccountRow & {
  ownerEmail: string | null;
  staffCount: number;
  sessionCount30d: number;
  lastSessionAt: string | null;
};

export default async function AccountsListPage() {
  const admin = createAdminClient();

  const { data: accountsData } = await admin
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: false });
  const accounts = (accountsData ?? []) as AccountRow[];

  // Fetch related: team_members (count), recent sessions (count + last)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: tmData } = await admin
    .from("team_members")
    .select("account_id, user_id, role");
  const teamMembers = (tmData ?? []) as { account_id: string; user_id: string; role: string }[];

  const { data: sessionsData } = await admin
    .from("cek_sessions")
    .select("account_id, created_at")
    .gte("created_at", thirtyDaysAgo.toISOString())
    .order("created_at", { ascending: false });
  const sessions = (sessionsData ?? []) as { account_id: string; created_at: string }[];

  // Build enrichment maps
  const ownerByAccount = new Map<string, string>();
  const staffCountByAccount = new Map<string, number>();
  for (const tm of teamMembers) {
    if (tm.role === "owner") ownerByAccount.set(tm.account_id, tm.user_id);
    if (tm.role === "staff") {
      staffCountByAccount.set(
        tm.account_id,
        (staffCountByAccount.get(tm.account_id) ?? 0) + 1,
      );
    }
  }

  const sessionCountByAccount = new Map<string, number>();
  const lastSessionByAccount = new Map<string, string>();
  for (const s of sessions) {
    sessionCountByAccount.set(
      s.account_id,
      (sessionCountByAccount.get(s.account_id) ?? 0) + 1,
    );
    if (!lastSessionByAccount.has(s.account_id)) {
      lastSessionByAccount.set(s.account_id, s.created_at);
    }
  }

  // Lookup owner emails (in batch via getUserById)
  const ownerEmails = new Map<string, string>();
  for (const a of accounts) {
    const ownerUserId = ownerByAccount.get(a.id) ?? a.owner_user_id;
    if (ownerUserId) {
      const { data: ur } = await admin.auth.admin.getUserById(ownerUserId);
      if (ur?.user?.email) ownerEmails.set(a.id, ur.user.email);
    }
  }

  const enriched: EnrichedAccount[] = accounts.map((a) => ({
    ...a,
    ownerEmail: ownerEmails.get(a.id) ?? null,
    staffCount: staffCountByAccount.get(a.id) ?? 0,
    sessionCount30d: sessionCountByAccount.get(a.id) ?? 0,
    lastSessionAt: lastSessionByAccount.get(a.id) ?? null,
  }));

  return <AccountsClient accounts={enriched} />;
}
