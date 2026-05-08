import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext, isSubscriptionUsable, trialDaysRemaining } from "@/lib/supabase/context";
import { LogoutButton } from "./logout-button";
import { AlertTriangle } from "lucide-react";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const { user, account, member } = ctx;
  const isOwner = member.role === "owner";
  const usable = isSubscriptionUsable(account);
  const trialDays = trialDaysRemaining(account);

  return (
    <div className="flex flex-1 flex-col">
      {/* Subscription status banner */}
      {!usable && (
        <div className="bg-red-600 text-white text-sm px-4 py-2 text-center">
          <AlertTriangle className="inline-block h-4 w-4 mr-1" />
          {account.status === "trial"
            ? "Trial Anda sudah habis. Upgrade untuk lanjut pakai."
            : account.status === "suspended"
              ? "Akun Anda di-suspend. Hubungi support."
              : "Akun Anda dibatalkan."}
          {isOwner && (
            <Link href="/akun" className="ml-2 underline font-medium">
              Akun & Tagihan
            </Link>
          )}
        </div>
      )}
      {usable && account.status === "trial" && trialDays !== null && trialDays <= 3 && (
        <div className="bg-amber-100 text-amber-900 text-sm px-4 py-2 text-center">
          Trial sisa {trialDays} hari.
          {isOwner && (
            <Link href="/akun" className="ml-2 underline font-medium">
              Upgrade sekarang
            </Link>
          )}
        </div>
      )}

      <nav className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-6">
              <Link href="/dashboard" className="font-semibold text-slate-900">
                {account.brand_name || "Cek Mutasi"}
              </Link>
              <div className="hidden sm:flex items-center gap-4 text-sm">
                <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                  Dashboard
                </Link>
                <Link href="/check" className="text-slate-600 hover:text-slate-900">
                  Cek Mutasi
                </Link>
                <Link href="/history" className="text-slate-600 hover:text-slate-900">
                  History
                </Link>
                <Link href="/rekap" className="text-slate-600 hover:text-slate-900">
                  Rekap
                </Link>
                {isOwner && (
                  <>
                    <Link href="/outlets" className="text-slate-600 hover:text-slate-900">
                      Outlet
                    </Link>
                    <Link href="/banks" className="text-slate-600 hover:text-slate-900">
                      Bank
                    </Link>
                    <Link href="/aturan" className="text-slate-600 hover:text-slate-900">
                      Aturan
                    </Link>
                    <Link href="/staff" className="text-slate-600 hover:text-slate-900">
                      Staff
                    </Link>
                    <Link href="/activity" className="text-slate-600 hover:text-slate-900">
                      Activity
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isOwner && account.status === "trial" && trialDays !== null && trialDays > 3 && (
                <span className="hidden sm:inline text-xs text-slate-500">
                  Trial: {trialDays} hari
                </span>
              )}
              <span className="hidden sm:inline text-xs text-slate-500">
                {user.email}
              </span>
              <LogoutButton />
            </div>
          </div>
        </div>
      </nav>
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
