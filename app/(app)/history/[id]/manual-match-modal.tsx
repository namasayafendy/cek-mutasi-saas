"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, CheckCircle2, AlertCircle, Search, Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateID, parseDateISO, toDateISO } from "@/lib/format";
import type { InputRow, BankLite } from "./page";

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

export function ManualMatchModal({
  input,
  banks,
  accountId,
  userId,
  onClose,
}: {
  input: InputRow;
  banks: BankLite[];
  accountId: string;
  userId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputDate = parseDateISO(input.tanggal_input);
  const isKredit = input.jenis === "kredit";

  // Default range ±30 hari dari tanggal input
  const [bankFilter, setBankFilter] = useState<string>("_all"); // default semua bank (lebih membantu)
  const [from, setFrom] = useState<string>(() => {
    if (!inputDate) return input.tanggal_input;
    const d = new Date(inputDate);
    d.setUTCDate(d.getUTCDate() - 30);
    return toDateISO(d);
  });
  const [to, setTo] = useState<string>(() => {
    if (!inputDate) return input.tanggal_input;
    const d = new Date(inputDate);
    d.setUTCDate(d.getUTCDate() + 7);
    return toDateISO(d);
  });
  const [nominalFilter, setNominalFilter] = useState<"any" | "exact" | "near">("near");
  const [search, setSearch] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const bankMap = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

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
        .gte("tanggal", from)
        .lte("tanggal", to)
        .order("tanggal", { ascending: true })
        .order("jam", { ascending: true, nullsFirst: true })
        .limit(500);

      if (bankFilter !== "_all") q = q.eq("bank_id", bankFilter);
      // Filter by jenis (cuma yang sesuai input.jenis)
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

  // Apply nominal filter + search client-side
  const filtered = useMemo(() => {
    return candidates.filter((c) => {
      const amt = isKredit ? c.nominal_kredit : c.nominal_debet;
      if (nominalFilter === "exact" && amt !== input.nominal) return false;
      if (nominalFilter === "near") {
        // Within ±20% atau ±50k (whichever larger)
        const tol = Math.max(input.nominal * 0.2, 50000);
        if (Math.abs(amt - input.nominal) > tol) return false;
      }
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
  }, [candidates, nominalFilter, input.nominal, isKredit, search]);

  async function handlePick(c: Candidate) {
    if (!confirm(
      `Cocokkan input Rp ${formatRupiah(input.nominal)} dengan transaksi Rp ${formatRupiah(
        isKredit ? c.nominal_kredit : c.nominal_debet,
      )} (tgl ${c.tanggal})?`,
    )) return;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const now = new Date().toISOString();

    // Update cek_inputs: set match_status=manual_claimed, matched_tx_id, manual claim fields
    const { error: updErr } = await supabase
      .from("cek_inputs")
      .update({
        match_status: "manual_claimed",
        matched_tx_id: c.id,
        manual_claim_reason: "Cocokkan manual dari /history detail",
        manual_claimed_at: now,
        claim_category: "customer",
      })
      .eq("id", input.id);

    if (updErr) {
      setError(updErr.message);
      setSubmitting(false);
      return;
    }

    // Update parsed_transactions: set claimed
    const { error: updTxErr } = await supabase
      .from("parsed_transactions")
      .update({
        claimed_by_input_id: input.id,
        claimed_at: now,
      })
      .eq("id", c.id)
      .is("claimed_by_input_id", null);

    if (updTxErr) {
      setError(`Partial: input ter-update tapi tx gagal: ${updTxErr.message}`);
      setSubmitting(false);
      return;
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      account_id: accountId,
      user_id: userId,
      action: "input.manual_matched",
      target_type: "cek_input",
      target_id: input.id,
      metadata: {
        input_nominal: input.nominal,
        tx_id: c.id,
        tx_nominal: isKredit ? c.nominal_kredit : c.nominal_debet,
        tx_bank_id: c.bank_id,
        cross_bank: c.bank_id !== input.bank_id,
      },
    });

    setSubmitting(false);
    onClose();
    router.refresh();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            <Search className="h-4 w-4" />
            Cocokkan Manual
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Input info */}
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm space-y-0.5">
            <div className="text-xs text-blue-700">Input yang akan di-cocokkan</div>
            <div className="font-medium text-blue-900">
              Tgl {formatDateID(inputDate!)} · {input.jenis} · Rp {formatRupiah(input.nominal)}
              {input.bank_id && (
                <span className="ml-1 text-xs">
                  ({banks.find((b) => b.id === input.bank_id)?.label ||
                    banks.find((b) => b.id === input.bank_id)?.kode ||
                    "?"})
                </span>
              )}
              {!input.bank_id && (
                <span className="ml-1 text-xs text-purple-700">(semua bank)</span>
              )}
            </div>
            <div className="text-[11px] text-blue-700">
              Klik salah satu transaksi mutasi yang sesuai → input akan di-mark sebagai
              manual claim.
            </div>
          </div>

          {/* Filters */}
          <div className="card p-3 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
              <div>
                <label className="text-xs text-slate-500">Nominal</label>
                <select
                  value={nominalFilter}
                  onChange={(e) =>
                    setNominalFilter(e.target.value as "any" | "exact" | "near")
                  }
                  className="input mt-1"
                >
                  <option value="near">Mendekati (±20%)</option>
                  <option value="exact">Persis sama</option>
                  <option value="any">Bebas</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">Cari (pengirim/keterangan/no.ref)</label>
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

          {/* Candidates table */}
          <div className="card overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center justify-between">
              <span>Kandidat transaksi unclaimed</span>
              <span>
                {filtered.length} dari {candidates.length}
              </span>
            </div>
            {loading ? (
              <div className="p-6 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" />
                <p className="mt-1 text-xs text-slate-500">Memuat kandidat…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500">
                Tidak ada kandidat sesuai filter. Lebarkan range tanggal atau pilih nominal
                &quot;Bebas&quot;.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                    <tr>
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
                      <th className="px-3 py-2 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {filtered.map((c) => {
                      const tgl = parseDateISO(c.tanggal);
                      const amt = isKredit ? c.nominal_kredit : c.nominal_debet;
                      const bank = c.bank_id ? bankMap.get(c.bank_id) : null;
                      const isCrossBank =
                        input.bank_id && c.bank_id && input.bank_id !== c.bank_id;
                      return (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            {tgl ? formatDateID(tgl) : c.tanggal}
                            {c.jam && (
                              <div className="text-[10px] text-slate-500">{c.jam}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-xs">
                            {bank?.label || bank?.kode || "—"}
                            {isCrossBank && (
                              <span
                                className="ml-1 inline-flex items-center text-[10px] text-purple-700"
                                title="Bank berbeda dari input"
                              >
                                <Globe className="h-2.5 w-2.5" />
                              </span>
                            )}
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
                            {amt !== input.nominal && (
                              <div className="text-[10px] text-amber-600">
                                {amt > input.nominal ? "+" : ""}
                                {formatRupiah(amt - input.nominal)}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handlePick(c)}
                              disabled={submitting}
                              className="btn-primary text-xs px-2 py-1"
                            >
                              {submitting ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              Pilih
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <button onClick={onClose} className="btn-secondary text-sm" disabled={submitting}>
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
