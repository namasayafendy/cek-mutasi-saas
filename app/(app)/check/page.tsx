import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import type { Outlet } from "@/lib/types";
import { CheckClient } from "./check-client";

export default async function CheckPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const { data: outlets } = await supabase
    .from("outlets")
    .select("*")
    .order("urutan_palette");

  if (!outlets || outlets.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Cek Mutasi</h1>
          <p className="mt-1 text-sm text-slate-600">
            Upload PDF mutasi BSI dan input transferan tebusan per outlet.
          </p>
        </div>
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Tambah outlet dulu</h2>
          <p className="mt-1 text-sm text-amber-800">
            Sebelum cek mutasi, Anda perlu tambah minimal satu outlet supaya bisa
            mengkategorikan transferan.
          </p>
          <Link href="/outlets" className="btn-primary mt-3">
            Kelola outlet
          </Link>
        </div>
      </div>
    );
  }

  return <CheckClient outlets={outlets as Outlet[]} accountId={ctx.account.id} />;
}
