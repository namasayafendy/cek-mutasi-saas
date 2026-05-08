"use client";

import { useState, useMemo } from "react";
import type { Outlet, UserInput } from "@/lib/types";
import { parseNominal, formatRupiah, parseDateISO, toDateISO } from "@/lib/format";
import { Plus } from "lucide-react";

export function InputPanel({
  outlets,
  onAdd,
}: {
  outlets: Outlet[];
  onAdd: (inputs: UserInput[]) => void;
}) {
  const [outletId, setOutletId] = useState(outlets[0]?.id ?? "");
  const [tanggal, setTanggal] = useState(toDateISO(new Date()));
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    const newInputs: UserInput[] = parsedLines.map((l) => ({
      id: `${Date.now()}-${l.idx}-${Math.random().toString(36).slice(2, 7)}`,
      tanggal: dt,
      outletId,
      nominal: l.nominal!,
    }));
    onAdd(newInputs);
    setRaw("");
  }

  const selectedOutlet = outlets.find((o) => o.id === outletId);

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-slate-900">Input transferan</h3>
        <p className="text-xs text-slate-600 mt-0.5">
          Pilih outlet + tanggal, lalu ketik nominal-nominal satu per baris.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal</label>
          <input
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            className="input-base"
          />
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
