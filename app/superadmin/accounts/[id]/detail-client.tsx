"use client";

import { useState, useTransition } from "react";
import {
  Shield,
  Users,
  Activity,
  Building2,
  CreditCard,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  RefreshCw,
  Pause,
  XCircle,
  KeyRound,
  Mail,
  Phone,
} from "lucide-react";
import { formatDateLong, formatRupiah, parseDateISO } from "@/lib/format";
import {
  extendTrial,
  activateAccount,
  suspendAccount,
  cancelAccount,
  resetOwnerPassword,
  updateAccountMeta,
} from "./actions";

type AccountRow = {
  id: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  brand_name: string | null;
  support_email: string | null;
  support_wa: string | null;
  owner_user_id: string;
  created_at: string;
};

type MemberRow = {
  id: string;
  user_id: string;
  role: "owner" | "staff";
  joined_at: string | null;
  invited_at: string | null;
  last_active_at: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  jenis: "kredit" | "debet";
  total_input: number;
  total_matched: number;
  total_nominal_matched: number;
  created_at: string;
};

type AuditLog = {
  id: string;
  user_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type Counts = {
  banks: number;
  outlets: number;
  parsedTransactions: number;
  manualClaims: number;
};

export default function AccountDetailClient({
  account,
  members,
  sessions,
  auditLogs,
  counts,
  userEmails,
}: {
  account: AccountRow;
  members: MemberRow[];
  sessions: SessionRow[];
  auditLogs: AuditLog[];
  counts: Counts;
  userEmails: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);
  const [editMeta, setEditMeta] = useState(false);
  const [brandName, setBrandName] = useState(account.brand_name ?? "");
  const [supportEmail, setSupportEmail] = useState(account.support_email ?? "");
  const [supportWa, setSupportWa] = useState(account.support_wa ?? "");

  const owner = members.find((m) => m.role === "owner");
  const staff = members.filter((m) => m.role === "staff");
  const ownerEmail = owner ? userEmails[owner.user_id] ?? "—" : "—";

  const trialEnd = account.trial_ends_at ? parseDateISO(account.trial_ends_at.split("T")[0]) : null;
  const periodEnd = account.current_period_end
    ? parseDateISO(account.current_period_end.split("T")[0])
    : null;
  const trialExpired =
    account.status === "trial" && account.trial_ends_at && new Date(account.trial_ends_at) <= new Date();

  function withFeedback(promise: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await promise();
      if (res.ok) setFeedback({ type: "success", message: success });
      else setFeedback({ type: "error", message: res.error });
    });
  }

  function handleExtendTrial() {
    const days = parseInt(prompt("Tambah berapa hari trial?", "7") ?? "0", 10);
    if (!days || days < 1) return;
    withFeedback(() => extendTrial(account.id, days), `Trial diperpanjang ${days} hari.`);
  }

  function handleActivate() {
    const days = parseInt(prompt("Active sampai berapa hari?", "30") ?? "0", 10);
    if (!days || days < 1) return;
    withFeedback(() => activateAccount(account.id, days), `Account di-activate ${days} hari.`);
  }

  function handleSuspend() {
    const reason = prompt("Alasan suspend?") ?? "";
    if (!reason) return;
    withFeedback(() => suspendAccount(account.id, reason), "Account di-suspend.");
  }

  function handleCancel() {
    const reason = prompt("Alasan cancel? (account akan tidak bisa dipakai lagi)") ?? "";
    if (!reason) return;
    if (!confirm("Yakin cancel account ini? Action irreversible.")) return;
    withFeedback(() => cancelAccount(account.id, reason), "Account di-cancel.");
  }

  function handleReset() {
    if (!confirm(`Kirim password reset ke ${ownerEmail}?`)) return;
    withFeedback(
      () => resetOwnerPassword(account.id),
      `Reset link terkirim ke ${ownerEmail}.`,
    );
  }

  function handleSaveMeta() {
    withFeedback(
      () =>
        updateAccountMeta(account.id, {
          brand_name: brandName.trim() || undefined,
          support_email: supportEmail.trim() || undefined,
          support_wa: supportWa.trim() || undefined,
        }),
      "Meta updated.",
    );
    setEditMeta(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {account.brand_name || `Account ${account.id.slice(0, 8)}`}
          </h1>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <StatusBadge status={account.status} expired={!!trialExpired} />
            <span className="text-xs text-slate-500">
              ID: <code className="bg-slate-100 px-1 rounded">{account.id}</code>
            </span>
            <span className="text-xs text-slate-500">
              Daftar {formatDateLong(new Date(account.created_at))}
            </span>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`card p-3 text-sm flex items-start gap-2 ${
            feedback.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Tools panel */}
      <div className="card p-4 space-y-3">
        <h2 className="font-medium text-slate-900 flex items-center gap-1.5">
          <Shield className="h-4 w-4 text-purple-700" /> Admin Tools
        </h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExtendTrial}
            disabled={pending}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <Calendar className="h-3.5 w-3.5" /> Extend trial
          </button>
          <button
            type="button"
            onClick={handleActivate}
            disabled={pending}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> Activate (manual)
          </button>
          <button
            type="button"
            onClick={handleSuspend}
            disabled={pending || account.status === "suspended"}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <Pause className="h-3.5 w-3.5 text-amber-600" /> Suspend
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending || account.status === "cancelled"}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <XCircle className="h-3.5 w-3.5 text-red-600" /> Cancel
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={pending || !owner}
            className="btn-secondary text-xs inline-flex items-center gap-1"
          >
            <KeyRound className="h-3.5 w-3.5" /> Reset password owner
          </button>
          {pending && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 ml-1">
              <Loader2 className="h-3 w-3 animate-spin" /> memproses...
            </span>
          )}
        </div>
      </div>

      {/* Subscription + meta */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4 space-y-2">
          <h3 className="font-medium text-slate-900 flex items-center gap-1.5">
            <CreditCard className="h-4 w-4" /> Subscription
          </h3>
          <Row label="Status">
            <StatusBadge status={account.status} expired={!!trialExpired} />
          </Row>
          {account.status === "trial" && (
            <Row label="Trial habis">
              {trialEnd ? formatDateLong(trialEnd) : "—"}
              {trialExpired && <span className="ml-1 text-red-700">(expired)</span>}
            </Row>
          )}
          {account.status === "active" && (
            <>
              <Row label="Period start">
                {account.current_period_start
                  ? formatDateLong(new Date(account.current_period_start))
                  : "—"}
              </Row>
              <Row label="Period end">{periodEnd ? formatDateLong(periodEnd) : "—"}</Row>
            </>
          )}
          {account.cancelled_at && (
            <Row label="Cancelled at">
              {formatDateLong(new Date(account.cancelled_at))}
            </Row>
          )}
        </div>

        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-900 flex items-center gap-1.5">
              <Building2 className="h-4 w-4" /> Meta
            </h3>
            {!editMeta ? (
              <button
                onClick={() => setEditMeta(true)}
                className="text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1"
              >
                <Edit2 className="h-3 w-3" /> Edit
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  onClick={() => setEditMeta(false)}
                  className="text-xs text-slate-500 hover:text-slate-700"
                  disabled={pending}
                >
                  Batal
                </button>
                <button
                  onClick={handleSaveMeta}
                  className="text-xs text-green-700 hover:text-green-800"
                  disabled={pending}
                >
                  Simpan
                </button>
              </div>
            )}
          </div>
          {editMeta ? (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-slate-500">Brand name</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="input mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Support email</label>
                <input
                  type="email"
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  className="input mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Support WA</label>
                <input
                  type="text"
                  value={supportWa}
                  onChange={(e) => setSupportWa(e.target.value)}
                  placeholder="628xxxx"
                  className="input mt-0.5"
                />
              </div>
            </div>
          ) : (
            <>
              <Row label="Brand">{account.brand_name ?? "—"}</Row>
              <Row label={<><Mail className="inline-block h-3 w-3" /> Support email</>}>
                {account.support_email ?? "—"}
              </Row>
              <Row label={<><Phone className="inline-block h-3 w-3" /> Support WA</>}>
                {account.support_wa ?? "—"}
              </Row>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <StatCard label="Owner" value={ownerEmail} small />
        <StatCard label="Staff" value={String(staff.length)} />
        <StatCard label="Banks" value={String(counts.banks)} />
        <StatCard label="Outlets" value={String(counts.outlets)} />
        <StatCard label="Parsed Tx" value={String(counts.parsedTransactions)} />
      </div>

      {/* Members */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="font-medium text-slate-900 flex items-center gap-1.5">
            <Users className="h-4 w-4" /> Members ({members.length})
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50/50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                Email
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                Role
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                Joined
              </th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                Last active
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2 text-slate-700">{userEmails[m.user_id] ?? "—"}</td>
                <td className="px-4 py-2">
                  {m.role === "owner" ? (
                    <span className="inline-flex items-center rounded-full bg-purple-50 text-purple-700 text-xs px-2 py-0.5">
                      Owner
                    </span>
                  ) : (
                    <span className="text-xs text-slate-700">Staff</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {m.joined_at ? formatDateLong(new Date(m.joined_at)) : (
                    <span className="text-amber-700">Pending</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {m.last_active_at ? formatDateLong(new Date(m.last_active_at)) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent sessions */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="font-medium text-slate-900">Sesi terbaru ({sessions.length})</h3>
        </div>
        {sessions.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Belum ada sesi.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Tanggal
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  User
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Jenis
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Match / Total
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Nominal Match
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-2 text-xs text-slate-700">
                    {formatDateLong(new Date(s.created_at))}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    {userEmails[s.user_id] ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {s.jenis === "kredit" ? (
                      <span className="text-green-700">Kredit</span>
                    ) : (
                      <span className="text-red-700">Debet</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {s.total_matched} / {s.total_input}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    Rp {formatRupiah(s.total_nominal_matched)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Audit logs */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h3 className="font-medium text-slate-900 flex items-center gap-1.5">
            <Activity className="h-4 w-4" /> Audit log ({auditLogs.length})
          </h3>
        </div>
        {auditLogs.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">Belum ada audit log.</div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Waktu
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    User
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Action
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Metadata
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2 text-xs text-slate-600 whitespace-nowrap">
                      {formatDateLong(new Date(l.created_at))}{" "}
                      {new Date(l.created_at).toLocaleTimeString("id-ID", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {l.user_id ? userEmails[l.user_id] ?? l.user_id.slice(0, 8) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <code className="bg-slate-100 px-1 rounded text-[10px]">{l.action}</code>
                    </td>
                    <td className="px-4 py-2 text-[10px] text-slate-500 font-mono max-w-md truncate">
                      {l.metadata ? JSON.stringify(l.metadata) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-slate-500 text-xs flex items-center gap-1">{label}</span>
      <span className="text-slate-700 text-right">{children}</span>
    </div>
  );
}

function StatCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 font-semibold text-slate-900 ${small ? "text-sm truncate" : "text-lg"}`}>
        {value}
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
