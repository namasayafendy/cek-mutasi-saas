import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { OutletsClient } from "./outlets-client";
import type { Outlet } from "@/lib/types";
import Link from "next/link";

export default async function OutletsPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  if (ctx.member.role !== "owner") {
    return (
      <div className="card p-5 border-amber-200 bg-amber-50 text-amber-800 text-sm">
        Hanya owner yang bisa kelola outlet.{" "}
        <Link href="/dashboard" className="font-medium underline">
          Kembali ke Dashboard
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outlets")
    .select("*")
    .order("urutan_palette", { ascending: true });

  if (error) {
    return (
      <div className="card p-5 border-red-200 bg-red-50 text-red-800 text-sm">
        Gagal memuat outlet: {error.message}
      </div>
    );
  }

  return (
    <OutletsClient
      initialOutlets={(data ?? []) as Outlet[]}
      accountId={ctx.account.id}
    />
  );
}
