"use client";

import { useState, useTransition } from "react";
import {
  UserPlus,
  Trash2,
  Mail,
  Shield,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  RotateCw,
} from "lucide-react";
import { inviteStaff, removeStaff, resendInvite } from "./actions";
import { formatDateLong } from "@/lib/format";

type StaffWithEmail = {
  id: string;
  user_id: string;
  role: "owner" | "staff";
  email: string | null;
  invited_at: string | null;
  joined_at: string | null;
  last_active_at: string | null;
  created_at: string;
};

export default function StaffClient({
  staff,
  currentUserId,
}: {
  staff: StaffWithEmail[];
  currentUserId: string;
}) {
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const res = await inviteStaff(email);
      if (res.ok) {
        setEmail("");
        setFeedback({ type: "success", message: "Invite terkirim. Staff akan dapat email." });
      } else {
        setFeedback({ type: "error", message: res.error });
      }
    });
  }

  function handleRemove(memberId: string, label: string) {
    if (!confirm(`Yakin remove ${label}? Staff tidak bisa lagi akses.`)) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await removeStaff(memberId);
      if (res.ok) {
        setFeedback({ type: "success", message: `${label} di-remove.` });
      } else {
        setFeedback({ type: "error", message: res.error });
      }
    });
  }

  function handleResend(memberId: string, email: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await resendInvite(memberId);
      if (res.ok) {
        setFeedback({ type: "success", message: `Invite/reset link terkirim ke ${email}.` });
      } else {
        setFeedback({ type: "error", message: res.error });
      }
    });
  }

  const owners = staff.filter((s) => s.role === "owner");
  const staffOnly = staff.filter((s) => s.role === "staff");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <Shield className="h-6 w-6 text-slate-600" />
          Staff
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Invite staff via email. Staff hanya bisa akses Cek Mutasi + History (tidak bisa
          ubah bank, outlet, aturan, atau billing).
        </p>
      </div>

      {/* Invite form */}
      <div className="card p-4 space-y-3">
        <h2 className="font-medium text-slate-900 flex items-center gap-1.5">
          <UserPlus className="h-4 w-4" />
          Invite Staff Baru
        </h2>
        <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="staff@contoh.com"
            className="input flex-1"
            disabled={pending}
          />
          <button type="submit" className="btn-primary text-sm" disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Memproses…
              </>
            ) : (
              <>
                <Mail className="h-4 w-4" /> Kirim Invite
              </>
            )}
          </button>
        </form>
        <p className="text-xs text-slate-500">
          Sistem akan kirim email magic-link. Staff klik link → set password → langsung bisa
          login dengan akses staff.
        </p>
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

      {/* Owner row */}
      {owners.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <h2 className="font-medium text-slate-900">Owner</h2>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {owners.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {s.email ?? <span className="text-slate-400 italic">— email hilang —</span>}
                      {s.user_id === currentUserId && (
                        <span className="ml-2 text-[11px] text-slate-500">(Anda)</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">
                      Bergabung {formatDateLong(new Date(s.created_at))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-700 text-xs px-2 py-0.5">
                      <Shield className="h-3 w-3" /> Owner
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Staff list */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Staff ({staffOnly.length})</h2>
        </div>
        {staffOnly.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada staff. Invite staff pakai form di atas.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Email
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Bergabung
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {staffOnly.map((s) => {
                const isPending = !s.joined_at;
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {s.email ?? <span className="text-slate-400 italic">— email hilang —</span>}
                    </td>
                    <td className="px-4 py-3">
                      {isPending ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 text-xs px-2 py-0.5">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-green-700 text-xs px-2 py-0.5">
                          <CheckCircle2 className="h-3 w-3" /> Aktif
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {s.joined_at
                        ? formatDateLong(new Date(s.joined_at))
                        : s.invited_at
                          ? `Di-invite ${formatDateLong(new Date(s.invited_at))}`
                          : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleResend(s.id, s.email ?? "")}
                          className="text-xs text-slate-700 hover:text-slate-900 inline-flex items-center gap-1"
                          disabled={pending}
                          title={isPending ? "Kirim invite ulang" : "Kirim password reset"}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          {isPending ? "Resend invite" : "Reset password"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(s.id, s.email ?? "staff")}
                          className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                          disabled={pending}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4 bg-slate-50 text-xs text-slate-600 space-y-1">
        <p className="font-medium text-slate-700">Apa yang staff bisa & tidak bisa:</p>
        <p>✅ Cek Mutasi (upload PDF, input nominal, download hasil)</p>
        <p>✅ Lihat History + Mutasi + Belum Match (data semua staff visible ke semua staff)</p>
        <p>✅ Manual claim transaksi belum-match</p>
        <p>❌ Tambah/edit bank, outlet, aturan</p>
        <p>❌ Akses Akun & Tagihan</p>
        <p>❌ Invite/remove staff lain</p>
      </div>
    </div>
  );
}
