"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, CheckCircle2, AlertCircle, Search, Globe } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateID, parseDateISO, toDateISO } from "@/lib/format";
import type { InputRow, BankLite } from "./page";
import { pushManualMatchToGadai } from "@/app/(app)/check/actions-gadai";

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

  const [bankFilter, setBankFilter] = useState<string>("_all");
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
  const [nominalFilter, setNominalFilter] = useState<"any" | "exact" | "near">("any");
  const [search, setSearch] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Multi-select state: set of selected tx ids
  const [selected, setSelected] = useState<Set<string>>(new Set());

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
      const amt = isKredit ? c.nominal_kredit : c.nominal_debet;
      if (nominalFilter === "exact" && amt !== input.nominal) return false;
      if (nominalFilter === "near") {
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

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Total nominal of selected tx
  const selectedTotal = useMemo(() => {
    return filtered
      .filter((c) => selected.has(c.id))
      .reduce(
        (sum, c) => sum + (isKredit ? c.nominal_kredit : c.nominal_debet),
        0,
      );
    // re-compute when selection or candidates change
  }, [filtered, selected, isKredit]);

  // Also include any selected items not in filtered (selected then filter changed)
  const selectedTxs = useMemo(
    () => candidates.filter((c) => selected.has(c.id)),
    [candidates, selected],
  );
  const selectedTotalAll = useMemo(
    () =>
      selectedTxs.reduce(
        (sum, c) => sum + (isKredit ? c.nominal_kredit : c.nominal_debet),
        0,
      ),
    [selectedTxs, isKredit],
  );
  const diff = selectedTotalAll - input.nominal;

  async function handleConfirm() {
    if (selected.size === 0 || submitting) return;
    const txIds = Array.from(selected);

    const confirmMsg =
      txIds.length === 1
        ? `Cocokkan input Rp ${formatRupiah(input.nominal)} dengan 1 transaksi (Rp ${formatRupiah(selectedTotalAll)})?`
        : `Cocokkan input Rp ${formatRupiah(input.nominal)} dengan ${txIds.length} transaksi (total Rp ${formatRupiah(selectedTotalAll)})?` +
          (diff !== 0
            ? `\n\nSelisih: ${diff > 0 ? "+" : ""}Rp ${formatRupiah(Math.abs(diff))}.`
            : "");

    if (!confirm(confirmMsg)) return;

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const now = new Date().toISOString();

    const reason =
      txIds.length === 1
        ? "Cocokkan manual dari /history detail"
        : `Cocokkan manual (${txIds.length} tx, total Rp ${formatRupiah(selectedTotalAll)})`;

    // Update cek_inputs: set match_status=manual_claimed, matched_tx_id (first tx),
    // manual claim fields
    const { error: updErr } = await supabase
      .from("cek_inputs")
      .update({
        match_status: "manual_claimed",
        matched_tx_id: txIds[0],
        manual_claim_reason: reason,
        manual_claimed_at: now,
        claim_category: "customer",
      })
      .eq("id", input.id);

    if (updErr) {
      setError(updErr.message);
      setSubmitting(false);
      return;
    }

    // Update ALL selected parsed_transactions: claim them all to this input
    const { error: updTxErr } = await supabase
      .from("parsed_transactions")
      .update({
        claimed_by_input_id: input.id,
        claimed_at: now,
        manual_claim_reason: reason,
      })
      .in("id", txIds)
      .is("claimed_by_input_id", null);

    if (updTxErr) {
      setError(`Partial: input ter-update tapi sebagian/semua tx gagal: ${updTxErr.message}`);
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
        tx_count: txIds.length,
        tx_ids: txIds,
        tx_total: selectedTotalAll,
        diff,
      },
    });

    // Kabari Aceh Gadai supaya klaimnya di sana ikut beres. Tanpa ini, owner
    // sudah membereskannya di sini tapi di sana tetap UNMATCHED selamanya dan
    // laporan rekonsiliasi terus menampilkan selisih yang sudah tidak ada.
    // Kegagalan di sini TIDAK membatalkan pencocokan yang sudah tersimpan —
    // hanya ditampilkan sebagai peringatan supaya bisa diulang.
    const klaimId = (input as { gadai_klaim_id?: string | null }).gadai_klaim_id;
    // HANYA kirim ke gadai kalau jumlahnya PAS. Aturan di sana: "cocok" berarti
    // selisih NOL rupiah, tanpa toleransi. Mengirim pencocokan yang masih
    // berselisih akan menutup klaimnya sebagai COCOK di gadai dan menghapus
    // selisih yang justru harus ditindaklanjuti (mis. nasabah kurang/lebih bayar).
    // Di sini tetap tersimpan sebagai manual_claimed — hanya tidak diakui gadai.
    if (klaimId && diff !== 0) {
      setError(
        `Pencocokan TERSIMPAN di sini, tapi TIDAK dikirim ke Aceh Gadai karena masih ada selisih ` +
        `${diff > 0 ? "+" : "-"}Rp ${formatRupiah(Math.abs(diff))}. Di sana "cocok" berarti selisih NOL. ` +
        `Selesaikan selisihnya dulu lewat menu Kotak Masuk Transfer di aplikasi gadai.`,
      );
      setSubmitting(false);
      return;
    }
    if (klaimId) {
      const push = await pushManualMatchToGadai(klaimId, reason);
      if (!push.ok) {
        setError(
          `Pencocokan TERSIMPAN di sini, tapi gagal mengabari Aceh Gadai (${push.error ?? "tidak diketahui"}). ` +
          `Di sana statusnya masih belum cocok — coba ulangi nanti.`,
        );
        setSubmitting(false);
        return;
      }
    }

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
            <Search className="h-4 w-4" />
            Cocokkan Manual
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
              Centang 1 atau lebih transaksi mutasi yang sesuai (mis. customer transfer 2x).
              Tidak harus exact — sistem terima berapa saja.
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
                  <option value="any">Bebas (Recommended)</option>
                  <option value="near">Mendekati (±20%)</option>
                  <option value="exact">Persis sama</option>
                </select>
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
                      <th className="px-2 py-2 text-left w-10">
                        <span className="sr-only">Pilih</span>
                      </th>
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
                      const isCrossBank =
                        input.bank_id && c.bank_id && input.bank_id !== c.bank_id;
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Sticky summary bar */}
          <div className="rounded-md border border-slate-200 bg-white p-3 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Input nominal</span>
              <span className="font-mono font-medium text-slate-900">
                Rp {formatRupiah(input.nominal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">
                Dipilih: {selected.size} transaksi
              </span>
              <span className="font-mono font-medium text-emerald-700">
                Rp {formatRupiah(selectedTotalAll)}
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
                <CheckCircle2 className="h-4 w-4" />
              )}
              Cocokkan ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
