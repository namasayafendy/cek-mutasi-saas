import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { CheckClient } from "./check-client";
import { getParserSpec } from "@/lib/banks/registry";
import type { Outlet, Bank, Jenis } from "@/lib/types";

export default async function CheckPage({
  searchParams,
}: {
  searchParams: Promise<{ jenis?: string }>;
}) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const params = await searchParams;
  const jenis: Jenis = params.jenis === "debet" ? "debet" : "kredit";

  const supabase = await createClient();
  const [outletsRes, banksRes] = await Promise.all([
    supabase.from("outlets").select("*").order("urutan_palette"),
    supabase
      .from("banks")
      .select("*")
      .eq("is_active", true)
      .order("urutan")
      .order("created_at"),
  ]);

  const outlets = (outletsRes.data ?? []) as Outlet[];
  const allActiveBanks = (banksRes.data ?? []) as Bank[];

  // Filter ke parser yang ready saja
  const readyBanks = allActiveBanks.filter((b) => {
    const spec = getParserSpec(b.parser_id);
    return spec?.status === "ready";
  });

  if (outlets.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"}
          </h1>
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

  if (readyBanks.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"}
          </h1>
        </div>
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Belum ada bank ready</h2>
          <p className="mt-1 text-sm text-amber-800">
            Belum ada bank yang status-nya &ldquo;Ready&rdquo;. Tambah bank di menu Bank, atau
            tunggu update parser bank Anda dirilis.
          </p>
          <Link href="/banks" className="btn-primary mt-3">
            Kelola bank
          </Link>
        </div>
      </div>
    );
  }

  return (
    <CheckClient
      outlets={outlets}
      banks={readyBanks}
      jenis={jenis}
      accountId={ctx.account.id}
      userId={ctx.user.id}
      settings={ctx.settings}
    />
  );
}
