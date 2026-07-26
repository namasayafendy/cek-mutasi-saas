"use client";

import { useState, useRef } from "react";
import {
  FileText,
  Loader2,
  AlertCircle,
  Lock,
  CheckCircle2,
  Plus,
  Trash2,
  Play,
} from "lucide-react";
import { getParserSpec } from "@/lib/banks/registry";
import { createClient } from "@/lib/supabase/client";
import { prosesSatuBank, type BankUpload } from "@/lib/pipeline/prosesSatuBank";
import type { Bank, Jenis } from "@/lib/types";

// BankUpload dulu didefinisikan di sini. Sejak Fase 1 (kanal mutasi Telegram)
// ia pindah ke lib/pipeline/prosesSatuBank.ts supaya auto-runner bisa memakai
// tipenya tanpa menarik seluruh komponen React ini. Di-re-export agar
// check-client.tsx dan pdf-viewer.tsx tidak perlu berubah sebaris pun.
export type { BankUpload };

type QueueRow = {
  id: string;
  bankId: string;
  password: string;
  file: File | null;
  status: "pending" | "parsing" | "ready" | "error";
  error?: string;
  progress?: string;
  result?: BankUpload;
};

function makeRowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function UploadStep({
  banks,
  jenis,
  accountId,
  onAllReady,
}: {
  banks: Bank[];
  jenis: Jenis;
  accountId: string;
  onAllReady: (uploads: BankUpload[]) => void;
}) {
  const [rows, setRows] = useState<QueueRow[]>(() => [
    { id: makeRowId(), bankId: banks[0]?.id ?? "", password: "", file: null, status: "pending" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const fileRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const allReady = rows.length > 0 && rows.every((r) => r.status === "ready");
  const anyParsing = rows.some((r) => r.status === "parsing");

  function updateRow(id: string, patch: Partial<QueueRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    const used = new Set(rows.map((r) => r.bankId));
    const nextBank = banks.find((b) => !used.has(b.id)) ?? banks[0];
    setRows((prev) => [
      ...prev,
      {
        id: makeRowId(),
        bankId: nextBank?.id ?? "",
        password: "",
        file: null,
        status: "pending",
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  async function parseRow(row: QueueRow) {
    const bank = banks.find((b) => b.id === row.bankId);
    const spec = bank ? getParserSpec(bank.parser_id) : undefined;
    if (!bank || !spec) {
      updateRow(row.id, { status: "error", error: "Bank/parser tidak valid" });
      return;
    }
    if (!row.file) {
      updateRow(row.id, { status: "error", error: "File belum dipilih" });
      return;
    }
    if (spec.password_required && !row.password) {
      updateRow(row.id, { status: "error", error: "Password wajib untuk PDF ini" });
      return;
    }
    updateRow(row.id, { status: "parsing", progress: `Parsing ${spec.label}...`, error: undefined });

    // Seluruh isi blok ini dulu ada di sini; sejak Fase 1 ia tinggal di
    // lib/pipeline/prosesSatuBank.ts dan dipakai bersama oleh alur Telegram.
    // Perilakunya sengaja dibuat identik: urutan langkah, pesan galat, dan
    // pemetaan error semuanya ikut pindah apa adanya.
    const hasil = await prosesSatuBank({
      supabase: createClient(),
      accountId,
      bank,
      file: row.file,
      password: row.password,
      jenis,
      // Alur manual: layarnya butuh gambar halaman, dan nol transaksi pada
      // jenis aktif memang harus jadi galat merah (perilaku lama).
      renderHalaman: true,
      gagalKalauJenisKosong: true,
      onLangkah: (teks) => updateRow(row.id, { progress: teks }),
    });

    if (!hasil.ok) {
      updateRow(row.id, { status: "error", error: hasil.alasan, progress: undefined });
      return;
    }
    updateRow(row.id, { status: "ready", progress: undefined, result: hasil.upload });
  }

  function handleFileChange(rowId: string, file: File | null) {
    if (!file) return;
    updateRow(rowId, { file, status: "pending", error: undefined });
    const row = rows.find((r) => r.id === rowId);
    const bank = row ? banks.find((b) => b.id === row.bankId) : undefined;
    const spec = bank ? getParserSpec(bank.parser_id) : undefined;
    if (!spec?.password_required) {
      setTimeout(() => {
        setRows((prev) => {
          const target = prev.find((x) => x.id === rowId);
          if (target) parseRow({ ...target, file });
          return prev;
        });
      }, 0);
    }
  }

  function handleSubmit() {
    const ready = rows.filter((r) => r.status === "ready" && r.result).map((r) => r.result!);
    if (ready.length === 0) return;
    setSubmitting(true);
    onAllReady(ready);
  }

  if (banks.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"}
          </h1>
        </div>
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Belum ada bank ready</h2>
          <p className="mt-1 text-sm text-amber-800">
            Tambah dulu rekening bank di menu <strong>Bank</strong>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Cek Mutasi {jenis === "kredit" ? "Kredit (Transaksi Masuk)" : "Debet (Transaksi Keluar)"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Tambah rekening bank yang mau di-cek (bisa lebih dari 1), upload mutasinya, lalu klik{" "}
          <strong>Mulai Cek</strong>. File diproses lokal di browser.
        </p>
      </div>

      <div className="space-y-3">
        {rows.map((row, idx) => {
          const bank = banks.find((b) => b.id === row.bankId);
          const spec = bank ? getParserSpec(bank.parser_id) : undefined;
          const requiresPassword = spec?.password_required ?? false;
          const fileAccept = spec?.format === "html" ? ".html,text/html" : ".pdf,application/pdf";
          const showRemove = rows.length > 1;
          return (
            <div key={row.id} className="card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-slate-700">
                  Bank #{idx + 1}
                  {row.result && (() => {
                    const r = row.result;
                    const otherCount = jenis === "kredit" ? r.parsedDebetCount : r.parsedKreditCount;
                    const otherLabel = jenis === "kredit" ? "debet" : "kredit";
                    return (
                      <span className="ml-2 inline-flex items-center gap-1.5 text-xs">
                        <span className="text-[#10B981] inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          {r.parsed.transactions.length} tx {jenis} siap
                        </span>
                        {otherCount > 0 && (
                          <span
                            className="text-slate-500"
                            title={`${otherCount} tx ${otherLabel} ada di file tapi tidak masuk sesi ini. Mereka tetap tersimpan dan bisa di-cek di sesi ${otherLabel}.`}
                          >
                            · {otherCount} tx {otherLabel} (bisa dicek nanti lewat &ldquo;Lanjut&rdquo;)
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </div>
                {showRemove && (
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1"
                    disabled={row.status === "parsing"}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Hapus
                  </button>
                )}
              </div>

              {row.result?.integrity &&
                (row.result.integrity.complete !== null || row.result.integrity.connected !== null) &&
                (() => {
                  const ig = row.result.integrity!;
                  const rp = (n: number) => "Rp " + Math.round(Math.abs(n)).toLocaleString("id-ID");
                  const danger = ig.complete === false || ig.connected === false;
                  return (
                    <div
                      className="rounded-md border p-2.5 text-xs space-y-1"
                      style={{
                        borderColor: danger ? "#fecaca" : ig.complete ? "#bbf7d0" : "#e2e8f0",
                        background: danger ? "#fef2f2" : ig.complete ? "#f0fdf4" : "#f8fafc",
                      }}
                    >
                      {ig.complete === true && (
                        <div className="font-medium text-emerald-700">
                          ✅ Mutasi UTUH — semua transaksi terbaca (cocok total bank).
                        </div>
                      )}
                      {ig.complete === false && (
                        <div className="font-medium text-red-700">
                          ⚠️ Mutasi TIDAK lengkap — ada transaksi tak terbaca
                          {ig.missingKredit !== 0 ? ` · masuk ${rp(ig.missingKredit)}` : ""}
                          {ig.missingDebet !== 0 ? ` · keluar ${rp(ig.missingDebet)}` : ""}
                          {ig.chainBreaks > 0 ? ` · ${ig.chainBreaks} lompatan saldo` : ""}
                        </div>
                      )}
                      {ig.connected === false && (
                        <div className="text-amber-700">
                          ⚠️ Kemungkinan ada transaksi BELUM terupload sebelum periode ini
                          {ig.gapAmount ? ` (selisih saldo ${rp(ig.gapAmount)})` : ""} — disarankan
                          download mutasi mulai tanggal terakhir tercatat.
                        </div>
                      )}
                      {ig.connected === true && (
                        <div className="text-slate-500">🔗 Nyambung dari upload terakhir.</div>
                      )}
                      {(ig.firstDate || ig.lastDate) && (
                        <div className="text-slate-400">
                          Periode terbaca: {ig.firstDate ?? "?"} s/d {ig.lastDate ?? "?"}
                        </div>
                      )}
                    </div>
                  );
                })()}

              <div className={`grid gap-3 ${requiresPassword ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank / E-Wallet
                  </label>
                  <select
                    value={row.bankId}
                    onChange={(e) =>
                      updateRow(row.id, {
                        bankId: e.target.value,
                        status: "pending",
                        file: null,
                        result: undefined,
                        error: undefined,
                      })
                    }
                    className="input-base"
                    disabled={row.status === "parsing"}
                  >
                    {banks.map((b) => {
                      const sp = getParserSpec(b.parser_id);
                      return (
                        <option key={b.id} value={b.id}>
                          {b.label || sp?.label || b.kode}
                        </option>
                      );
                    })}
                  </select>
                  {spec?.hint && <p className="mt-1 text-xs text-slate-500">{spec.hint}</p>}
                </div>

                {requiresPassword && (
                  <div>
                    <label className="text-xs font-medium text-slate-700 mb-1 flex items-center gap-1.5">
                      <Lock className="h-3 w-3" />
                      Password PDF
                    </label>
                    <input
                      type="password"
                      value={row.password}
                      onChange={(e) => updateRow(row.id, { password: e.target.value })}
                      placeholder="DDMMYYYY"
                      className="input-base"
                      disabled={row.status === "parsing"}
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">File</label>
                  <input
                    ref={(el) => {
                      if (el) fileRefs.current.set(row.id, el);
                      else fileRefs.current.delete(row.id);
                    }}
                    type="file"
                    accept={fileAccept}
                    onChange={(e) => handleFileChange(row.id, e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileRefs.current.get(row.id)?.click()}
                      className="btn-secondary text-xs flex-1"
                      disabled={row.status === "parsing"}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      {row.file ? row.file.name.slice(0, 25) : "Pilih file"}
                    </button>
                    {requiresPassword &&
                      row.file &&
                      row.password &&
                      row.status !== "parsing" &&
                      row.status !== "ready" && (
                        <button
                          type="button"
                          onClick={() => parseRow(row)}
                          className="btn-primary text-xs px-2 py-1"
                        >
                          Parse
                        </button>
                      )}
                  </div>
                </div>
              </div>

              {row.status === "parsing" && (
                <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {row.progress ?? "Memproses..."}
                </div>
              )}

              {row.status === "error" && row.error && (
                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>{row.error}</span>
                </div>
              )}

              {row.status === "ready" && row.result && (
                <div className="rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700 flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    Dari {row.result.parsed.pages.length} halaman ·{" "}
                    <strong>{row.result.persistInfo.newCount} baru</strong>
                    {row.result.persistInfo.dupCount > 0 && (
                      <>, {row.result.persistInfo.dupCount} sudah ada (auto dedup)</>
                    )}
                    .
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={addRow}
          className="btn-secondary text-sm"
          disabled={anyParsing || submitting}
        >
          <Plus className="h-4 w-4" /> Tambah Bank Lain
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allReady || anyParsing || submitting}
          className="btn-primary text-sm flex-1 sm:flex-initial sm:ml-auto"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Menyiapkan...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Mulai Cek (
              {rows.filter((r) => r.status === "ready").length} bank)
            </>
          )}
        </button>
      </div>

      <div className="card p-5 text-sm text-slate-600">
        <h2 className="text-sm font-semibold text-slate-900 mb-2">Cara kerja multi-bank</h2>
        <ol className="space-y-1.5 list-decimal list-inside">
          <li>Pilih bank, upload mutasinya. Auto-parse + auto-dedup ke history.</li>
          <li>Klik &quot;Tambah Bank Lain&quot; kalau mau cek lebih dari 1 bank sekaligus.</li>
          <li>Setelah semua ready, klik &quot;Mulai Cek&quot; untuk masuk halaman input.</li>
          <li>Di halaman input, pilih bank tujuan setiap nominal. Default ikut tab PDF aktif.</li>
        </ol>
      </div>
    </div>
  );
}
