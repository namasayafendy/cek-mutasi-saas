"use client";

import { useMemo, useState } from "react";
import {
  Activity as ActivityIcon,
  Filter,
  CheckCircle2,
  Hand,
  UserPlus,
  UserMinus,
  AlertCircle,
  Shield,
  RotateCcw,
} from "lucide-react";
import { formatRupiah, formatDateID, parseDateISO } from "@/lib/format";

type LogRow = {
  id: string;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type TeamMemberRow = { id: string; user_id: string; role: "owner" | "staff" };
type BankLite = { id: string; kode: string; label: string | null };
type OutletLite = { id: string; nama: string; warna_hex: string };

type FilterState = {
  userId: string; // "all" | uuid
  action: string; // "all" | specific
  from: string;
  to: string;
};

function getDefault(): FilterState {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return {
    userId: "all",
    action: "all",
    from: from.toISOString().split("T")[0],
    to: today.toISOString().split("T")[0],
  };
}

const ACTION_LABEL: Record<string, { label: string; color: string }> = {
  "session.created": { label: "Selesai cek mutasi", color: "text-blue-700" },
  "tx.manual_claimed": { label: "Claim manual", color: "text-purple-700" },
  "staff.invited": { label: "Invite staff", color: "text-green-700" },
  "staff.removed": { label: "Remove staff", color: "text-red-700" },
};

function ActionIcon({ action }: { action: string }) {
  if (action === "session.created")
    return <CheckCircle2 className="h-4 w-4 text-blue-600" />;
  if (action === "tx.manual_claimed") return <Hand className="h-4 w-4 text-purple-600" />;
  if (action === "staff.invited") return <UserPlus className="h-4 w-4 text-green-600" />;
  if (action === "staff.removed") return <UserMinus className="h-4 w-4 text-red-600" />;
  return <ActivityIcon className="h-4 w-4 text-slate-500" />;
}

export default function ActivityClient({
  logs,
  members,
  userEmails,
  banks,
  outlets,
  error,
}: {
  logs: LogRow[];
  members: TeamMemberRow[];
  userEmails: Record<string, string>;
  banks: BankLite[];
  outlets: OutletLite[];
  error: string | null;
}) {
  const [filter, setFilter] = useState<FilterState>(getDefault);

  const memberByUserId = useMemo(
    () => new Map(members.map((m) => [m.user_id, m])),
    [members],
  );
  const bankMap = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);
  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (filter.userId !== "all" && l.user_id !== filter.userId) return false;
      if (filter.action !== "all" && l.action !== filter.action) return false;
      const created = l.created_at.split("T")[0];
      if (created < filter.from) return false;
      if (created > filter.to) return false;
      return true;
    });
  }, [logs, filter]);

  // Stats per action
  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of filtered) {
      counts.set(l.action, (counts.get(l.action) ?? 0) + 1);
    }
    return counts;
  }, [filtered]);

  function reset() {
    setFilter(getDefault());
  }

  function describeMetadata(log: LogRow): React.ReactNode {
    const meta = log.metadata ?? {};
    if (log.action === "session.created") {
      const jenis = (meta.jenis as string) ?? "?";
      const total = meta.total_input ?? 0;
      const matched = meta.total_matched ?? 0;
      const nominal = (meta.total_nominal_matched as number) ?? 0;
      const bankId = meta.bank_id as string | undefined;
      const bank = bankId ? bankMap.get(bankId) : null;
      const carry = meta.carry_over_used ? " · pakai carry-over" : "";
      return (
        <span className="text-slate-600">
          {jenis} · {bank ? bank.label || bank.kode : "—"} ·{" "}
          <strong className="text-green-700">{String(matched)}</strong>/{String(total)} match · Rp{" "}
          {formatRupiah(nominal)}
          {carry}
        </span>
      );
    }
    if (log.action === "tx.manual_claimed") {
      const nominal = (meta.nominal as number) ?? 0;
      const jenis = (meta.jenis as string) ?? "?";
      const outletId = meta.outlet_id as string | undefined;
      const outlet = outletId ? outletMap.get(outletId) : null;
      const reason = (meta.reason as string) ?? "";
      return (
        <span className="text-slate-600">
          {jenis} · Rp {formatRupiah(nominal)} ·{" "}
          {outlet ? (
            <span className="inline-flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: outlet.warna_hex }}
              />
              {outlet.nama}
            </span>
          ) : (
            "—"
          )}
          {reason && <span className="ml-1 italic">— {reason}</span>}
        </span>
      );
    }
    if (log.action === "staff.invited") {
      return (
        <span className="text-slate-600">
          Email: <strong>{(meta.email as string) ?? "?"}</strong> ·{" "}
          {meta.mode === "existing_user" ? "user lama (langsung aktif)" : "user baru (perlu accept)"}
        </span>
      );
    }
    if (log.action === "staff.removed") {
      return <span className="text-slate-600">Staff di-remove dari akun</span>;
    }
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <ActivityIcon className="h-6 w-6 text-slate-600" />
          Activity Log
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Riwayat aktivitas semua user di akun ini. Pakai untuk verifikasi staff &
          troubleshoot. Disimpan 30 hari terakhir.
        </p>
      </div>

      {error && (
        <div className="card p-4 border-red-200 bg-red-50 text-red-800 text-sm">
          Gagal memuat: {error}
        </div>
      )}

      {/* Filter */}
      <div className="card p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Filter className="h-4 w-4" /> Filter
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500">User</label>
            <select
              className="input mt-1"
              value={filter.userId}
              onChange={(e) => setFilter((p) => ({ ...p, userId: e.target.value }))}
            >
              <option value="all">Semua user</option>
              {members.map((m) => {
                const email = userEmails[m.user_id] ?? "—";
                return (
                  <option key={m.id} value={m.user_id}>
                    {email} ({m.role})
                  </option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Aktivitas</label>
            <select
              className="input mt-1"
              value={filter.action}
              onChange={(e) => setFilter((p) => ({ ...p, action: e.target.value }))}
            >
              <option value="all">Semua aktivitas</option>
              <option value="session.created">Selesai cek mutasi</option>
              <option value="tx.manual_claimed">Claim manual</option>
              <option value="staff.invited">Invite staff</option>
              <option value="staff.removed">Remove staff</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Dari</label>
            <input
              type="date"
              className="input mt-1"
              value={filter.from}
              onChange={(e) => setFilter((p) => ({ ...p, from: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Sampai</label>
            <input
              type="date"
              className="input mt-1"
              value={filter.to}
              onChange={(e) => setFilter((p) => ({ ...p, to: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" className="chip inline-flex items-center gap-1" onClick={reset}>
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
          <span className="text-slate-500 ml-auto">
            {filtered.length} aktivitas dari {logs.length} total
          </span>
        </div>
      </div>

      {/* Stats summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Object.keys(ACTION_LABEL).map((act) => (
          <div key={act} className="card p-3">
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <ActionIcon action={act} /> {ACTION_LABEL[act].label}
            </div>
            <div className="mt-1 text-lg font-semibold text-slate-900">
              {stats.get(act) ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* Log table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Detail Aktivitas</h2>
          {logs.length >= 1000 && (
            <span className="text-xs text-amber-700">
              Hasil dipotong di 1000 baris terbaru
            </span>
          )}
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            <ActivityIcon className="h-8 w-8 mx-auto text-slate-300 mb-2" />
            Tidak ada aktivitas sesuai filter.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500 w-40">
                    Waktu
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500 w-44">
                    User
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500 w-44">
                    Aktivitas
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filtered.map((l) => {
                  const created = new Date(l.created_at);
                  const member = l.user_id ? memberByUserId.get(l.user_id) : null;
                  const email = l.user_id ? userEmails[l.user_id] : null;
                  const actionInfo = ACTION_LABEL[l.action];
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-xs text-slate-700 whitespace-nowrap">
                        <div>{formatDateID(created)}</div>
                        <div className="text-[10px] text-slate-500">
                          {created.toLocaleTimeString("id-ID", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="text-slate-700">{email ?? "—"}</div>
                        {member && (
                          <div className="text-[10px] text-slate-500">
                            {member.role === "owner" ? (
                              <span className="inline-flex items-center gap-0.5">
                                <Shield className="h-2.5 w-2.5" /> Owner
                              </span>
                            ) : (
                              "Staff"
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div className="inline-flex items-center gap-1.5">
                          <ActionIcon action={l.action} />
                          <span className={actionInfo?.color ?? "text-slate-600"}>
                            {actionInfo?.label ?? l.action}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {describeMetadata(l) ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
