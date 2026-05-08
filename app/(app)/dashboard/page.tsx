import Link from "next/link";
import { getAccountContext, trialDaysRemaining } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateLong, parseDateISO } from "@/lib/format";
import { ArrowRight, Calendar, Store, FileSearch, Building2 } from "lucide-react";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  const { account, settings, member } = ctx;
  const isOwner = member.role === "owner";

  const supabase = await createClient();
  const [outletsRes, banksRes] = await Promise.all([
    supabase.from("outlets").select("id"),
    supabase.from("banks").select("id, is_active"),
  ]);

  const outletCount = outletsRes.data?.length ?? 0;
  const banksActive = (banksRes.data ?? []).filter((b) => b.is_active).length;

  const lastInputKreditStr = settings?.last_input_date_kredit ?? null;
  const lastInputDebetStr = settings?.last_input_date_debet ?? null;
  const lastKredit = lastInputKreditStr ? parseDateISO(lastInputKreditStr) : null;
  const lastDebet = lastInputDebetStr ? parseDateISO(lastInputDebetStr) : null;
  const trialDays = trialDaysRemaining(account);

  const setupComplete = outletCount > 0 && banksActive > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Halo{account.brand_name ? `, ${account.brand_name}` : ""}!
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {setupComplete
            ? "Mulai cek mutasi atau lihat aktivitas terbaru."
            : "Lengkapi setup dulu sebelum mulai cek mutasi."}
        </p>
      </div>

      {/* Onboarding kalau setup belum lengkap */}
      {isOwner && !setupComplete && (
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Lengkapi setup awal</h2>
          <p className="mt-1 text-sm text-amber-800">
            Sebelum cek mutasi, Anda perlu setup minimal: 1 outlet (lokasi/cabang) +
            1 rekening bank yang aktif.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {outletCount === 0 && (
              <Link href="/outlets" className="btn-primary">
                + Tambah Outlet Pertama
              </Link>
            )}
            {banksActive === 0 && (
              <Link href="/banks" className="btn-primary">
                + Tambah Bank Pertama
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Calendar className="h-4 w-4" />
            <span>Terakhir input kredit</span>
          </div>
          <p className="mt-2 text-base font-semibold text-slate-900">
            {lastKredit ? formatDateLong(lastKredit) : "Belum pernah"}
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Calendar className="h-4 w-4" />
            <span>Terakhir input debet</span>
          </div>
          <p className="mt-2 text-base font-semibold text-slate-900">
            {lastDebet ? formatDateLong(lastDebet) : "Belum pernah"}
          </p>
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Store className="h-4 w-4" />
            <span>Outlet</span>
          </div>
          <p className="mt-2 text-base font-semibold text-slate-900">{outletCount}</p>
          {isOwner && (
            <Link
              href="/outlets"
              className="mt-1 inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
            >
              Kelola <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <Building2 className="h-4 w-4" />
            <span>Bank aktif</span>
          </div>
          <p className="mt-2 text-base font-semibold text-slate-900">{banksActive}</p>
          {isOwner && (
            <Link
              href="/banks"
              className="mt-1 inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
            >
              Kelola <ArrowRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>

      {setupComplete && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-5 bg-slate-900 text-white border-slate-900">
            <div className="flex items-center gap-2 text-slate-300 text-sm">
              <FileSearch className="h-4 w-4" />
              <span>Cek Transaksi Masuk</span>
            </div>
            <p className="mt-2 text-lg font-semibold">Cek Mutasi Kredit</p>
            <Link
              href="/check?jenis=kredit"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-100"
            >
              Mulai <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="card p-5 bg-slate-700 text-white border-slate-700">
            <div className="flex items-center gap-2 text-slate-300 text-sm">
              <FileSearch className="h-4 w-4" />
              <span>Cek Transaksi Keluar</span>
            </div>
            <p className="mt-2 text-lg font-semibold">Cek Mutasi Debet</p>
            <Link
              href="/check?jenis=debet"
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Mulai <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* Trial info */}
      {account.status === "trial" && trialDays !== null && (
        <div className="card p-5 text-sm text-slate-600">
          <p>
            Anda sedang dalam masa trial — sisa <strong>{trialDays} hari</strong>.
            {isOwner && (
              <>
                {" "}
                <Link href="/akun" className="text-slate-900 hover:underline font-medium">
                  Upgrade ke Pro
                </Link>{" "}
                untuk lanjut pakai setelah trial habis.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
