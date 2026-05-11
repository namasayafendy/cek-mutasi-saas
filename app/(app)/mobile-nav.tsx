"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X, Activity, Shield } from "lucide-react";

export function MobileNav({
  isOwner,
  isSuperadmin,
  userEmail,
}: {
  isOwner: boolean;
  isSuperadmin: boolean;
  userEmail: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Hamburger button — only visible on mobile */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buka menu"
        className="sm:hidden inline-flex items-center justify-center w-9 h-9 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 sm:hidden"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute right-0 top-0 bottom-0 w-72 bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-[#0F2E1F]">Menu</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Tutup menu"
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-3">
              <MenuLink href="/dashboard" onClick={() => setOpen(false)}>
                Dashboard
              </MenuLink>
              <MenuLink href="/history" onClick={() => setOpen(false)}>
                History
              </MenuLink>
              <MenuLink href="/rekap" onClick={() => setOpen(false)}>
                Rekap
              </MenuLink>

              {isOwner && (
                <>
                  <div className="my-2 border-t border-slate-100" />
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-3 py-1.5">
                    Setup (Owner)
                  </div>
                  <MenuLink href="/outlets" onClick={() => setOpen(false)}>
                    Outlet
                  </MenuLink>
                  <MenuLink href="/banks" onClick={() => setOpen(false)}>
                    Bank
                  </MenuLink>
                  <MenuLink href="/aturan" onClick={() => setOpen(false)}>
                    Aturan
                  </MenuLink>
                  <MenuLink href="/staff" onClick={() => setOpen(false)}>
                    Staff
                  </MenuLink>
                  <MenuLink
                    href="/activity"
                    onClick={() => setOpen(false)}
                    icon={<Activity className="h-4 w-4" />}
                  >
                    Activity
                  </MenuLink>
                  <MenuLink href="/akun" onClick={() => setOpen(false)}>
                    Akun &amp; Tagihan
                  </MenuLink>
                </>
              )}

              {isSuperadmin && (
                <>
                  <div className="my-2 border-t border-slate-100" />
                  <MenuLink
                    href="/superadmin"
                    onClick={() => setOpen(false)}
                    icon={<Shield className="h-4 w-4 text-purple-700" />}
                  >
                    Admin Platform
                  </MenuLink>
                </>
              )}
            </nav>

            {userEmail && (
              <div className="px-5 py-3 border-t border-slate-100 text-xs text-slate-500 truncate">
                {userEmail}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MenuLink({
  href,
  onClick,
  icon,
  children,
}: {
  href: string;
  onClick: () => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2.5 rounded-md text-sm text-slate-700 hover:bg-[#10B981]/10 hover:text-[#0F2E1F] active:bg-[#10B981]/15"
    >
      {icon}
      {children}
    </Link>
  );
}
