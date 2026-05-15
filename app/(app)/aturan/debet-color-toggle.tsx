"use client";

import { useState } from "react";
import { Loader2, Palette, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function DebetColorToggle({
  accountId,
  initialSameColor,
}: {
  accountId: string;
  initialSameColor: boolean;
}) {
  const [sameColor, setSameColor] = useState(initialSameColor);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(newValue: boolean) {
    setSameColor(newValue);
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      const supabase = createClient();
      const { error: e } = await supabase
        .from("account_settings")
        .update({
          debet_highlight_same_color: newValue,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", accountId);
      if (e) throw new Error(e.message);
      setSavedAt(Date.now());
    } catch (err) {
      // Revert on error
      setSameColor(!newValue);
      setError(err instanceof Error ? err.message : "Gagal simpan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-100 text-slate-700 flex-shrink-0">
          <Palette className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 text-sm">
            Warna Highlight Debet (Transaksi Keluar)
          </h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Saat cek mutasi debet, apakah highlight pakai warna outlet (sama dengan
            kredit) atau warna khusus debet supaya visual beda?
          </p>
        </div>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        {!saving && savedAt && Date.now() - savedAt < 4000 && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Tersimpan
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => handleChange(true)}
          disabled={saving}
          className={`text-left rounded-lg border p-3 transition-all ${
            sameColor
              ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
              : "border-slate-200 bg-white hover:border-slate-300"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-yellow-200 border border-slate-300" />
              <span className="w-4 h-4 rounded bg-pink-200 border border-slate-300" />
              <span className="w-4 h-4 rounded bg-green-200 border border-slate-300" />
            </div>
            <span className="text-sm font-semibold text-slate-900">
              Sama dengan outlet
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-600 leading-snug">
            Debet dan kredit pakai warna outlet yang sama. Lebih konsisten per
            cabang, cocok untuk bisnis multi-outlet.
          </p>
        </button>

        <button
          type="button"
          onClick={() => handleChange(false)}
          disabled={saving}
          className={`text-left rounded-lg border p-3 transition-all ${
            !sameColor
              ? "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200"
              : "border-slate-200 bg-white hover:border-slate-300"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <span className="w-4 h-4 rounded bg-yellow-200 border border-slate-300" />
              <span className="text-slate-300">/</span>
              <span className="w-4 h-4 rounded bg-slate-500 border border-slate-300" />
            </div>
            <span className="text-sm font-semibold text-slate-900">
              Warna khusus debet (slate)
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-600 leading-snug">
            Kredit pakai warna outlet, debet pakai warna abu-abu. Lebih cepat
            bedain transaksi masuk vs keluar di PDF output.
          </p>
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
