import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext, isSubscriptionUsable, trialDaysRemaining } from "@/lib/supabase/context";
import { LogoutButton } from "./logout-button";
import { AlertTriangle, Shield } from "lucide-react";
import { isSuperadminEmail } from "@/lib/supabase/context";
import { IdleTimeout } from "./idle-timeout";
import { LogoIcon, LogoWordmark } from "@/app/logo";
import { MobileNav } from "./mobile-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const { user, account, member } = ctx;
  const isOwner = member.role === "owner";
  const isSuperadmin = isSuperadminEmail(user.email);
  const usable = isSubscriptionUsable(account);
  const trialDays = trialDaysRemaining(account);

  return (
    <div className="flex flex-1 flex-col">
      <IdleTimeout />
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
              <Link
                href="/dashboard"
                className="inline-flex items-center"
                aria-label={account.brand_name || "CekTransfer"}
              >
                {account.brand_name ? (
                  <span className="inline-flex items-center gap-2">
                    <LogoIcon size="md" />
                    <span className="font-semibold text-slate-900">{account.brand_name}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <LogoIcon size="md" />
                    <LogoWordmark size="md" showTld={false} />
                  </span>
                )}
              </Link>
              <div className="hidden sm:flex items-center gap-4 text-sm">
                <Link href="/dashboard" className="text-slate-600 hover:text-slate-900">
                  Dashboard
                </Link>
                <Link href="/history" className="text-slate-600 hover:text-slate-900">
                  History
                </Link>
                {/* Penutupan Lapis 2. Sengaja bersebelahan dengan Riwayat:
                    keduanya dibuka untuk pertanyaan yang sama — "baris mutasi
                    ini milik siapa" — dan memisahkannya membuat yang satu
                    dicari lewat yang lain. */}
                <Link href="/belum-cocok" className="text-slate-600 hover:text-slate-900">
                  Belum Cocok
                </Link>
                <Link href="/rekap" className="text-slate-600 hover:text-slate-900">
                  Rekap
                </Link>
                {isOwner && (
                  <Link href="/activity" className="text-slate-600 hover:text-slate-900">
                    Activity
                  </Link>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              {isOwner && account.status === "trial" && trialDays !== null && trialDays > 3 && (
                <span className="hidden sm:inline text-xs text-slate-500">
                  Trial: {trialDays} hari
                </span>
              )}
              {isSuperadmin && (
                <Link
                  href="/superadmin"
                  className="hidden sm:inline-flex items-center gap-1 text-xs text-purple-700 hover:text-purple-900 font-medium"
                  title="Super-admin platform"
                >
                  <Shield className="h-3.5 w-3.5" /> Admin
                </Link>
              )}
              <span className="hidden sm:inline text-xs text-slate-500">
                {user.email}
              </span>
              <LogoutButton />
              <MobileNav
                isOwner={isOwner}
                isSuperadmin={isSuperadmin}
                userEmail={user.email}
              />
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
