import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { AturanClient } from "./aturan-client";
import type { MatchRulePreset } from "@/lib/types";

export default async function AturanPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  if (ctx.member.role !== "owner") {
    return (
      <div className="card p-5 border-amber-200 bg-amber-50 text-amber-800 text-sm">
        Hanya owner yang bisa atur rules.{" "}
        <Link href="/dashboard" className="font-medium underline">
          Kembali ke Dashboard
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: rulesData } = await supabase
    .from("match_rules")
    .select("*")
    .is("deleted_at", null)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });
  const rules = (rulesData ?? []) as MatchRulePreset[];

  return <AturanClient initialRules={rules} accountId={ctx.account.id} />;
}
