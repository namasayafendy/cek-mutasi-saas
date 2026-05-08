"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PARSER_REGISTRY, getKodeLabel, getParserSpec } from "@/lib/banks/registry";
import type { Bank } from "@/lib/types";
import { Plus, Trash2, X, Check, AlertCircle, Lock, Building2, Wallet, Pencil } from "lucide-react";

export function BanksClient({
  initialBanks,
  accountId,
}: {
  initialBanks: Bank[];
  accountId: string;
}) {
  const router = useRouter();
  const [banks, setBanks] = useState<Bank[]>(initialBanks);
  const [adding, setAdding] = useState(false);
  const [parserId, setParserId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const selectedSpec = useMemo(() => getParserSpec(parserId), [parserId]);

  // Group parser registry by category for select options
  const parserOptions = useMemo(() => {
    const banks = PARSER_REGISTRY.filter((p) => p.category === "bank");
    const ewallets = PARSER_REGISTRY.filter((p) => p.category === "ewallet");
    return { banks, ewallets };
  }, []);

  // Hint kalau owner sudah punya bank dengan kode yg sama (saran pakai label)
  const sameCodeBanks = useMemo(() => {
    if (!selectedSpec) return [];
    return banks.filter((b) => b.kode === selectedSpec.kode);
  }, [banks, selectedSpec]);

  async function handleAdd() {
    setError(null);
    if (!parserId) {
      setError("Pilih bank atau e-wallet dulu");
      return;
    }
    const spec = getParserSpec(parserId);
    if (!spec) {
      setError("Parser tidak valid");
      return;
    }
    const finalLabel = label.trim() || null;

    // Cek duplikasi: kalau ada bank dengan parser_id sama dan label sama (atau keduanya null), refuse
    const dup = banks.find(
      (b) =>
        b.parser_id === parserId &&
        (b.label?.toLowerCase() ?? "") === (finalLabel?.toLowerCase() ?? ""),
    );
    if (dup) {
      setError(
        finalLabel
          ? `Sudah ada bank "${spec.label}" dengan label "${finalLabel}".`
          : `Sudah ada bank "${spec.label}". Beri label custom kalau ini rekening berbeda (misal "${spec.label} 2").`,
      );
      return;
    }

    const supabase = createClient();
    const { data, error: insertErr } = await supabase
      .from("banks")
      .insert({
        account_id: accountId,
        kode: spec.kode,
        label: finalLabel,
        parser_id: parserId,
        is_active: true,
        urutan: banks.length,
      })
      .select()
      .single();
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setBanks((prev) => [...prev, data as Bank]);
    setParserId("");
    setLabel("");
    setAdding(false);
    startTransition(() => router.refresh());
  }

  async function handleToggle(bank: Bank) {
    setError(null);
    const supabase = createClient();
    const { error: updErr } = await supabase
      .from("banks")
      .update({ is_active: !bank.is_active })
      .eq("id", bank.id);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    setBanks((prev) =>
      prev.map((b) => (b.id === bank.id ? { ...b, is_active: !b.is_active } : b)),
    );
    startTransition(() => router.refresh());
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus rekening ini? Riwayat transaksi yang terkait juga akan ikut terhapus."))
      return;
    setError(null);
    const supabase = createClient();
    const { error: delErr } = await supabase.from("banks").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setBanks((prev) => prev.filter((b) => b.id !== id));
    startTransition(() => router.refresh());
  }

  async function handleSaveEdit(id: string) {
    setError(null);
    const newLabel = editLabel.trim() || null;
    const supabase = createClient();
    const { error: updErr } = await supabase
      .from("banks")
      .update({ label: newLabel })
      .eq("id", id);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    setBanks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, label: newLabel } : b)),
    );
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  function bankDisplay(b: Bank): string {
    return b.label || getKodeLabel(b.kode);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Bank & Rekening</h1>
          <p className="mt-1 text-sm text-slate-600">
            Atur rekening bank/e-wallet yang Anda pakai untuk terima/kirim transferan.
            Punya beberapa rekening di bank sama? Tambah masing-masing dengan label custom.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
              setError(null);
              setParserId("");
              setLabel("");
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            Tambah Rekening
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Form tambah */}
      {adding && (
        <div className="card p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Bank / E-Wallet</label>
            <select
              autoFocus
              value={parserId}
              onChange={(e) => setParserId(e.target.value)}
              className="input-base mt-1"
            >
              <option value="">— Pilih bank atau e-wallet —</option>
              <optgroup label="Bank">
                {parserOptions.banks.map((p) => (
                  <option key={p.parser_id} value={p.parser_id}>
                    {p.label}
                    {p.status === "coming_soon" ? " — Coming Soon" : ""}
                    {p.password_required ? " — Password Required" : ""}
                  </option>
                ))}
              </optgroup>
              <optgroup label="E-Wallet">
                {parserOptions.ewallets.map((p) => (
                  <option key={p.parser_id} value={p.parser_id}>
                    {p.label}
                    {p.status === "coming_soon" ? " — Coming Soon" : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {selectedSpec && (
            <div className="rounded-md bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 space-y-1">
              {selectedSpec.hint && (
                <p>
                  <span className="font-medium">Catatan: </span>
                  {selectedSpec.hint}
                </p>
              )}
              {selectedSpec.password_required && (
                <p className="flex items-center gap-1.5 text-amber-700">
                  <Lock className="h-3.5 w-3.5" />
                  PDF biasanya password-protected — Anda akan diminta password saat upload.
                </p>
              )}
              {selectedSpec.status === "coming_soon" && (
                <p className="flex items-center gap-1.5 text-blue-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Parser belum aktif. Anda boleh tambah rekening, tapi tidak bisa upload PDF
                  sampai parser di-rilis.
                </p>
              )}
              {sameCodeBanks.length > 0 && (
                <p className="flex items-center gap-1.5 text-slate-700">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Anda sudah punya {sameCodeBanks.length} rekening{" "}
                  {getKodeLabel(selectedSpec.kode)}. Beri <strong>label custom</strong> di
                  bawah supaya bisa dibedakan, atau biarkan kosong untuk merge transaksi.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Label (opsional)
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                selectedSpec
                  ? `Misal: ${getKodeLabel(selectedSpec.kode)} Pusat. Kosongkan kalau cuma 1 rekening.`
                  : "Pilih bank dulu"
              }
              className="input-base mt-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") {
                  setAdding(false);
                  setParserId("");
                  setLabel("");
                  setError(null);
                }
              }}
            />
          </div>

          <div className="flex gap-2">
            <button onClick={handleAdd} className="btn-primary">
              <Check className="h-4 w-4" /> Simpan
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setParserId("");
                setLabel("");
                setError(null);
              }}
              className="btn-secondary"
            >
              <X className="h-4 w-4" /> Batal
            </button>
          </div>
        </div>
      )}

      {/* List banks */}
      <div className="card overflow-hidden">
        {banks.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada rekening. Klik &ldquo;Tambah Rekening&rdquo; untuk mulai.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Bank / E-Wallet
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Format
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Aktif
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {banks.map((b) => {
                const spec = getParserSpec(b.parser_id);
                const isComingSoon = spec?.status === "coming_soon";
                const isEditing = editingId === b.id;
                return (
                  <tr key={b.id}>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {spec?.category === "ewallet" ? (
                          <Wallet className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        ) : (
                          <Building2 className="h-4 w-4 text-slate-400 flex-shrink-0" />
                        )}
                        <div>
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveEdit(b.id);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              placeholder={getKodeLabel(b.kode)}
                              className="input-base text-sm py-1"
                            />
                          ) : (
                            <>
                              <div className="font-medium text-slate-900 text-sm">
                                {bankDisplay(b)}
                              </div>
                              {b.label && (
                                <div className="text-xs text-slate-500">
                                  Kode: {getKodeLabel(b.kode)}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {spec?.format.toUpperCase() ?? "?"}
                    </td>
                    <td className="px-4 py-2">
                      {isComingSoon ? (
                        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Coming Soon
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          Ready
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleToggle(b)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                          b.is_active ? "bg-slate-900" : "bg-slate-300"
                        }`}
                        aria-label={b.is_active ? "Nonaktifkan" : "Aktifkan"}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
                            b.is_active ? "translate-x-5" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isEditing ? (
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => handleSaveEdit(b.id)}
                            className="rounded p-1.5 text-green-700 hover:bg-green-50"
                            title="Simpan"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
                            title="Batal"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex gap-1">
                          <button
                            onClick={() => {
                              setEditingId(b.id);
                              setEditLabel(b.label ?? "");
                            }}
                            className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
                            title="Edit label"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(b.id)}
                            className="rounded p-1.5 text-red-600 hover:bg-red-50"
                            title="Hapus"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Help section */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Tips multi-rekening</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-600 list-disc list-inside">
          <li>
            Punya 1 rekening per bank? Tambah saja sekali, kosongkan label.
          </li>
          <li>
            Punya 2 rekening BCA (Pusat + Cabang)? Tambah 2 entry dengan label berbeda
            (misal &ldquo;BCA Pusat&rdquo; dan &ldquo;BCA Cabang&rdquo;) — transaksi akan terpisah.
          </li>
          <li>
            Mau gabung 2 rekening BCA jadi 1 view? Tambah 1 entry tanpa label, upload PDF
            keduanya tagged ke entry sama — sistem otomatis dedup pakai No.Referensi.
          </li>
          <li>
            Toggle &ldquo;Aktif&rdquo; off kalau rekening sudah tidak dipakai — tidak akan muncul di
            dropdown saat cek mutasi.
          </li>
        </ul>
      </div>
    </div>
  );
}
