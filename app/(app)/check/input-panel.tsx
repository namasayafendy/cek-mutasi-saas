"use client";

import { useState, useMemo, useEffect } from "react";
import type { Outlet, UserInput, Bank, MatchRulePreset } from "@/lib/types";
import { parseNominal, formatRupiah, parseDateISO, toDateISO } from "@/lib/format";
import { Plus, Globe, Star, Download } from "lucide-react";
import { pullGadaiClaims } from "./actions-gadai";

const ALL_BANKS_VALUE = "_all";

export function InputPanel({
  outlets,
  banks,
  rules,
  defaultBankId,
  onAdd,
  enableGadaiPull,
}: {
  outlets: Outlet[];
  banks: Bank[];
  rules: MatchRulePreset[];
  defaultBankId: string;
  onAdd: (inputs: UserInput[]) => void;
  enableGadaiPull?: boolean;
}) {
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [bankId, setBankId] = useState(defaultBankId || banks[0]?.id || "");
  const [matchRuleId, setMatchRuleId] = useState(
    rules.find((r) => r.is_default)?.id ?? rules[0]?.id ?? "",
  );
  const [tanggal, setTanggal] = useState(toDateISO(new Date()));
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  async function handlePullGadai() {
    setPullMsg(null);
    setPulling(true);
    try {
      const res = await pullGadaiClaims();
      if (!res.ok) {
        setPullMsg("❌ " + res.error);
        return;
      }
      const conv: UserInput[] = res.inputs
        .map((i) => {
          const dt = parseDateISO(i.tanggalISO);
          if (!dt || !i.nominal) return null;
          return {
            id: i.id,
            tanggal: dt,
            outletId: i.outletId,
            bankId: i.bankId,
            matchRuleId: i.matchRuleId,
            nominal: i.nominal,
          } as UserInput;
        })
        .filter((x): x is UserInput => x !== null);
      if (conv.length > 0) onAdd(conv);
      const warn =
        res.unmappedOutlets.length > 0
          ? ` ⚠️ outlet belum cocok: ${res.unmappedOutlets.join(", ")}`
          : "";
      setPullMsg(`✅ ${conv.length} transfer ditarik dari Aceh Gadai.${warn}`);
    } catch (e) {
      setPullMsg("❌ Gagal: " + String(e));
    } finally {
      setPulling(false);
    }
  }

  useEffect(() => {
    if (defaultBankId) setBankId(defaultBankId);
  }, [defaultBankId]);

  const parsedLines = useMemo(() => {
    return raw
      .split(/\n/)
      .map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const n = parseNominal(trimmed);
        return { idx, raw: trimmed, nominal: n };
      })
      .filter((x): x is { idx: number; raw: string; nominal: number | null } => x !== null);
  }, [raw]);

  const validCount = parsedLines.filter((l) => l.nominal !== null).length;
  const invalidLines = parsedLines.filter((l) => l.nominal === null);
  const totalNominal = parsedLines.reduce((s, l) => s + (l.nominal ?? 0), 0);

  function handleSubmit() {
    setError(null);
    if (!outletId) {
      setError("Pilih outlet dulu");
      return;
    }
    if (!bankId) {
      setError("Pilih bank dulu");
      return;
    }
    if (!matchRuleId) {
      setError("Pilih aturan dulu");
      return;
    }
    const dt = parseDateISO(tanggal);
    if (!dt) {
      setError("Tanggal tidak valid");
      return;
    }
    if (parsedLines.length === 0) {
      setError("Belum ada nominal yang dimasukkan");
      return;
    }
    if (invalidLines.length > 0) {
      setError(
        `${invalidLines.length} baris tidak valid: ${invalidLines.map((l) => `"${l.raw}"`).join(", ")}`,
      );
      return;
    }
    // bankId === ALL_BANKS_VALUE → simpan empty string (matching pool akan skip filter bank)
    const finalBankId = bankId === ALL_BANKS_VALUE ? "" : bankId;
    const newInputs: UserInput[] = parsedLines.map((l) => ({
      id: `${Date.now()}-${l.idx}-${Math.random().toString(36).slice(2, 7)}`,
      tanggal: dt,
      outletId,
      bankId: finalBankId,
      matchRuleId,
      nominal: l.nominal!,
    }));
    onAdd(newInputs);
    setRaw("");
  }

  const selectedOutlet = outlets.find((o) => o.id === outletId);
  const selectedBank = banks.find((b) => b.id === bankId);
  const selectedRule = rules.find((r) => r.id === matchRuleId);
  const multiBank = banks.length > 1;

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-slate-900">Input transferan</h3>
        <p className="text-xs text-slate-600 mt-0.5">
          Pilih bank, outlet, tanggal, aturan — lalu input nominal-nominal yang sesuai filter
          itu. Klik &quot;+ Tambah&quot; untuk push ke list. Setelah itu bisa ganti filter dan input batch baru.
        </p>
      </div>

      {enableGadaiPull && (
        <div>
          <button
            type="button"
            onClick={handlePullGadai}
            disabled={pulling}
            className="w-full inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {pulling ? "Menarik..." : "Tarik transfer dari Aceh Gadai"}
          </button>
          {pullMsg && <p className="mt-1 text-[11px] text-slate-600">{pullMsg}</p>}
        </div>
      )}

      <div className={`grid gap-3 ${multiBank ? "grid-cols-2" : "grid-cols-2"}`}>
        {multiBank && (
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Bank</label>
            <select
              value={bankId}
              onChange={(e) => setBankId(e.target.value)}
              className="input-base"
            >
              <option value={ALL_BANKS_VALUE}>🌐 Semua bank (cross-bank)</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label || b.kode}
                </option>
              ))}
            </select>
            {bankId === ALL_BANKS_VALUE && (
              <p className="mt-1 text-[10px] text-blue-600 flex items-start gap-0.5">
                <Globe className="h-2.5 w-2.5 mt-0.5 flex-shrink-0" />
                Input akan match tx dari bank manapun
              </p>
            )}
            {selectedBank && bankId !== ALL_BANKS_VALUE && (
              <p className="mt-1 text-[10px] text-slate-500 truncate">
                {selectedBank.label || selectedBank.kode}
              </p>
            )}
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Outlet</label>
          <select
            value={outletId}
            onChange={(e) => setOutletId(e.target.value)}
            className="input-base"
          >
            {outlets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nama}
              </option>
            ))}
          </select>
          {selectedOutlet && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <div
                className="w-3 h-3 rounded border border-slate-300"
                style={{ backgroundColor: selectedOutlet.warna_hex }}
              />
              <span>warna highlight</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
          <input
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            className="input-base"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Aturan Matching
          </label>
          <select
            value={matchRuleId}
            onChange={(e) => setMatchRuleId(e.target.value)}
            className="input-base"
          >
            {rules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.is_default ? "⭐ " : ""}
                {r.name}
              </option>
            ))}
          </select>
          {selectedRule && (
            <p className="mt-1 text-[10px] text-slate-500 truncate">
              {selectedRule.lookback_days}h lookback, {selectedRule.forward_window_days}h fwd,{" "}
              {selectedRule.match_mode === "exact" && "exact"}
              {selectedRule.match_mode === "tol_rp" &&
                `±Rp ${formatRupiah(selectedRule.tolerance_rp)}`}
              {selectedRule.match_mode === "tol_pct" && `±${Number(selectedRule.tolerance_pct)}%`}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Nominal (satu per baris)
        </label>
        <textarea
          rows={6}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={"100.000\n250.000\n1.500.000"}
          className="input-base font-mono"
        />
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-slate-500">
            {validCount} valid
            {invalidLines.length > 0 && (
              <span className="text-red-600 ml-2">
                {invalidLines.length} tidak valid
              </span>
            )}
          </span>
          {validCount > 0 && (
            <span className="text-slate-700">
              Total: Rp {formatRupiah(totalNominal)}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={validCount === 0}
        className="btn-primary w-full"
      >
        <Plus className="h-4 w-4" />
        Tambah {validCount > 0 ? `(${validCount})` : ""} ke list
      </button>
    </div>
  );
}

export { ALL_BANKS_VALUE };
