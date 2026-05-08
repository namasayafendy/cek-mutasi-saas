import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateLong, parseDateISO } from "@/lib/format";
import { ArrowRight, Calendar, Store, FileSearch } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [outletsRes, settingsRes] = await Promise.all([
    supabase.from("outlets").select("id").order("urutan_palette"),
    supabase.from("user_settings").select("last_input_date").maybeSingle(),
  ]);

  const outletCount = outletsRes.data?.length ?? 0;
  const lastInputDateStr = settingsRes.data?.last_input_date as string | null | undefined;
  const lastInputDate = lastInputDateStr ? parseDateISO(lastInputDateStr) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-600">
          Halo! Mulai cek mutasi atau atur outlet di sini.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Calendar className="h-4 w-4" />
            <span>Terakhir input</span>
          </div>
          <p className="mt-2 text-lg font-semibold text-slate-900">
            {lastInputDate ? formatDateLong(lastInputDate) : "Belum pernah"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {lastInputDate
              ? "Tanggal terakhir Anda input mutasi. Lanjut dari sini."
              : "Belum ada catatan. Setelah cek pertama, akan tercatat di sini."}
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Store className="h-4 w-4" />
            <span>Outlet terdaftar</span>
          </div>
          <p className="mt-2 text-lg font-semibold text-slate-900">{outletCount} outlet</p>
          <Link
            href="/outlets"
            className="mt-1 inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
          >
            Kelola outlet <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="card p-5 bg-slate-900 text-white border-slate-900">
          <div className="flex items-center gap-2 text-slate-300 text-sm">
            <FileSearch className="h-4 w-4" />
            <span>Aksi cepat</span>
          </div>
          <p className="mt-2 text-lg font-semibold">Mulai cek mutasi</p>
          <Link
            href="/check"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-100"
          >
            Upload PDF <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {outletCount === 0 && (
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Belum ada outlet</h2>
          <p className="mt-1 text-sm text-amber-800">
            Tambah outlet dulu (misal: Lhokseumawe, Bireuen, dst) supaya saat cek mutasi
            Anda bisa pilih outlet untuk tiap input. Tiap outlet akan otomatis dapat warna
            highlight yang berbeda.
          </p>
          <Link href="/outlets" className="btn-primary mt-3">
            Tambah outlet pertama
          </Link>
        </div>
      )}
    </div>
  );
}
