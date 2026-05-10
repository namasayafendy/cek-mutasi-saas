"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperadminEmail } from "@/lib/supabase/context";
import { revalidatePath } from "next/cache";

async function ensureSuperadmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Tidak ada session");
  if (!isSuperadminEmail(user.email)) throw new Error("Bukan superadmin");
  return user;
}

type RewardType = "extend_trial_days" | "discount_pct" | "discount_rp" | "months_free";

export async function createReferralCode(input: {
  code: string;
  description?: string;
  rewardType: RewardType;
  rewardValue: number;
  maxUses?: number | null;
  notes?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await ensureSuperadmin();
    if (!input.code.trim()) return { ok: false, error: "Kode wajib diisi" };
    if (input.rewardValue <= 0) return { ok: false, error: "Reward value harus > 0" };

    const admin = createAdminClient();
    const { error } = await admin.from("referral_codes").insert({
      code: input.code.trim().toUpperCase(),
      description: input.description?.trim() || null,
      reward_type: input.rewardType,
      reward_value: input.rewardValue,
      max_uses: input.maxUses && input.maxUses > 0 ? input.maxUses : null,
      notes: input.notes?.trim() || null,
      created_by: user.id,
    });

    if (error) return { ok: false, error: error.message };
    revalidatePath("/superadmin/referral");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function toggleReferralCode(
  codeId: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    const admin = createAdminClient();
    const { error } = await admin
      .from("referral_codes")
      .update({ is_active: isActive })
      .eq("id", codeId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/superadmin/referral");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export async function deleteReferralCode(
  codeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await ensureSuperadmin();
    const admin = createAdminClient();
    const { error } = await admin
      .from("referral_codes")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", codeId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/superadmin/referral");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}
