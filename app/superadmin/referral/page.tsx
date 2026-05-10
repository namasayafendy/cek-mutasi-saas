import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperadminEmail } from "@/lib/supabase/context";
import ReferralClient from "./referral-client";

export default async function ReferralPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isSuperadminEmail(user.email)) redirect("/dashboard");

  // Fetch all codes via admin (bypass RLS)
  const admin = createAdminClient();
  const { data: codes, error } = await admin
    .from("referral_codes")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <ReferralClient
      codes={(codes ?? []) as ReferralCodeRow[]}
      currentUserId={user.id}
      error={error?.message ?? null}
    />
  );
}

export type ReferralCodeRow = {
  id: string;
  code: string;
  description: string | null;
  reward_type: "extend_trial_days" | "discount_pct" | "discount_rp" | "months_free";
  reward_value: number;
  max_uses: number | null;
  uses_count: number;
  is_active: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
};
