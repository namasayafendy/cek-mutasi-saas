import { createClient } from "@/lib/supabase/server";
import { OutletsClient } from "./outlets-client";
import type { Outlet } from "@/lib/types";

export default async function OutletsPage() {
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

  return <OutletsClient initialOutlets={(data ?? []) as Outlet[]} />;
}
