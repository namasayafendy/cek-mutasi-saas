import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatRupiah, formatDateLong } from "@/lib/format";
import {
  Users,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Activity,
} from "lucide-react";

type AccountRow = {
  id: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  brand_name: string | null;
  created_at: string;
};

type SessionRow = {
  account_id: string;
  created_at: string;
};

function priceRp(): number {
  const v = parseInt(process.env.SUBSCRIPTION_PRICE_RP ?? "50000", 10);
  return isNaN(v) ? 50000 : v;
}

export default async function SuperadminDashboardPage() {
  const admin = createAdminClient();

  const now = new Date();
  const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [accountsRes, sessionsRes, recentSignups] = await Promise.all([
    admin
      .from("accounts")
      .select(
        "id, status, trial_ends_at, current_period_end, cancelled_at, brand_name, created_at",
      ),
    admin
      .from("cek_sessions")
      .select("account_id, created_at")
      .gte("created_at", sevenDaysAgo.toISOString()),
    admin
      .from("accounts")
      .select(
        "id, status, trial_ends_at, current_period_end, cancelled_at, brand_name, created_at",
      )
      .gte("created_at", monthAgo.toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const allAccounts = (accountsRes.data ?? []) as AccountRow[];
  const recentSessions = (sessionsRes.data ?? []) as SessionRow[];
  const recent = (recentSignups.data ?? []) as AccountRow[];

  // Status buckets
  const trialActive = allAccounts.filter(
    (a) => a.status === "trial" && (!a.trial_ends_at || new Date(a.trial_ends_at) > now),
  );
  const trialExpired = allAccounts.filter(
    (a) => a.status === "trial" && a.trial_ends_at && new Date(a.trial_ends_at) <= now,
  );
  const active = allAccounts.filter((a) => a.status === "active");
  const suspended = allAccounts.filter((a) => a.status === "suspended");
  const cancelled = allAccounts.filter((a) => a.status === "cancelled");

  // MRR = active count × price
  const mrr = active.length * priceRp();

  // Conversion rate (active / non-cancelled total)
  const convertable = trialActive.length + trialExpired.length + active.length + suspended.length;
  const convRate = convertable > 0 ? (active.length / convertable) * 100 : 0;

  // Churn rate this month
  const churnedThisMonth = allAccounts.filter(
    (a) =>
      a.status === "cancelled" &&
      a.cancelled_at &&
      new Date(a.cancelled_at) >= monthAgo,
  ).length;
  const monthStartActive = active.length + churnedThisMonth;
  const churnRate = monthStartActive > 0 ? (churnedThisMonth / monthStartActive) * 100 : 0;

  // Active accounts this week (≥1 session)
  const activeThisWeek = new Set(recentSessions.map((s) => s.account_id)).size;

  // Trials expiring soon (3 hari)
  const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const expiringSoon = trialActive.filter(
    (a) => a.trial_ends_at && new Date(a.trial_ends_at) <= threeDays,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <Activity className="h-6 w-6 text-purple-700" />
          Platform Dashboard
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Overview metrics semua tenant di platform Cek Mutasi.
        </p>
      </div>

      {/* Big number cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-slate-500 flex items-center gap-1">
            <Users className="h-3 w-3" /> Total Account
          </div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{allAccounts.length}</div>
          <div className="text-xs text-slate-500 mt-1">
            {trialActive.length} trial · {active.length} active · {cancelled.length} cancelled
          </div>
        </div>
        <div className="card p-4 bg-green-50 border-green-200">
          <div className="text-xs text-green-700 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> MRR (estimasi)
          </div>
          <div className="mt-1 text-2xl font-semibold text-green-700">
            Rp {formatRupiah(mrr)}
          </div>
          <div className="text-xs text-green-700 mt-1">
            {active.length} active × Rp {formatRupiah(priceRp())}
          </div>
        </div>
        <div className="card p-4 bg-blue-50 border-blue-200">
          <div className="text-xs text-blue-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Trial → Active conversion
          </div>
          <div className="mt-1 text-2xl font-semibold text-blue-700">
            {convRate.toFixed(1)}%
          </div>
          <div className="text-xs text-blue-700 mt-1">
            dari {convertable} potential customer
          </div>
        </div>
        <div className="card p-4 bg-amber-50 border-amber-200">
          <div className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Churn (30 hari)
          </div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">
            {churnRate.toFixed(1)}%
          </div>
          <div className="text-xs text-amber-700 mt-1">
            {churnedThisMonth} cancelled bulan ini
          </div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatusCard
          label="Trial aktif"
          count={trialActive.length}
          icon={<Clock className="h-3 w-3" />}
          color="text-blue-700 bg-blue-50 border-blue-200"
        />
        <StatusCard
          label="Trial expired"
          count={trialExpired.length}
          icon={<AlertTriangle className="h-3 w-3" />}
          color="text-red-700 bg-red-50 border-red-200"
        />
        <StatusCard
          label="Active"
          count={active.length}
          icon={<CheckCircle2 className="h-3 w-3" />}
          color="text-green-700 bg-green-50 border-green-200"
        />
        <StatusCard
          label="Suspended"
          count={suspended.length}
          icon={<AlertTriangle className="h-3 w-3" />}
          color="text-amber-700 bg-amber-50 border-amber-200"
        />
        <StatusCard
          label="Cancelled"
          count={cancelled.length}
          icon={<XCircle className="h-3 w-3" />}
          color="text-slate-600 bg-slate-50 border-slate-200"
        />
      </div>

      {/* Activity & expiring */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="font-medium text-slate-900 flex items-center gap-1.5">
            <Activity className="h-4 w-4" /> Engagement minggu ini
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">Account aktif (≥1 sesi)</div>
              <div className="text-xl font-semibold text-slate-900">{activeThisWeek}</div>
              <div className="text-xs text-slate-500">
                dari {allAccounts.length} total ({((activeThisWeek / Math.max(1, allAccounts.length)) * 100).toFixed(0)}%)
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Total sesi minggu ini</div>
              <div className="text-xl font-semibold text-slate-900">{recentSessions.length}</div>
              <div className="text-xs text-slate-500">
                rata {(recentSessions.length / Math.max(1, activeThisWeek)).toFixed(1)} per account aktif
              </div>
            </div>
          </div>
        </div>

        <div className="card p-4">
          <h3 className="font-medium text-slate-900 flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-amber-600" /> Trial habis dalam 3 hari ({expiringSoon.length})
          </h3>
          {expiringSoon.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Tidak ada trial yang akan habis 3 hari ke depan.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {expiringSoon.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/superadmin/accounts/${a.id}`}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-slate-50"
                  >
                    <span className="text-slate-700 truncate">
                      {a.brand_name || `Account ${a.id.slice(0, 8)}`}
                    </span>
                    <span className="text-amber-700 flex-shrink-0">
                      {a.trial_ends_at ? formatDateLong(new Date(a.trial_ends_at)) : "—"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent signups */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h3 className="font-medium text-slate-900">Signup terbaru (30 hari)</h3>
          <Link href="/superadmin/accounts" className="text-xs text-slate-600 hover:text-slate-900">
            Lihat semua →
          </Link>
        </div>
        {recent.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">Belum ada signup baru.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Brand
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Daftar
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {recent.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2">
                    <Link
                      href={`/superadmin/accounts/${a.id}`}
                      className="text-slate-700 hover:text-slate-900"
                    >
                      {a.brand_name || `Account ${a.id.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {formatDateLong(new Date(a.created_at))}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge
                      status={a.status}
                      trialEnds={a.trial_ends_at}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatusCard({
  label,
  count,
  icon,
  color,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className={`card p-3 border ${color}`}>
      <div className="text-xs flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{count}</div>
    </div>
  );
}

function StatusBadge({
  status,
  trialEnds,
}: {
  status: string;
  trialEnds: string | null;
}) {
  if (status === "trial") {
    const expired = trialEnds && new Date(trialEnds) <= new Date();
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full text-xs px-2 py-0.5 ${
          expired ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
        }`}
      >
        {expired ? "Trial expired" : "Trial"}
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 text-xs px-2 py-0.5">
        Active
      </span>
    );
  }
  if (status === "suspended") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 text-xs px-2 py-0.5">
        Suspended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 text-slate-600 text-xs px-2 py-0.5">
      Cancelled
    </span>
  );
}
