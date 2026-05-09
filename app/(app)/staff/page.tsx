import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchUserEmails } from "@/lib/supabase/user-emails";
import StaffClient from "./staff-client";

type StaffRow = {
  id: string;
  user_id: string;
  role: "owner" | "staff";
  invited_at: string | null;
  joined_at: string | null;
  last_active_at: string | null;
  created_at: string;
};

type StaffWithEmail = StaffRow & { email: string | null };

export default async function StaffPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  if (ctx.member.role !== "owner") redirect("/dashboard");

  // Fetch team members + email lookup via admin (auth.users tidak accessible via anon RLS)
  const admin = createAdminClient();
  const { data: members } = await admin
    .from("team_members")
    .select("id, user_id, role, invited_at, joined_at, last_active_at, created_at")
    .eq("account_id", ctx.account.id)
    .order("role", { ascending: true })
    .order("created_at", { ascending: true });

  const rows = (members ?? []) as StaffRow[];

  // Phase 8.6: batch lookup email (avoid N+1)
  const emailMap = await fetchUserEmails(
    admin,
    rows.map((r) => r.user_id),
  );
  const enriched: StaffWithEmail[] = rows.map((m) => ({
    ...m,
    email: emailMap.get(m.user_id) ?? null,
  }));

  return (
    <StaffClient
      staff={enriched}
      currentUserId={ctx.user.id}
      staffLimit={ctx.account.staff_limit ?? 3}
      brandSupportEmail={ctx.account.support_email}
    />
  );
}
