"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

const CONFIRM_WORD = "HAPUS";

export function DeleteConfirmModal({
  title,
  description,
  details,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  details?: { label: string; value: string }[];
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isReady = typed.trim().toUpperCase() === CONFIRM_WORD && !busy;

  async function handleConfirm() {
    if (!isReady) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menghapus.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-red-200 bg-red-50 flex items-center justify-between">
          <h2 className="font-semibold text-red-800 inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {title}
          </h2>
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-red-400 hover:text-red-700 disabled:opacity-50"
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">{description}</p>

          {details && details.length > 0 && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3 space-y-1.5">
              {details.map((d) => (
                <div key={d.label} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{d.label}</span>
                  <span className="font-medium text-slate-900">{d.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
            <p className="font-medium">Penting:</p>
            <ul className="mt-1 list-disc pl-4 space-y-0.5">
              <li>Data hilang dari history secara permanen.</li>
              <li>Auto-purge dari server dalam 30 hari (sesuai kebijakan privasi).</li>
              <li>Aksi ini tidak bisa di-undo.</li>
            </ul>
          </div>

          <div>
            <label className="text-xs text-slate-700 font-medium">
              Ketik <span className="font-mono text-red-700">{CONFIRM_WORD}</span>{" "}
              untuk konfirmasi:
            </label>
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={typed}
              disabled={busy}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isReady) handleConfirm();
              }}
              className="input mt-1 w-full font-mono uppercase tracking-wider"
              placeholder={CONFIRM_WORD}
            />
          </div>

          {err && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-xs text-red-800">
              {err}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="btn-secondary text-sm flex-1 disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!isReady}
              className="text-sm flex-1 inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-md px-4 py-2 font-medium transition-colors"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {busy ? "Menghapus..." : "Hapus Permanen"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
