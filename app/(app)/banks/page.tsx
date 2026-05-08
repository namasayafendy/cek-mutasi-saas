import { redirect } from "next/navigation";
import Link from "next/link";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { BanksClient } from "./banks-client";
import type { Bank } from "@/lib/types";

export default async function BanksPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  if (ctx.member.role !== "owner") {
    return (
      <div className="card p-5 border-amber-200 bg-amber-50 text-amber-800 text-sm">
        Hanya owner yang bisa kelola bank.{" "}
        <Link href="/dashboard" className="font-medium underline">
          Kembali ke Dashboard
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("banks")
    .select("*")
    .order("urutan", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return (
      <div className="card p-5 border-red-200 bg-red-50 text-red-800 text-sm">
        Gagal memuat bank: {error.message}
      </div>
    );
  }

  return (
    <BanksClient
      initialBanks={(data ?? []) as Bank[]}
      accountId={ctx.account.id}
    />
  );
}
