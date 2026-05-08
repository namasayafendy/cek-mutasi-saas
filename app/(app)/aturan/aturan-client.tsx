"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { AccountSettings, MatchMode } from "@/lib/types";
import { Save, ArrowDown, ArrowUp, Equal, Minus, Percent, Palette } from "lucide-react";

type Jenis = "kredit" | "debet";

const PRESET_LOOKBACK = [0, 1, 3, 7];

export function AturanClient({
  accountId,
  initialSettings,
}: {
  accountId: string;
  initialSettings: AccountSettings;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<AccountSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [, startTransition] = useTransition();

  function update<K extends keyof AccountSettings>(key: K, value: AccountSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
  }

  async function handleSave() {
    setError(null);
    setSuccess(false);
    setSaving(true);
    const supabase = createClient();
    const { error: updErr } = await supabase
      .from("account_settings")
      .update({
        lookback_days_kredit: settings.lookback_days_kredit,
        forward_window_days_kredit: settings.forward_window_days_kredit,
        match_mode_kredit: settings.match_mode_kredit,
        match_tolerance_rp_kredit: settings.match_tolerance_rp_kredit,
        match_tolerance_pct_kredit: settings.match_tolerance_pct_kredit,
        lookback_days_debet: settings.lookback_days_debet,
        forward_window_days_debet: settings.forward_window_days_debet,
        match_mode_debet: settings.match_mode_debet,
        match_tolerance_rp_debet: settings.match_tolerance_rp_debet,
        match_tolerance_pct_debet: settings.match_tolerance_pct_debet,
        debet_highlight_same_color: settings.debet_highlight_same_color,
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", accountId);
    if (updErr) {
      setError(updErr.message);
      setSaving(false);
      return;
    }
    setSuccess(true);
    setSaving(false);
    startTransition(() => router.refresh());
  }

  function JenisSection({ jenis }: { jenis: Jenis }) {
    const lookbackKey = jenis === "kredit" ? "lookback_days_kredit" : "lookback_days_debet";
    const forwardKey = jenis === "kredit" ? "forward_window_days_kredit" : "forward_window_days_debet";
    const modeKey = jenis === "kredit" ? "match_mode_kredit" : "match_mode_debet";
    const tolRpKey = jenis === "kredit" ? "match_tolerance_rp_kredit" : "match_tolerance_rp_debet";
    const tolPctKey = jenis === "kredit" ? "match_tolerance_pct_kredit" : "match_tolerance_pct_debet";

    const lookback = settings[lookbackKey] as number;
    const forward = settings[forwardKey] as number;
    const mode = settings[modeKey] as MatchMode;
    const tolRp = settings[tolRpKey] as number;
    const tolPct = settings[tolPctKey] as number;

    return (
      <div className="card p-5 space-y-5">
        <div className="flex items-center gap-2">
          {jenis === "kredit" ? (
            <ArrowDown className="h-5 w-5 text-green-600" />
          ) : (
            <ArrowUp className="h-5 w-5 text-red-600" />
          )}
          <h2 className="text-lg font-semibold text-slate-900">
            {jenis === "kredit" ? "Transaksi Masuk (Kredit)" : "Transaksi Keluar (Debet)"}
          </h2>
        </div>

        {/* Lookback */}
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Lookback (cari ke belakang max berapa hari)
          </label>
          <p className="text-xs text-slate-500 mt-0.5">
            Misal: input tgl 20 April, lookback 3 hari → cari di mutasi tgl 17-20 April.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_LOOKBACK.map((n) => (
              <button
                key={n}
                onClick={() => update(lookbackKey, n)}
                className={`px-3 py-1.5 rounded-md text-sm border ${
                  lookback === n
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {n === 0 ? "0 hari (exact date)" : `${n} hari`}
              </button>
            ))}
            <div className="inline-flex items-center gap-1.5">
              <span className="text-xs text-slate-500">atau</span>
              <input
                type="number"
                min={0}
                max={30}
                value={!PRESET_LOOKBACK.includes(lookback) ? lookback : ""}
                placeholder="custom"
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 0 && v <= 30) update(lookbackKey, v);
                }}
                className="input-base w-24 py-1 text-sm"
              />
              <span className="text-xs text-slate-500">hari</span>
            </div>
          </div>
        </div>

        {/* Forward window */}
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Forward window (cari juga ke depan berapa hari)
          </label>
          <p className="text-xs text-slate-500 mt-0.5">
            Misal: customer info bayar tgl 20 April, transferan baru masuk tgl 22. Forward 3 hari
            akan match itu juga. Default: 0 (off — strict tidak boleh tanggal lebih baru).
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESET_LOOKBACK.map((n) => (
              <button
                key={n}
                onClick={() => update(forwardKey, n)}
                className={`px-3 py-1.5 rounded-md text-sm border ${
                  forward === n
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-white border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {n === 0 ? "Off" : `${n} hari`}
              </button>
            ))}
            <div className="inline-flex items-center gap-1.5">
              <span className="text-xs text-slate-500">atau</span>
              <input
                type="number"
                min={0}
                max={30}
                value={!PRESET_LOOKBACK.includes(forward) ? forward : ""}
                placeholder="custom"
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 0 && v <= 30) update(forwardKey, v);
                }}
                className="input-base w-24 py-1 text-sm"
              />
              <span className="text-xs text-slate-500">hari</span>
            </div>
          </div>
        </div>

        {/* Match mode */}
        <div>
          <label className="block text-sm font-medium text-slate-700">Match mode</label>
          <p className="text-xs text-slate-500 mt-0.5">
            Cara mencocokkan nominal input dengan transaksi mutasi.
          </p>
          <div className="mt-2 grid sm:grid-cols-3 gap-2">
            <button
              onClick={() => update(modeKey, "exact")}
              className={`p-3 rounded-md border text-left ${
                mode === "exact"
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "bg-white border-slate-300 hover:bg-slate-50"
              }`}
            >
              <Equal className="h-4 w-4 mb-1" />
              <div className="font-medium text-sm">Exact</div>
              <div className="text-xs opacity-80">Nominal sama persis</div>
            </button>
            <button
              onClick={() => update(modeKey, "tol_rp")}
              className={`p-3 rounded-md border text-left ${
                mode === "tol_rp"
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "bg-white border-slate-300 hover:bg-slate-50"
              }`}
            >
              <Minus className="h-4 w-4 mb-1" />
              <div className="font-medium text-sm">Toleransi Rp</div>
              <div className="text-xs opacity-80">±Rp untuk biaya admin</div>
            </button>
            <button
              onClick={() => update(modeKey, "tol_pct")}
              className={`p-3 rounded-md border text-left ${
                mode === "tol_pct"
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "bg-white border-slate-300 hover:bg-slate-50"
              }`}
            >
              <Percent className="h-4 w-4 mb-1" />
              <div className="font-medium text-sm">Toleransi %</div>
              <div className="text-xs opacity-80">±% (untuk QRIS)</div>
            </button>
          </div>

          {mode === "tol_rp" && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-slate-700">±Rp</span>
              <input
                type="number"
                min={0}
                value={tolRp}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 0) update(tolRpKey, v);
                }}
                className="input-base w-32"
              />
              <span className="text-xs text-slate-500">
                Misal 1.000 → terima nominal selisih max Rp 1.000
              </span>
            </div>
          )}
          {mode === "tol_pct" && (
            <div className="mt-3 flex items-center gap-2">
              <span className="text-sm text-slate-700">±</span>
              <input
                type="number"
                min={0}
                max={100}
                step="0.1"
                value={tolPct}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v >= 0 && v <= 100) update(tolPctKey, v);
                }}
                className="input-base w-24"
              />
              <span className="text-sm text-slate-700">%</span>
              <span className="text-xs text-slate-500">
                Misal 0.7 → QRIS biasanya potong 0.7%
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Aturan Matching</h1>
        <p className="mt-1 text-sm text-slate-600">
          Atur cara sistem mencocokkan input Anda dengan transaksi di mutasi bank.
          Bisa diatur beda antara kredit dan debet.
        </p>
      </div>

      <JenisSection jenis="kredit" />
      <JenisSection jenis="debet" />

      {/* Highlight color setting */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Palette className="h-5 w-5 text-slate-600" />
          <h2 className="text-lg font-semibold text-slate-900">Tampilan Highlight</h2>
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.debet_highlight_same_color}
            onChange={(e) => update("debet_highlight_same_color", e.target.checked)}
            className="mt-1"
          />
          <div>
            <div className="text-sm font-medium text-slate-900">
              Pakai warna outlet yang sama untuk kredit & debet
            </div>
            <div className="text-xs text-slate-500 mt-0.5">
              Centang: kredit & debet pakai warna outlet sama.
              Uncheck: debet pakai warna terpisah (akan diatur per-outlet di Phase berikutnya).
            </div>
          </div>
        </label>
      </div>

      {/* Save bar (sticky at bottom) */}
      <div className="sticky bottom-4 flex justify-end">
        <div className="card p-3 flex items-center gap-3 shadow-md">
          {error && (
            <span className="text-sm text-red-700">{error}</span>
          )}
          {success && (
            <span className="text-sm text-green-700">Tersimpan</span>
          )}
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save className="h-4 w-4" />
            {saving ? "Menyimpan..." : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}
