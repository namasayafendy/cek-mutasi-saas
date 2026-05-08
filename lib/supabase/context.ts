// Server-side helper untuk dapatkan user + account + role context.
// Dipakai di server components & server actions.

import { createClient } from "./server";
import type { Account, TeamMember, AccountSettings } from "@/lib/types";

export type AccountContext = {
  user: { id: string; email: string | undefined };
  account: Account;
  member: TeamMember;
  settings: AccountSettings | null;
};

/**
 * Get full account context for current authenticated user.
 * Returns null kalau belum login atau tidak punya account.
 */
export async function getAccountContext(): Promise<AccountContext | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Fetch team_member (which links user → account + role)
  const { data: memberData } = await supabase
    .from("team_members")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!memberData) return null;
  const member = memberData as TeamMember;

  // Fetch account
  const { data: accountData } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", member.account_id)
    .maybeSingle();
  if (!accountData) return null;
  const account = accountData as Account;

  // Fetch settings (non-fatal)
  const { data: settingsData } = await supabase
    .from("account_settings")
    .select("*")
    .eq("account_id", account.id)
    .maybeSingle();
  const settings = (settingsData as AccountSettings | null) ?? null;

  return {
    user: { id: user.id, email: user.email },
    account,
    member,
    settings,
  };
}

/**
 * Determine if subscription is active enough to use the app.
 * - trial: usable kalau trial belum expired
 * - active: always usable
 * - suspended/cancelled: not usable
 */
export function isSubscriptionUsable(account: Account): boolean {
  if (account.status === "active") return true;
  if (account.status === "trial") {
    if (!account.trial_ends_at) return true;
    return new Date(account.trial_ends_at).getTime() > Date.now();
  }
  return false;
}

/** Days remaining in trial. Negative if expired. Null if not trial or no trial_ends_at. */
export function trialDaysRemaining(account: Account): number | null {
  if (account.status !== "trial" || !account.trial_ends_at) return null;
  const ms = new Date(account.trial_ends_at).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/** Phase 6: redirect helper untuk halaman owner-only. */
export function requireOwner(ctx: AccountContext): boolean {
  return ctx.member.role === "owner";
}
