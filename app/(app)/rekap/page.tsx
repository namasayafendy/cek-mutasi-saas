import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import RekapClient from "./rekap-client";

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

export default async function RekapPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const [outletsRes, banksRes] = await Promise.all([
    supabase.from("outlets").select("id, nama, warna_hex").order("urutan_palette"),
    supabase.from("banks").select("id, kode, label").order("urutan"),
  ]);

  const outlets = (outletsRes.data ?? []) as OutletLite[];
  const banks = (banksRes.data ?? []) as BankLite[];

  return (
    <RekapClient
      outlets={outlets}
      banks={banks}
      brandName={ctx.account.brand_name || "CekTransfer"}
    />
  );
}
