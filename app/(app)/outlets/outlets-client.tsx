"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PALETTE, pickNextColor, findColorLabel } from "@/lib/colors";
import type { Outlet } from "@/lib/types";
import { Plus, Trash2, Pencil, X, Check } from "lucide-react";

export function OutletsClient({
  initialOutlets,
  accountId,
}: {
  initialOutlets: Outlet[];
  accountId: string;
}) {
  const router = useRouter();
  const [outlets, setOutlets] = useState<Outlet[]>(initialOutlets);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const usedIndexes = outlets.map((o) => o.urutan_palette);
  const nextColor = pickNextColor(usedIndexes);

  async function handleAdd() {
    setError(null);
    const nama = newName.trim();
    if (!nama) {
      setError("Nama outlet tidak boleh kosong");
      return;
    }
    if (outlets.some((o) => o.nama.toLowerCase() === nama.toLowerCase())) {
      setError("Nama outlet sudah ada");
      return;
    }
    const supabase = createClient();
    const { data, error: insertErr } = await supabase
      .from("outlets")
      .insert({
        account_id: accountId,
        nama,
        warna_hex: nextColor.hex,
        urutan_palette: nextColor.index,
      })
      .select()
      .single();
    if (insertErr) {
      setError(insertErr.message);
      return;
    }
    setOutlets((prev) => [...prev, data as Outlet]);
    setNewName("");
    setAdding(false);
    startTransition(() => router.refresh());
  }

  async function handleDelete(id: string) {
    if (!confirm("Hapus outlet ini? Warnanya akan tersedia kembali untuk outlet baru.")) return;
    setError(null);
    const supabase = createClient();
    const { error: delErr } = await supabase.from("outlets").delete().eq("id", id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setOutlets((prev) => prev.filter((o) => o.id !== id));
    startTransition(() => router.refresh());
  }

  async function handleSaveEdit(id: string) {
    setError(null);
    const nama = editName.trim();
    if (!nama) {
      setError("Nama outlet tidak boleh kosong");
      return;
    }
    if (outlets.some((o) => o.id !== id && o.nama.toLowerCase() === nama.toLowerCase())) {
      setError("Nama outlet sudah ada");
      return;
    }
    const supabase = createClient();
    const { error: updErr } = await supabase.from("outlets").update({ nama }).eq("id", id);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    setOutlets((prev) => prev.map((o) => (o.id === id ? { ...o, nama } : o)));
    setEditingId(null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Outlet</h1>
          <p className="mt-1 text-sm text-slate-600">
            Daftar outlet beserta warna highlight masing-masing. Warna otomatis dipilihkan
            dari palette (20 warna).
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => {
              setAdding(true);
              setError(null);
            }}
            className="btn-primary"
          >
            <Plus className="h-4 w-4" />
            Tambah Outlet
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {adding && (
        <div className="card p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700">
                Nama outlet baru
              </label>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewName("");
                    setError(null);
                  }
                }}
                placeholder="Misal: Lhokseumawe"
                className="input-base mt-1"
              />
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xs text-slate-500 mb-1">Warna otomatis</span>
              <div
                className="w-10 h-10 rounded border border-slate-300"
                style={{ backgroundColor: nextColor.hex }}
                title={findColorLabel(nextColor.hex)}
              />
            </div>
            <button onClick={handleAdd} disabled={pending} className="btn-primary">
              <Check className="h-4 w-4" />
              Simpan
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setNewName("");
                setError(null);
              }}
              className="btn-secondary"
            >
              <X className="h-4 w-4" />
              Batal
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {outlets.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada outlet. Klik &ldquo;Tambah Outlet&rdquo; untuk mulai.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500 w-16">
                  Warna
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Nama Outlet
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Label
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500 w-32">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {outlets.map((o) => (
                <tr key={o.id}>
                  <td className="px-4 py-2">
                    <div
                      className="w-8 h-8 rounded border border-slate-300"
                      style={{ backgroundColor: o.warna_hex }}
                    />
                  </td>
                  <td className="px-4 py-2">
                    {editingId === o.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit(o.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="input-base"
                      />
                    ) : (
                      <span className="font-medium text-slate-900">{o.nama}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-slate-500">
                    {findColorLabel(o.warna_hex)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {editingId === o.id ? (
                      <div className="inline-flex gap-1">
                        <button
                          onClick={() => handleSaveEdit(o.id)}
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
                            setEditingId(o.id);
                            setEditName(o.nama);
                          }}
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
                          title="Edit nama"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(o.id)}
                          className="rounded p-1.5 text-red-600 hover:bg-red-50"
                          title="Hapus"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Palette warna tersedia</h2>
        <p className="mt-1 text-xs text-slate-500">
          {outlets.length}/{PALETTE.length} warna terpakai. Setelah {PALETTE.length} outlet,
          warna mulai diulang dengan urutan yang sama.
        </p>
        <div className="mt-3 grid grid-cols-10 gap-2">
          {PALETTE.map((p, i) => {
            const used = outlets.find((o) => o.urutan_palette === i);
            return (
              <div
                key={i}
                className="aspect-square rounded border relative"
                style={{
                  backgroundColor: p.hex,
                  borderColor: used ? "#0f172a" : "#cbd5e1",
                }}
                title={`${p.label}${used ? ` — ${used.nama}` : ""}`}
              >
                {used && (
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-slate-900">
                    ✓
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
