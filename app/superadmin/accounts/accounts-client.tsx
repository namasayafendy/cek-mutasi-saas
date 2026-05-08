"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Filter, Search, RotateCcw } from "lucide-react";
import { formatDateLong, parseDateISO } from "@/lib/format";

type EnrichedAccount = {
  id: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  brand_name: string | null;
  support_email: string | null;
  ownerEmail: string | null;
  staffCount: number;
  sessionCount30d: number;
  lastSessionAt: string | null;
  created_at: string;
};

type StatusFilter = "all" | "trial" | "trial_expired" | "active" | "suspended" | "cancelled";

export default function AccountsClient({ accounts }: { accounts: EnrichedAccount[] }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const now = useMemo(() => new Date(), []);

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      // Status filter
      if (statusFilter !== "all") {
        if (statusFilter === "trial") {
          const isActive =
            a.status === "trial" && (!a.trial_ends_at || new Date(a.trial_ends_at) > now);
          if (!isActive) return false;
        } else if (statusFilter === "trial_expired") {
          const isExpired =
            a.status === "trial" && a.trial_ends_at && new Date(a.trial_ends_at) <= now;
          if (!isExpired) return false;
        } else if (a.status !== statusFilter) {
          return false;
        }
      }
      // Search
      if (search) {
        const q = search.toLowerCase();
        const hay = [a.brand_name, a.ownerEmail, a.support_email, a.id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, statusFilter, search, now]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Accounts</h1>
        <p className="mt-1 text-sm text-slate-600">
          Semua tenant di platform. Klik baris untuk detail + tools.
        </p>
      </div>

      {/* Filter bar */}
      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="text-xs text-slate-500 flex items-center gap-1">
            <Search className="h-3 w-3" /> Cari
          </label>
          <input
            type="text"
            placeholder="Brand, email owner, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input mt-1"
          />
        </div>
        <div>
          <label className="text-xs text-slate-500 flex items-center gap-1">
            <Filter className="h-3 w-3" /> Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="input mt-1 min-w-[160px]"
          >
            <option value="all">Semua ({accounts.length})</option>
            <option value="trial">Trial aktif</option>
            <option value="trial_expired">Trial expired</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button
          onClick={() => {
            setStatusFilter("all");
            setSearch("");
          }}
          className="chip inline-flex items-center gap-1"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
        <div className="ml-auto text-sm text-slate-600">
          {filtered.length} dari {accounts.length}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Tidak ada account sesuai filter.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Brand / Owner
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Daftar
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Staff
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Sesi 30d
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Last activity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filtered.map((a) => {
                const trialEnd = a.trial_ends_at ? parseDateISO(a.trial_ends_at.split("T")[0]) : null;
                const trialExpired =
                  a.status === "trial" && a.trial_ends_at && new Date(a.trial_ends_at) <= now;
                const lastSession = a.lastSessionAt ? new Date(a.lastSessionAt) : null;
                const inactive = !a.lastSessionAt;
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/superadmin/accounts/${a.id}`}
                        className="font-medium text-slate-900 hover:text-slate-700"
                      >
                        {a.brand_name || `Account ${a.id.slice(0, 8)}`}
                      </Link>
                      <div className="text-xs text-slate-500">{a.ownerEmail ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={a.status} expired={!!trialExpired} />
                      {a.status === "trial" && trialEnd && (
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {trialExpired ? "Habis " : "Sd "}
                          {formatDateLong(trialEnd)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {formatDateLong(new Date(a.created_at))}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{a.staffCount}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {a.sessionCount30d}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {lastSession ? (
                        <span className="text-slate-700">{formatDateLong(lastSession)}</span>
                      ) : (
                        <span className="text-amber-700">Belum pernah cek</span>
                      )}
                      {inactive && a.status === "active" && (
                        <div className="text-[10px] text-amber-700 mt-0.5">⚠ Active tapi idle</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, expired }: { status: string; expired: boolean }) {
  if (status === "trial") {
    return (
      <span
        className={`inline-flex items-center rounded-full text-xs px-2 py-0.5 ${
          expired ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
        }`}
      >
        {expired ? "Trial expired" : "Trial"}
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center rounded-full bg-green-50 text-green-700 text-xs px-2 py-0.5">
        Active
      </span>
    );
  }
  if (status === "suspended") {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 text-xs px-2 py-0.5">
        Suspended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-50 text-slate-600 text-xs px-2 py-0.5">
      Cancelled
    </span>
  );
}
