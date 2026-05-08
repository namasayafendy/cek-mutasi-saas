import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccountContext } from "@/lib/supabase/context";
import { AturanClient } from "./aturan-client";
import type { AccountSettings } from "@/lib/types";

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

  if (!ctx.settings) {
    return (
      <div className="card p-5 border-red-200 bg-red-50 text-red-800 text-sm">
        Settings belum ter-create. Logout & login ulang, atau hubungi support.
      </div>
    );
  }

  return (
    <AturanClient
      accountId={ctx.account.id}
      initialSettings={ctx.settings as AccountSettings}
    />
  );
}
