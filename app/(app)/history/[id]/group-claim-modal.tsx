"use client";

// Group Claim Modal — case 2: cocokkan N leftover inputs ke M tx mutasi
// dengan total bebas (tidak harus exact). Owner pakai ini saat customer bayar
// jumlahnya tidak match per-input tapi total-nya pas (mis. 2 input 1jt+500rb,
// settled by 2 tx 700rb+800rb).

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, CheckCircle2, AlertCircle, Layers, Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateID, parseDateISO, toDateISO } from "@/lib/format";
import type { InputRow, BankLite, OutletLite } from "./page";

type Candidate = {
  id: string;
  bank_id: string | null;
  no_ref: string | null;
  tanggal: string;
  jam: string | null;
  nominal_kredit: number;
  nominal_debet: number;
  nama_pengirim: string | null;
  nama_penerima: string | null;
  deskripsi: string | null;
};

export function GroupClaimModal({
  inputs,
  outlets,
  banks,
  accountId,
  userId,
  onClose,
}: {
  inputs: InputRow[];
  outlets: OutletLite[];
  banks: BankLite[];
  accountId: string;
  userId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const isKredit = inputs[0]?.jenis === "kredit";
  const inputTotal = useMemo(
    () => inputs.reduce((sum, i) => sum + i.nominal, 0),
    [inputs],
  );
  const earliestInput = useMemo(() => {
    const dates = inputs.map((i) => i.tanggal_input).sort();
    return parseDateISO(dates[0]) ?? new Date();
  }, [inputs]);
  const latestInput = useMemo(() => {
    const dates = inputs.map((i) => i.tanggal_input).sort();
    return parseDateISO(dates[dates.length - 1]) ?? new Date();
  }, [inputs]);

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const bankMap = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  const [bankFilter, setBankFilter] = useState<string>("_all");
  const [from, setFrom] = useState<string>(() => {
    const d = new Date(earliestInput);
    d.setUTCDate(d.getUTCDate() - 30);
    return toDateISO(d);
  });
  const [to, setTo] = useState<string>(() => {
    const d = new Date(latestInput);
    d.setUTCDate(d.getUTCDate() + 7);
    return toDateISO(d);
  });
  const [search, setSearch] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function fetchCandidates() {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      let q = supabase
        .from("parsed_transactions")
        .select(
          "id, bank_id, no_ref, tanggal, jam, nominal_kredit, nominal_debet, nama_pengirim, nama_penerima, deskripsi",
        )
        .eq("account_id", accountId)
        .is("claimed_by_input_id", null)
        .is("deleted_at", null)
        .gte("tanggal", from)
        .lte("tanggal", to)
        .order("tanggal", { ascending: true })
        .order("jam", { ascending: true, nullsFirst: true })
        .limit(500);

      if (bankFilter !== "_all") q = q.eq("bank_id", bankFilter);
      if (isKredit) q = q.gt("nominal_kredit", 0);
      else q = q.gt("nominal_debet", 0);

      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setCandidates([]);
      } else {
        setCandidates((data ?? []) as Candidate[]);
      }
      setLoading(false);
    }
    fetchCandidates();
    return () => {
      cancelled = true;
    };
  }, [accountId, bankFilter, from, to, isKredit]);

  const filtered = useMemo(() => {
    return candidates.filter((c) => {
      if (search) {
        const q = search.toLowerCase();
        const hay = [c.nama_pengirim, c.nama_penerima, c.deskripsi, c.no_ref]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [candidates, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedTxs = useMemo(
    () => candidates.filter((c) => selected.has(c.id)),
    [candidates, selected],
  );
  const selectedTotal = useMemo(
    () =>
      selectedTxs.reduce(
        (sum, c) => sum + (isKredit ? c.nominal_kredit : c.nominal_debet),
        0,
      ),
    [selectedTxs, isKredit],
  );
  const diff = selectedTotal - inputTotal;

  async function handleConfirm() {
    if (selected.size === 0 || submitting) return;
    const txIds = Array.from(selected);
    const inputIds = inputs.map((i) => i.id);

    const confirmMsg =
      `Group Claim:\n` +
      `→ ${inputIds.length} input (total Rp ${formatRupiah(inputTotal)})\n` +
      `→ ${txIds.length} transaksi (total Rp ${formatRupiah(selectedTotal)})\n` +
      (diff !== 0
        ? `\nSelisih: ${diff > 0 ? "+" : ""}Rp ${formatRupiah(Math.abs(diff))}\n`
        : `\n(total cocok)\n`) +
      `\nLanjutkan?`;

    if (!confirm(confirmMsg)) return;

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const now = new Date().toISOString();

    // Group label for traceability
    const groupTag = `Group claim ${inputIds.length}→${txIds.length} (total Rp ${formatRupiah(selectedTotal)})`;

    // Mark all inputs as manual_claimed
    const { error: e1 } = await supabase
      .from("cek_inputs")
      .update({
        match_status: "manual_claimed",
        matched_tx_id: txIds[0],
        manual_claim_reason: groupTag,
        manual_claimed_at: now,
        claim_category: "customer",
      })
      .in("id", inputIds);

    if (e1) {
      setError(e1.message);
      setSubmitting(false);
      return;
    }

    // Mark all tx as claimed by first input (link visualizes as "manual claim")
    const { error: e2 } = await supabase
      .from("parsed_transactions")
      .update({
        claimed_by_input_id: inputIds[0],
        claimed_at: now,
        manual_claim_reason: groupTag,
      })
      .in("id", txIds)
      .is("claimed_by_input_id", null);

    if (e2) {
      setError(`Partial: input ter-update tapi tx gagal: ${e2.message}`);
      setSubmitting(false);
      return;
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      account_id: accountId,
      user_id: userId,
      action: "input.group_claimed",
      target_type: "cek_input",
      target_id: inputIds[0],
      metadata: {
        input_ids: inputIds,
        tx_ids: txIds,
        input_total: inputTotal,
        tx_total: selectedTotal,
        diff,
      },
    });

    setSubmitting(false);
    onClose();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Group Claim — {inputs.length} input
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Inputs being grouped */}
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 space-y-1.5">
            <div className="text-xs text-blue-700 font-medium">
              {inputs.length} input akan di-group claim:
            </div>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
              {inputs.map((i) => {
                const outlet = i.outlet_id ? outletMap.get(i.outlet_id) : null;
                return (
                  <li
                    key={i.id}
                    className="text-xs flex items-center justify-between bg-white border border-blue-100 rounded px-2 py-1"
                  >
                    <span className="flex items-center gap-1.5">
                      {outlet && (
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: outlet.warna_hex }}
                        />
                      )}
                      <span className="text-slate-700">
                        {formatDateID(parseDateISO(i.tanggal_input)!)}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-700">
                        {outlet?.nama ?? "(no outlet)"}
                      </span>
                    </span>
                    <span className="font-mono font-medium text-slate-900">
                      Rp {formatRupiah(i.nominal)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between text-sm pt-1.5 border-t border-blue-200">
              <span className="text-blue-700 font-medium">Total input</span>
              <span className="font-mono font-semibold text-blue-900">
                Rp {formatRupiah(inputTotal)}
              </span>
            </div>
          </div>

          {/* Tx filters */}
          <div className="card p-3 space-y-2">
            <div className="text-xs text-slate-500 font-medium">
              Pilih transaksi mutasi yang membayar group ini:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-xs text-slate-500">Bank</label>
                <select
                  value={bankFilter}
                  onChange={(e) => setBankFilter(e.target.value)}
                  className="input mt-1"
                >
                  <option value="_all">🌐 Semua bank</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label || b.kode}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">Dari</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="input mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">Sampai</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="input mt-1"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Cari (pengirim/keterangan/no.ref)
              </label>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Misal: nama customer, kata kunci"
                className="input mt-1"
              />
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Tx list */}
          <div className="card overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center justify-between">
              <span>Kandidat transaksi unclaimed</span>
              <span>{filtered.length} kandidat</span>
            </div>
            {loading ? (
              <div className="p-6 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" />
                <p className="mt-1 text-xs text-slate-500">Memuat kandidat…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                Tidak ada kandidat. Lebarkan range tanggal atau ganti bank filter.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left w-10"></th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                        Tgl
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                        Bank
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                        Pengirim / Keterangan
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                        Nominal
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filtered.map((c) => {
                      const tgl = parseDateISO(c.tanggal);
                      const amt = isKredit ? c.nominal_kredit : c.nominal_debet;
                      const bank = c.bank_id ? bankMap.get(c.bank_id) : null;
                      const isChecked = selected.has(c.id);
                      return (
                        <tr
                          key={c.id}
                          onClick={() => toggle(c.id)}
                          className={`cursor-pointer ${
                            isChecked ? "bg-emerald-50" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggle(c.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 accent-emerald-600 cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            {tgl ? formatDateID(tgl) : c.tanggal}
                            {c.jam && (
                              <div className="text-[10px] text-slate-500">{c.jam}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {bank?.label || bank?.kode || "—"}
                          </td>
                          <td className="px-3 py-2 text-xs max-w-md">
                            <div className="font-medium text-slate-800 truncate">
                              {c.nama_pengirim || c.nama_penerima || "—"}
                            </div>
                            {c.deskripsi && (
                              <div className="text-slate-500 text-[10px] truncate">
                                {c.deskripsi}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            Rp {formatRupiah(amt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Input total ({inputs.length})</span>
              <span className="font-mono font-medium text-slate-900">
                Rp {formatRupiah(inputTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Tx dipilih ({selected.size})
              </span>
              <span className="font-mono font-medium text-emerald-700">
                Rp {formatRupiah(selectedTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm pt-1.5 border-t border-slate-100">
              <span className="text-slate-600">Selisih</span>
              <span
                className={`font-mono font-semibold ${
                  diff === 0
                    ? "text-emerald-700"
                    : diff > 0
                      ? "text-amber-700"
                      : "text-red-700"
                }`}
              >
                {diff === 0
                  ? "Rp 0 (cocok)"
                  : `${diff > 0 ? "+" : "-"}Rp ${formatRupiah(Math.abs(diff))}`}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={onClose}
              className="btn-secondary text-sm"
              disabled={submitting}
            >
              Batal
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting || selected.size === 0}
              className="text-sm inline-flex items-center gap-1.5 bg-[#0F2E1F] hover:bg-[#1a4530] disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-md px-4 py-2 font-medium transition-colors"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Layers className="h-4 w-4" />
              )}
              Group Claim ({inputs.length} → {selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
