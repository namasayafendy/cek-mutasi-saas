import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import HistoryCekClient from "./history-cek-client";
import type { Outlet, Bank, Jenis, MatchRulePreset } from "@/lib/types";

// Cek Mutasi dari History: bulk-claim parsed_transactions yang belum ke-claim,
// tanpa upload PDF baru. Ada 2 rute statis: /cek-history/kredit dan /cek-history/debet.

export default async function CekHistoryPage({
  params,
}: {
  params: Promise<{ jenis: string }>;
}) {
  const { jenis: jenisParam } = await params;
  if (jenisParam !== "kredit" && jenisParam !== "debet") notFound();
  const jenis: Jenis = jenisParam;

  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

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
  const banks = (banksRes.data ?? []) as Bank[];
  const rules = (rulesRes.data ?? []) as MatchRulePreset[];

  if (outlets.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"} dari History
        </h1>
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

  if (banks.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"} dari History
        </h1>
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Belum ada bank aktif</h2>
          <p className="mt-1 text-sm text-amber-800">
            Aktifkan minimal 1 bank di menu Bank.
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
        <h1 className="text-2xl font-semibold text-slate-900">
          Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"} dari History
        </h1>
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Belum ada aturan matching</h2>
          <p className="mt-1 text-sm text-amber-800">
            Buat minimal 1 aturan matching dulu di menu Aturan.
          </p>
          <Link href="/aturan" className="btn-primary mt-3">
            Kelola aturan
          </Link>
        </div>
      </div>
    );
  }

  return (
    <HistoryCekClient
      outlets={outlets}
      banks={banks}
      rules={rules}
      jenis={jenis}
      accountId={ctx.account.id}
      userId={ctx.user.id}
      debetHighlightSameColor={ctx.settings?.debet_highlight_same_color ?? true}
      gadaiSyncEnabled={(ctx.settings as { gadai_sync_enabled?: boolean } | null)?.gadai_sync_enabled ?? false}
    />
  );
}
