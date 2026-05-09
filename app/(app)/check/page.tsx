import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { CheckClient } from "./check-client";
import { getParserSpec } from "@/lib/banks/registry";
import type { Outlet, Bank, Jenis, MatchRulePreset } from "@/lib/types";

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
  const [outletsRes, banksRes, rulesRes] = await Promise.all([
    supabase.from("outlets").select("*").order("urutan_palette"),
    supabase
      .from("banks")
      .select("*")
      .eq("is_active", true)
      .order("urutan")
      .order("created_at"),
    supabase
      .from("match_rules")
      .select("*")
      .is("deleted_at", null)
      .or(`jenis.eq.${jenis},jenis.eq.both`)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true }),
  ]);

  const outlets = (outletsRes.data ?? []) as Outlet[];
  const allActiveBanks = (banksRes.data ?? []) as Bank[];
  const rules = (rulesRes.data ?? []) as MatchRulePreset[];

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

  if (rules.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"}
          </h1>
        </div>
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Belum ada aturan matching</h2>
          <p className="mt-1 text-sm text-amber-800">
            Sebelum cek mutasi, Anda perlu set minimal 1 aturan matching (lookback,
            tolerance, dll). Buat preset &quot;QRIS&quot;, &quot;EDC Settle&quot;, atau pakai default.
          </p>
          <Link href="/aturan" className="btn-primary mt-3">
            Kelola aturan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <CheckClient
      outlets={outlets}
      banks={readyBanks}
      rules={rules}
      jenis={jenis}
      accountId={ctx.account.id}
      userId={ctx.user.id}
    />
  );
}
