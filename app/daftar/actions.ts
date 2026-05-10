"use server";

import { createAdminClient } from "@/lib/supabase/admin";

type RedeemResult =
  | { ok: true; reward: string; trialEndsAt?: string }
  | { ok: false; error: string };

/**
 * Redeem a referral code after signup.
 * - Validates code is active, not deleted, not exceeded max_uses
 * - Applies reward (currently: extend_trial_days only — discount types stored
 *   as redemption record, applied later when billing kicks in)
 * - Inserts referral_redemptions row (UNIQUE per account_id, so 1 per account)
 *
 * Uses admin client to bypass RLS — this is server-side only and we've
 * already validated the user via auth.
 */
export async function redeemReferralCode(
  code: string,
  userId: string,
  accountId: string,
): Promise<RedeemResult> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Kode kosong" };

  const admin = createAdminClient();

  // Lookup code (case-insensitive, active, not deleted)
  const { data: codeRow, error: lookupErr } = await admin
    .from("referral_codes")
    .select("id, code, reward_type, reward_value, max_uses, uses_count, is_active, deleted_at")
    .ilike("code", trimmed)
    .is("deleted_at", null)
    .maybeSingle();

  if (lookupErr) return { ok: false, error: lookupErr.message };
  if (!codeRow) return { ok: false, error: "Kode referral tidak valid" };
  if (!codeRow.is_active) return { ok: false, error: "Kode sudah tidak aktif" };
  if (codeRow.max_uses !== null && codeRow.uses_count >= codeRow.max_uses) {
    return { ok: false, error: "Kode sudah mencapai batas pemakaian" };
  }

  // Check this account hasn't already redeemed (UNIQUE constraint will block,
  // but check first for nicer error)
  const { data: existing } = await admin
    .from("referral_redemptions")
    .select("id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (existing) return { ok: false, error: "Akun sudah pernah pakai kode referral" };

  // Apply reward based on type
  const appliedAction: Record<string, unknown> = {};
  let rewardLabel = "";

  if (codeRow.reward_type === "extend_trial_days") {
    // Extend trial by N days
    const { data: account, error: accErr } = await admin
      .from("accounts")
      .select("trial_ends_at, status")
      .eq("id", accountId)
      .maybeSingle();
    if (accErr || !account) {
      return { ok: false, error: "Akun tidak ditemukan" };
    }
    const currentEnds = account.trial_ends_at ? new Date(account.trial_ends_at) : new Date();
    const baseDate = currentEnds < new Date() ? new Date() : currentEnds;
    const newEnds = new Date(baseDate.getTime() + codeRow.reward_value * 24 * 60 * 60 * 1000);

    const { error: updErr } = await admin
      .from("accounts")
      .update({ trial_ends_at: newEnds.toISOString(), status: "trial" })
      .eq("id", accountId);
    if (updErr) return { ok: false, error: `Gagal extend trial: ${updErr.message}` };

    appliedAction.previous_trial_ends_at = account.trial_ends_at;
    appliedAction.new_trial_ends_at = newEnds.toISOString();
    appliedAction.added_days = codeRow.reward_value;
    rewardLabel = `Trial extended ${codeRow.reward_value} hari`;
  } else if (codeRow.reward_type === "months_free") {
    // Treat as N * 30 days extension to trial
    const days = codeRow.reward_value * 30;
    const { data: account } = await admin
      .from("accounts")
      .select("trial_ends_at")
      .eq("id", accountId)
      .maybeSingle();
    const currentEnds = account?.trial_ends_at ? new Date(account.trial_ends_at) : new Date();
    const baseDate = currentEnds < new Date() ? new Date() : currentEnds;
    const newEnds = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
    await admin
      .from("accounts")
      .update({ trial_ends_at: newEnds.toISOString(), status: "trial" })
      .eq("id", accountId);
    appliedAction.added_days = days;
    appliedAction.new_trial_ends_at = newEnds.toISOString();
    rewardLabel = `Gratis ${codeRow.reward_value} bulan`;
  } else {
    // discount_pct, discount_rp — store but don't apply (billing not live yet)
    appliedAction.note = "stored for future billing";
    rewardLabel =
      codeRow.reward_type === "discount_pct"
        ? `Diskon ${codeRow.reward_value}% berlangganan`
        : `Diskon Rp ${codeRow.reward_value.toLocaleString("id-ID")} berlangganan`;
  }

  // Insert redemption (trigger will increment uses_count)
  const { error: redeemErr } = await admin.from("referral_redemptions").insert({
    code_id: codeRow.id,
    account_id: accountId,
    user_id: userId,
    reward_type: codeRow.reward_type,
    reward_value: codeRow.reward_value,
    applied_action: appliedAction,
  });
  if (redeemErr) {
    return { ok: false, error: `Gagal simpan redemption: ${redeemErr.message}` };
  }

  return {
    ok: true,
    reward: rewardLabel,
    trialEndsAt: appliedAction.new_trial_ends_at as string | undefined,
  };
}

/**
 * Validate a referral code without redeeming. Used to give user feedback
 * before they submit the signup form.
 */
export async function validateReferralCode(
  code: string,
): Promise<{ ok: true; rewardLabel: string } | { ok: false; error: string }> {
  const trimmed = code.trim();
  if (!trimmed) return { ok: false, error: "Kode kosong" };

  const admin = createAdminClient();
  const { data: codeRow, error } = await admin
    .from("referral_codes")
    .select("code, reward_type, reward_value, max_uses, uses_count, is_active, deleted_at")
    .ilike("code", trimmed)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!codeRow) return { ok: false, error: "Kode tidak ditemukan" };
  if (!codeRow.is_active) return { ok: false, error: "Kode sudah tidak aktif" };
  if (codeRow.max_uses !== null && codeRow.uses_count >= codeRow.max_uses) {
    return { ok: false, error: "Kode sudah habis kuota pemakaian" };
  }

  let label = "";
  switch (codeRow.reward_type) {
    case "extend_trial_days":
      label = `Trial ${codeRow.reward_value} hari gratis`;
      break;
    case "months_free":
      label = `Gratis ${codeRow.reward_value} bulan`;
      break;
    case "discount_pct":
      label = `Diskon ${codeRow.reward_value}% berlangganan`;
      break;
    case "discount_rp":
      label = `Diskon Rp ${codeRow.reward_value.toLocaleString("id-ID")}`;
      break;
  }
  return { ok: true, rewardLabel: label };
}
