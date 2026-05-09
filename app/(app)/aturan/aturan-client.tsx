"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Settings,
  Star,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import type { MatchRulePreset, MatchMode } from "@/lib/types";

type RuleForm = {
  id?: string;
  name: string;
  jenis: "kredit" | "debet" | "both";
  lookback_days: number;
  forward_window_days: number;
  match_mode: MatchMode;
  tolerance_rp: number;
  tolerance_pct: number;
};

const EMPTY_FORM: RuleForm = {
  name: "",
  jenis: "kredit",
  lookback_days: 3,
  forward_window_days: 0,
  match_mode: "exact",
  tolerance_rp: 0,
  tolerance_pct: 0,
};

export function AturanClient({
  initialRules,
  accountId,
}: {
  initialRules: MatchRulePreset[];
  accountId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<RuleForm | null>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  function startNew() {
    setEditing({ ...EMPTY_FORM });
    setFeedback(null);
  }

  function startEdit(rule: MatchRulePreset) {
    setEditing({
      id: rule.id,
      name: rule.name,
      jenis: rule.jenis,
      lookback_days: rule.lookback_days,
      forward_window_days: rule.forward_window_days,
      match_mode: rule.match_mode,
      tolerance_rp: rule.tolerance_rp,
      tolerance_pct: Number(rule.tolerance_pct),
    });
    setFeedback(null);
  }

  function cancel() {
    setEditing(null);
  }

  async function save() {
    if (!editing) return;
    if (!editing.name.trim()) {
      setFeedback({ type: "error", message: "Nama aturan wajib diisi" });
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      const supabase = createClient();
      const payload = {
        account_id: accountId,
        name: editing.name.trim(),
        jenis: editing.jenis,
        lookback_days: editing.lookback_days,
        forward_window_days: editing.forward_window_days,
        match_mode: editing.match_mode,
        tolerance_rp: editing.match_mode === "tol_rp" ? editing.tolerance_rp : 0,
        tolerance_pct: editing.match_mode === "tol_pct" ? editing.tolerance_pct : 0,
        updated_at: new Date().toISOString(),
      };

      let error;
      if (editing.id) {
        const res = await supabase
          .from("match_rules")
          .update(payload)
          .eq("id", editing.id);
        error = res.error;
      } else {
        const res = await supabase.from("match_rules").insert(payload);
        error = res.error;
      }

      if (error) {
        setFeedback({
          type: "error",
          message: error.message.includes("unique")
            ? "Nama aturan sudah dipakai. Pilih nama lain."
            : error.message,
        });
        return;
      }
      setEditing(null);
      setFeedback({
        type: "success",
        message: editing.id ? "Aturan ter-update." : "Aturan baru ter-tambah.",
      });
      router.refresh();
    });
  }

  async function softDelete(rule: MatchRulePreset) {
    if (rule.is_default) {
      setFeedback({
        type: "error",
        message: "Aturan default tidak bisa dihapus. Edit saja kalau mau ubah.",
      });
      return;
    }
    if (!confirm(`Hapus aturan "${rule.name}"? Sesi yang sudah dipakai tetap aman.`)) return;
    setFeedback(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase
        .from("match_rules")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", rule.id);
      if (error) {
        setFeedback({ type: "error", message: error.message });
        return;
      }
      setFeedback({ type: "success", message: `"${rule.name}" dihapus.` });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
          <Settings className="h-6 w-6 text-slate-600" />
          Aturan Matching
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Buat preset aturan yang bisa Anda pakai saat cek mutasi. Misal &quot;QRIS&quot;
          (toleransi % karena fee), &quot;EDC Settle&quot; (forward 1-2 hari), &quot;Manual&quot;
          (exact match).
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

      {!editing && (
        <button onClick={startNew} className="btn-primary text-sm" disabled={pending}>
          <Plus className="h-4 w-4" /> Tambah Aturan Baru
        </button>
      )}

      {editing && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-slate-900">
              {editing.id ? "Edit Aturan" : "Aturan Baru"}
            </h3>
            <button
              onClick={cancel}
              className="text-slate-400 hover:text-slate-700"
              disabled={pending}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Nama Aturan</label>
            <input
              type="text"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="Misal: QRIS Lippo, EDC BCA, Manual Transfer"
              className="input mt-1"
              disabled={pending}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Jenis</label>
            <select
              value={editing.jenis}
              onChange={(e) =>
                setEditing({ ...editing, jenis: e.target.value as RuleForm["jenis"] })
              }
              className="input mt-1"
              disabled={pending}
            >
              <option value="kredit">Kredit (transaksi masuk)</option>
              <option value="debet">Debet (transaksi keluar)</option>
              <option value="both">Keduanya (kredit + debet)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700">
                Lookback (hari ke belakang)
              </label>
              <input
                type="number"
                min="0"
                max="90"
                value={editing.lookback_days}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    lookback_days: parseInt(e.target.value, 10) || 0,
                  })
                }
                className="input mt-1"
                disabled={pending}
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Tx ditemukan kalau ≤ N hari sebelum tgl input
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700">
                Forward (hari ke depan)
              </label>
              <input
                type="number"
                min="0"
                max="90"
                value={editing.forward_window_days}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    forward_window_days: parseInt(e.target.value, 10) || 0,
                  })
                }
                className="input mt-1"
                disabled={pending}
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Untuk QRIS/EDC yang settle besoknya — bisa &gt; 0
              </p>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Mode Match</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <ModeCard
                label="Exact"
                desc="Nominal harus persis"
                active={editing.match_mode === "exact"}
                onClick={() => setEditing({ ...editing, match_mode: "exact" })}
              />
              <ModeCard
                label="Tol Rp"
                desc="Toleransi ± Rp X"
                active={editing.match_mode === "tol_rp"}
                onClick={() => setEditing({ ...editing, match_mode: "tol_rp" })}
              />
              <ModeCard
                label="Tol %"
                desc="Toleransi ± Y%"
                active={editing.match_mode === "tol_pct"}
                onClick={() => setEditing({ ...editing, match_mode: "tol_pct" })}
              />
            </div>
          </div>

          {editing.match_mode === "tol_rp" && (
            <div>
              <label className="text-xs font-medium text-slate-700">Toleransi Rupiah</label>
              <input
                type="number"
                min="0"
                value={editing.tolerance_rp}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    tolerance_rp: parseInt(e.target.value, 10) || 0,
                  })
                }
                className="input mt-1"
                disabled={pending}
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Tx cocok kalau selisih ≤ Rp {formatRupiah(editing.tolerance_rp)} (mis. fee admin)
              </p>
            </div>
          )}

          {editing.match_mode === "tol_pct" && (
            <div>
              <label className="text-xs font-medium text-slate-700">Toleransi Persen</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={editing.tolerance_pct}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    tolerance_pct: parseFloat(e.target.value) || 0,
                  })
                }
                className="input mt-1"
                disabled={pending}
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Tx cocok kalau selisih ≤ {editing.tolerance_pct}% (mis. QRIS yang potong %)
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={cancel}
              className="btn-secondary text-sm flex-1"
              disabled={pending}
            >
              Batal
            </button>
            <button onClick={save} className="btn-primary text-sm flex-1" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan...
                </>
              ) : (
                "Simpan Aturan"
              )}
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="font-medium text-slate-900">Aturan Tersimpan ({initialRules.length})</h2>
        </div>
        {initialRules.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada aturan. Klik &quot;Tambah Aturan Baru&quot; untuk mulai.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Nama
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Jenis
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Aturan
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {initialRules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-slate-900">
                    <div className="flex items-center gap-1.5">
                      {r.is_default && (
                        <Star
                          className="h-3.5 w-3.5 text-amber-500 fill-amber-500"
                          aria-label="Default"
                        />
                      )}
                      <span className="font-medium">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {r.jenis === "kredit" && (
                      <span className="text-green-700">Kredit</span>
                    )}
                    {r.jenis === "debet" && <span className="text-red-700">Debet</span>}
                    {r.jenis === "both" && <span className="text-slate-700">Keduanya</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">
                    Lookback {r.lookback_days}h, Forward {r.forward_window_days}h,{" "}
                    {r.match_mode === "exact" && "Exact"}
                    {r.match_mode === "tol_rp" && (
                      <>±Rp {formatRupiah(r.tolerance_rp)}</>
                    )}
                    {r.match_mode === "tol_pct" && <>±{Number(r.tolerance_pct)}%</>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button
                        onClick={() => startEdit(r)}
                        className="text-xs text-slate-700 hover:text-slate-900 inline-flex items-center gap-1"
                        disabled={pending}
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      {!r.is_default && (
                        <button
                          onClick={() => softDelete(r)}
                          className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                          disabled={pending}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Hapus
                        </button>
                      )}
                    </div>
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

function ModeCard({
  label,
  desc,
  active,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-2 rounded border ${
        active
          ? "border-slate-900 bg-slate-50"
          : "border-slate-200 bg-white hover:border-slate-400"
      }`}
    >
      <div className="text-xs font-medium text-slate-900">{label}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{desc}</div>
    </button>
  );
}
