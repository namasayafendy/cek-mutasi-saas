import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSuperadminEmail } from "@/lib/supabase/context";
import { LogoutButton } from "../(app)/logout-button";
import { Shield, Users, LayoutDashboard, Gift } from "lucide-react";
import { LogoIcon, LogoWordmark } from "@/app/logo";

export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isSuperadminEmail(user.email)) redirect("/dashboard");

  return (
    <div className="flex flex-1 flex-col bg-slate-50">
      <div className="bg-purple-700 text-white text-xs px-4 py-1 text-center font-medium">
        <Shield className="inline-block h-3 w-3 mr-1 -mt-0.5" />
        Mode Super-Admin Platform
      </div>
      <nav className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-6">
              <Link
                href="/superadmin"
                className="inline-flex items-center gap-2"
                aria-label="CekTransfer Admin"
              >
                <LogoIcon size="md" />
                <span className="inline-flex items-center gap-1.5">
                  <LogoWordmark size="md" showTld={false} />
                  <span className="text-slate-400">·</span>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-purple-700">
                    <Shield className="h-3.5 w-3.5" /> Admin
                  </span>
                </span>
              </Link>
              <div className="hidden sm:flex items-center gap-4 text-sm">
                <Link
                  href="/superadmin"
                  className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
                </Link>
                <Link
                  href="/superadmin/accounts"
                  className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
                >
                  <Users className="h-3.5 w-3.5" /> Accounts
                </Link>
                <Link
                  href="/superadmin/referral"
                  className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
                >
                  <Gift className="h-3.5 w-3.5" /> Referral
                </Link>
                <Link href="/dashboard" className="text-slate-500 hover:text-slate-700 text-xs">
                  ← Kembali ke aplikasi
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-xs text-slate-500">{user.email}</span>
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
