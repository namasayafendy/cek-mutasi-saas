"use client";

import { useState, useTransition } from "react";
import {
  Gift,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  TrendingUp,
} from "lucide-react";
import {
  createReferralCode,
  toggleReferralCode,
  deleteReferralCode,
} from "./actions";
import type { ReferralCodeRow } from "./page";

type RewardType = "extend_trial_days" | "discount_pct" | "discount_rp" | "months_free";

const REWARD_LABELS: Record<RewardType, string> = {
  extend_trial_days: "Extend Trial (hari)",
  months_free: "Bulan Gratis",
  discount_pct: "Diskon %",
  discount_rp: "Diskon Rp",
};

function formatReward(t: RewardType, v: number): string {
  switch (t) {
    case "extend_trial_days":
      return `+${v} hari trial`;
    case "months_free":
      return `${v} bulan gratis`;
    case "discount_pct":
      return `-${v}% berlangganan`;
    case "discount_rp":
      return `-Rp ${v.toLocaleString("id-ID")}`;
  }
}

export default function ReferralClient({
  codes,
  error,
}: {
  codes: ReferralCodeRow[];
  currentUserId: string;
  error: string | null;
}) {
  const [showForm, setShowForm] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  // Form state
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [rewardType, setRewardType] = useState<RewardType>("extend_trial_days");
  const [rewardValue, setRewardValue] = useState<string>("30");
  const [maxUses, setMaxUses] = useState<string>("");
  const [notes, setNotes] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const r = await createReferralCode({
        code,
        description,
        rewardType,
        rewardValue: parseInt(rewardValue, 10),
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        notes,
      });
      if (r.ok) {
        setFeedback({ type: "ok", msg: "Kode dibuat." });
        setCode("");
        setDescription("");
        setMaxUses("");
        setNotes("");
        setShowForm(false);
      } else {
        setFeedback({ type: "err", msg: r.error });
      }
    });
  }

  function handleToggle(c: ReferralCodeRow) {
    startTransition(async () => {
      const r = await toggleReferralCode(c.id, !c.is_active);
      if (!r.ok) setFeedback({ type: "err", msg: r.error });
    });
  }

  function handleDelete(c: ReferralCodeRow) {
    if (!confirm(`Hapus kode "${c.code}"? Aksi ini tidak bisa di-undo (soft delete).`)) return;
    startTransition(async () => {
      const r = await deleteReferralCode(c.id);
      if (!r.ok) setFeedback({ type: "err", msg: r.error });
    });
  }

  function copyCode(s: string) {
    void navigator.clipboard.writeText(s);
    setFeedback({ type: "ok", msg: `"${s}" disalin ke clipboard` });
  }

  const activeCodes = codes.filter((c) => !c.deleted_at);
  const deletedCodes = codes.filter((c) => c.deleted_at);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-[#FAFAF7] via-white to-[#10B981]/5 border border-slate-200 p-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 px-3 py-1 text-xs font-medium text-[#0F2E1F] mb-2">
          <Gift className="h-3.5 w-3.5 text-[#10B981]" />
          Referral
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#0F2E1F]">Kode Referral</h1>
        <p className="mt-1 text-sm text-slate-600 max-w-2xl">
          Kelola kode referral yang bisa dipakai user pas signup untuk dapat
          reward (extend trial, gratis berbulan, atau diskon berlangganan).
        </p>
      </div>

      {feedback && (
        <div
          className={`rounded-md border px-3 py-2 text-sm flex items-start gap-2 ${
            feedback.type === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {feedback.type === "ok" ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          )}
          <span>{feedback.msg}</span>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Create button / form toggle */}
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 bg-[#0F2E1F] hover:bg-[#1a4530] text-white rounded-md px-4 py-2.5 text-sm font-semibold transition-colors"
        >
          <Plus className="h-4 w-4" />
          Buat Kode Baru
        </button>
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <h2 className="font-semibold text-[#0F2E1F]">Buat Kode Referral Baru</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-slate-700">Kode</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="input-base mt-1 uppercase tracking-wider"
                placeholder="TEMAN2026"
                required
                disabled={pending}
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Huruf besar, tanpa spasi. Otomatis di-uppercase.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Deskripsi (internal)</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="input-base mt-1"
                placeholder="Misal: Kode untuk testing teman"
                disabled={pending}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Jenis Reward</label>
              <select
                value={rewardType}
                onChange={(e) => {
                  setRewardType(e.target.value as RewardType);
                  // reasonable defaults
                  if (e.target.value === "extend_trial_days") setRewardValue("30");
                  else if (e.target.value === "months_free") setRewardValue("1");
                  else if (e.target.value === "discount_pct") setRewardValue("20");
                  else setRewardValue("50000");
                }}
                className="input-base mt-1"
                disabled={pending}
              >
                <option value="extend_trial_days">Tambah hari trial</option>
                <option value="months_free">Gratis bulan</option>
                <option value="discount_pct">Diskon %</option>
                <option value="discount_rp">Diskon Rp</option>
              </select>
              <p className="mt-1 text-[10px] text-slate-500">
                {rewardType === "discount_pct" || rewardType === "discount_rp"
                  ? "Catatan: diskon disimpan tapi belum aktif sampai billing live."
                  : "Otomatis perpanjang trial_ends_at saat user pakai kode."}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">
                Nilai Reward
                <span className="ml-1 text-slate-500">
                  {rewardType === "extend_trial_days" && "(hari)"}
                  {rewardType === "months_free" && "(bulan)"}
                  {rewardType === "discount_pct" && "(%)"}
                  {rewardType === "discount_rp" && "(Rp)"}
                </span>
              </label>
              <input
                type="number"
                min={1}
                value={rewardValue}
                onChange={(e) => setRewardValue(e.target.value)}
                className="input-base mt-1"
                required
                disabled={pending}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">Batas Pemakaian</label>
              <input
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="input-base mt-1"
                placeholder="Kosongkan = unlimited"
                disabled={pending}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-slate-700">Catatan internal</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input-base mt-1"
                rows={2}
                placeholder="Catatan untuk superadmin (gak ditampilin ke user)"
                disabled={pending}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              type="submit"
              disabled={pending || !code.trim()}
              className="text-sm inline-flex items-center gap-1.5 bg-[#10B981] hover:bg-[#0ea571] disabled:bg-slate-300 text-white rounded-md px-4 py-2 font-medium transition-colors"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Simpan
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={pending}
              className="text-sm bg-white hover:bg-[#FAFAF7] text-[#0F2E1F] border border-slate-200 rounded-md px-4 py-2 font-medium transition-colors"
            >
              Batal
            </button>
          </div>
        </form>
      )}

      {/* Active codes table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-medium text-[#0F2E1F]">Kode Aktif ({activeCodes.length})</h2>
        </div>
        {activeCodes.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada kode. Klik &quot;Buat Kode Baru&quot;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Kode
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Reward
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Pemakaian
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Deskripsi
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {activeCodes.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5">
                        <span className="font-mono font-bold text-[#0F2E1F] tracking-wider">
                          {c.code}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyCode(c.code)}
                          className="text-slate-400 hover:text-[#10B981]"
                          title="Salin"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">
                        <div className="font-medium text-[#10B981]">
                          {formatReward(c.reward_type, c.reward_value)}
                        </div>
                        <div className="text-slate-500">{REWARD_LABELS[c.reward_type]}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="inline-flex items-center gap-1.5 text-xs">
                        <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
                        <span className="font-mono text-[#0F2E1F]">
                          {c.uses_count}
                          {c.max_uses !== null && (
                            <span className="text-slate-400"> / {c.max_uses}</span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {c.is_active ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#10B981]/10 text-[#10B981] text-[10px] font-semibold px-2 py-0.5 border border-[#10B981]/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                          AKTIF
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold px-2 py-0.5">
                          OFF
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                      {c.description ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleToggle(c)}
                          disabled={pending}
                          className="text-xs text-slate-700 hover:text-[#0F2E1F] inline-flex items-center gap-1"
                          title={c.is_active ? "Non-aktifkan" : "Aktifkan"}
                        >
                          {c.is_active ? (
                            <ToggleRight className="h-4 w-4 text-[#10B981]" />
                          ) : (
                            <ToggleLeft className="h-4 w-4 text-slate-400" />
                          )}
                          {c.is_active ? "Off" : "On"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(c)}
                          disabled={pending}
                          className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Deleted codes (collapsed) */}
      {deletedCodes.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50">
          <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-slate-600">
            Kode terhapus ({deletedCodes.length})
          </summary>
          <div className="px-4 pb-3 text-xs text-slate-500">
            <ul className="space-y-1">
              {deletedCodes.map((c) => (
                <li key={c.id} className="font-mono">
                  {c.code} — {formatReward(c.reward_type, c.reward_value)} · dihapus{" "}
                  {c.deleted_at && new Date(c.deleted_at).toLocaleString("id-ID")}
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
