"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperadminEmail } from "@/lib/supabase/context";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSuperadmin(): Promise<{ email: string; userId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isSuperadminEmail(user.email)) return null;
  return { email: user.email!, userId: user.id };
}

/** Extend trial sampai N hari dari sekarang. */
export async function extendTrial(accountId: string, days: number): Promise<ActionResult> {
  const sa = await requireSuperadmin();
  if (!sa) return { ok: false, error: "Akses ditolak" };
  if (days < 1 || days > 365) return { ok: false, error: "Days harus 1-365" };

  const admin = createAdminClient();
  const newEnd = new Date();
  newEnd.setDate(newEnd.getDate() + days);

  const { error } = await admin
    .from("accounts")
    .update({
      status: "trial",
      trial_ends_at: newEnd.toISOString(),
      cancelled_at: null,
    })
    .eq("id", accountId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    account_id: accountId,
    user_id: sa.userId,
    action: "superadmin.extend_trial",
    target_type: "account",
    target_id: accountId,
    metadata: { days, by: sa.email, new_end: newEnd.toISOString() },
  });

  revalidatePath(`/superadmin/accounts/${accountId}`);
  revalidatePath(`/superadmin`);
  return { ok: true };
}

/** Mark account as active (manual override — biasanya dipakai sebelum Midtrans live). */
export async function activateAccount(accountId: string, days: number): Promise<ActionResult> {
  const sa = await requireSuperadmin();
  if (!sa) return { ok: false, error: "Akses ditolak" };
  if (days < 1 || days > 366) return { ok: false, error: "Days harus 1-366" };

  const admin = createAdminClient();
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + days);

  const { error } = await admin
    .from("accounts")
    .update({
      status: "active",
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      cancelled_at: null,
    })
    .eq("id", accountId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    account_id: accountId,
    user_id: sa.userId,
    action: "superadmin.activate",
    target_type: "account",
    target_id: accountId,
    metadata: { days, by: sa.email, period_end: end.toISOString() },
  });

  revalidatePath(`/superadmin/accounts/${accountId}`);
  revalidatePath(`/superadmin`);
  return { ok: true };
}

export async function suspendAccount(accountId: string, reason: string): Promise<ActionResult> {
  const sa = await requireSuperadmin();
  if (!sa) return { ok: false, error: "Akses ditolak" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("accounts")
    .update({ status: "suspended" })
    .eq("id", accountId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    account_id: accountId,
    user_id: sa.userId,
    action: "superadmin.suspend",
    target_type: "account",
    target_id: accountId,
    metadata: { reason, by: sa.email },
  });

  revalidatePath(`/superadmin/accounts/${accountId}`);
  revalidatePath(`/superadmin`);
  return { ok: true };
}

export async function cancelAccount(accountId: string, reason: string): Promise<ActionResult> {
  const sa = await requireSuperadmin();
  if (!sa) return { ok: false, error: "Akses ditolak" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("accounts")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .eq("id", accountId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    account_id: accountId,
    user_id: sa.userId,
    action: "superadmin.cancel",
    target_type: "account",
    target_id: accountId,
    metadata: { reason, by: sa.email },
  });

  revalidatePath(`/superadmin/accounts/${accountId}`);
  revalidatePath(`/superadmin`);
  return { ok: true };
}

/** Send password reset email ke owner account. */
export async function resetOwnerPassword(accountId: string): Promise<ActionResult> {
  const sa = await requireSuperadmin();
  if (!sa) return { ok: false, error: "Akses ditolak" };

  const admin = createAdminClient();
  const { data: tmRaw } = await admin
    .from("team_members")
    .select("user_id")
    .eq("account_id", accountId)
    .eq("role", "owner")
    .maybeSingle();
  const tm = tmRaw as { user_id: string } | null;
  if (!tm) return { ok: false, error: "Owner tidak ditemukan" };

  const { data: userRes } = await admin.auth.admin.getUserById(tm.user_id);
  const email = userRes?.user?.email;
  if (!email) return { ok: false, error: "Email owner tidak ditemukan" };

  const { error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: {
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/set-password`
        : undefined,
    },
  });
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    account_id: accountId,
    user_id: sa.userId,
    action: "superadmin.reset_password",
    target_type: "account",
    target_id: accountId,
    metadata: { target_email: email, by: sa.email },
  });

  return { ok: true };
}

/** Update brand_name + support contact via superadmin. */
export async function updateAccountMeta(
  accountId: string,
  patch: { brand_name?: string; support_email?: string; support_wa?: string },
): Promise<ActionResult> {
  const sa = await requireSuperadmin();
  if (!sa) return { ok: false, error: "Akses ditolak" };

  const admin = createAdminClient();
  const { error } = await admin.from("accounts").update(patch).eq("id", accountId);
  if (error) return { ok: false, error: error.message };

  await admin.from("audit_logs").insert({
    account_id: accountId,
    user_id: sa.userId,
    action: "superadmin.update_meta",
    target_type: "account",
    target_id: accountId,
    metadata: { patch, by: sa.email },
  });

  revalidatePath(`/superadmin/accounts/${accountId}`);
  return { ok: true };
}
