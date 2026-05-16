"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Filter,
  Loader2,
  RotateCcw,
  Hand,
  ChevronLeft,
  Eye,
  Building2,
  TrendingUp,
  TrendingDown,
  Printer,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateID, parseDateISO, toDateISO } from "@/lib/format";
import { TransactionDetailModal } from "./transaction-detail-modal";
import { ManualClaimModal, type UnclaimedTx } from "./manual-claim-modal";
import { downloadMutasiPdf } from "./generate-mutasi-pdf";
import { DeleteConfirmModal } from "./delete-confirm-modal";

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null; is_active?: boolean };

type MutasiRow = {
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
  saldo: number | null;
  claimed_by_input_id: string | null;
  manual_claim_reason: string | null;
  claimed_at: string | null;
  created_at: string;
};

type ClaimedInputInfo = {
  id: string;
  outlet_id: string | null;
  session_id: string | null;
  tanggal_input: string;
  manual_claim_reason: string | null;
  manual_claimed_at: string | null;
  created_at: string;
};

type BankCardStats = {
  bankId: string;
  totalKredit: number;
  totalDebet: number;
  txCount: number;
  lastTxDate: string | null;
};

type FilterState = {
  from: string;
  to: string;
  jenis: "all" | "kredit" | "debet";
  status: "all" | "matched" | "unmatched";
};

function getDefaultFilter(): FilterState {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return {
    from: toDateISO(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))),
    to: toDateISO(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))),
    jenis: "all",
    status: "all",
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return `rgba(203, 213, 225, ${alpha})`;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function MutasiTab({
  banks,
  outlets,
  accountId,
  userId,
  brandName,
}: {
  banks: BankLite[];
  outlets: OutletLite[];
  accountId: string;
  userId: string;
  brandName: string;
}) {
  const [view, setView] = useState<"cards" | "detail">("cards");
  const [activeBankId, setActiveBankId] = useState<string>("");
  const [bankStats, setBankStats] = useState<BankCardStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const [filter, setFilter] = useState<FilterState>(getDefaultFilter);
  const [rows, setRows] = useState<MutasiRow[]>([]);
  const [inputsMap, setInputsMap] = useState<Map<string, ClaimedInputInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<MutasiRow | null>(null);
  const [claimingTx, setClaimingTx] = useState<UnclaimedTx | null>(null);
  const [printing, setPrinting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const bankMap = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  // Fetch overall stats per bank (last 12 months) untuk cards view
  useEffect(() => {
    if (banks.length === 0) {
      setStatsLoading(false);
      return;
    }
    let cancelled = false;
    async function fetchStats() {
      setStatsLoading(true);
      const supabase = createClient();
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);

      const { data, error } = await supabase
        .from("parsed_transactions")
        .select("bank_id, nominal_kredit, nominal_debet, tanggal")
        .is("deleted_at", null)
        .gte("tanggal", toDateISO(yearAgo))
        .order("tanggal", { ascending: false })
        .limit(50000);

      if (cancelled) return;
      if (error) {
        setStatsLoading(false);
        return;
      }

      const statsMap = new Map<string, BankCardStats>();
      for (const b of banks) {
        statsMap.set(b.id, {
          bankId: b.id,
          totalKredit: 0,
          totalDebet: 0,
          txCount: 0,
          lastTxDate: null,
        });
      }

      for (const r of data ?? []) {
        const bid = r.bank_id as string | null;
        if (!bid) continue;
        const s = statsMap.get(bid);
        if (!s) continue;
        s.totalKredit += r.nominal_kredit;
        s.totalDebet += r.nominal_debet;
        s.txCount += 1;
        if (s.lastTxDate === null) {
          s.lastTxDate = r.tanggal;
        }
      }

      setBankStats(Array.from(statsMap.values()));
      setStatsLoading(false);
    }
    fetchStats();
    return () => {
      cancelled = true;
    };
  }, [banks]);

  // Fetch detail rows when bank is selected and view is detail
  useEffect(() => {
    if (view !== "detail" || !activeBankId) return;
    let cancelled = false;
    async function fetchRows() {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const { data, error } = await supabase
        .from("parsed_transactions")
        .select(
          "id, bank_id, no_ref, tanggal, jam, nominal_kredit, nominal_debet, nama_pengirim, nama_penerima, deskripsi, saldo, claimed_by_input_id, manual_claim_reason, claimed_at, created_at",
        )
        .eq("bank_id", activeBankId)
        .is("deleted_at", null)
        .gte("tanggal", filter.from)
        .lte("tanggal", filter.to)
        .order("tanggal", { ascending: true })
        .order("jam", { ascending: true, nullsFirst: true })
        .limit(5000);

      if (cancelled) return;
      if (error) {
        setError(error.message);
        setRows([]);
        setLoading(false);
        return;
      }

      const all = (data ?? []) as MutasiRow[];
      const filtered = all.filter((r) => {
        if (filter.jenis === "kredit" && r.nominal_kredit <= 0) return false;
        if (filter.jenis === "debet" && r.nominal_debet <= 0) return false;
        if (filter.status === "matched" && !r.claimed_by_input_id) return false;
        if (filter.status === "unmatched" && r.claimed_by_input_id) return false;
        return true;
      });

      const inputIds = Array.from(
        new Set(filtered.map((r) => r.claimed_by_input_id).filter((v): v is string => !!v)),
      );
      const newInputsMap = new Map<string, ClaimedInputInfo>();
      if (inputIds.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < inputIds.length; i += CHUNK) {
          const slice = inputIds.slice(i, i + CHUNK);
          const { data: ciData, error: ciErr } = await supabase
            .from("cek_inputs")
            .select(
              "id, outlet_id, session_id, tanggal_input, manual_claim_reason, manual_claimed_at, created_at",
            )
            .in("id", slice);
          if (ciErr) continue;
          for (const row of (ciData ?? []) as ClaimedInputInfo[]) {
            newInputsMap.set(row.id, row);
          }
        }
      }

      if (cancelled) return;
      setRows(filtered);
      setInputsMap(newInputsMap);
      setLoading(false);
    }
    fetchRows();
    return () => {
      cancelled = true;
    };
  }, [view, activeBankId, filter]);

  function openBankDetail(bankId: string) {
    setActiveBankId(bankId);
    setFilter(getDefaultFilter());
    setView("detail");
  }

  function backToCards() {
    setView("cards");
    setRows([]);
    setSelectedTx(null);
  }

  function applyPreset(days: number) {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - days);
    setFilter((p) => ({
      ...p,
      from: toDateISO(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))),
      to: toDateISO(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))),
    }));
  }

  function applyMonth(offset: number) {
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const start = new Date(Date.UTC(target.getFullYear(), target.getMonth(), 1));
    const endDate = new Date(Date.UTC(target.getFullYear(), target.getMonth() + 1, 0));
    setFilter((p) => ({ ...p, from: toDateISO(start), to: toDateISO(endDate) }));
  }

  async function handlePrint() {
    if (rows.length === 0 || printing) return;
    setPrinting(true);
    try {
      await downloadMutasiPdf({
        brandName,
        bank: bankMap.get(activeBankId) ?? null,
        filter,
        rows,
        inputsMap,
        outlets,
      });
    } catch (err) {
      console.error("Failed to generate mutasi PDF", err);
      setError("Gagal generate PDF: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setPrinting(false);
    }
  }

  async function handleRangeDelete() {
    setError(null);
    const supabase = createClient();
    const now = new Date().toISOString();

    // Soft-delete parsed_transactions in (bank, date range).
    // Also release any claims and soft-delete the corresponding cek_inputs
    // & cek_sessions whose inputs are now all deleted, so the privacy promise
    // ("data hilang") is honored end-to-end.
    const { data: txList, error: txErr } = await supabase
      .from("parsed_transactions")
      .select("id, claimed_by_input_id")
      .eq("bank_id", activeBankId)
      .is("deleted_at", null)
      .gte("tanggal", filter.from)
      .lte("tanggal", filter.to);
    if (txErr) throw txErr;

    const txIds = (txList ?? []).map((r) => r.id);
    const claimedInputIds = Array.from(
      new Set(
        (txList ?? [])
          .map((r) => r.claimed_by_input_id)
          .filter((v): v is string => !!v),
      ),
    );

    if (txIds.length > 0) {
      const { error: e1 } = await supabase
        .from("parsed_transactions")
        .update({ deleted_at: now })
        .in("id", txIds);
      if (e1) throw e1;
    }

    // Cascade: soft-delete cek_inputs that referenced these tx
    if (claimedInputIds.length > 0) {
      const { error: e2 } = await supabase
        .from("cek_inputs")
        .update({ deleted_at: now })
        .in("id", claimedInputIds);
      if (e2) throw e2;

      // Cascade further: soft-delete cek_sessions where ALL inputs are now deleted
      const { data: inputs } = await supabase
        .from("cek_inputs")
        .select("session_id")
        .in("id", claimedInputIds);
      const sessionIds = Array.from(
        new Set((inputs ?? []).map((i) => i.session_id).filter((v): v is string => !!v)),
      );
      for (const sid of sessionIds) {
        const { count: aliveCount } = await supabase
          .from("cek_inputs")
          .select("id", { count: "exact", head: true })
          .eq("session_id", sid)
          .is("deleted_at", null);
        if ((aliveCount ?? 0) === 0) {
          await supabase
            .from("cek_sessions")
            .update({ deleted_at: now })
            .eq("id", sid);
        }
      }
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      account_id: accountId,
      user_id: userId,
      action: "history.range_delete",
      target_type: "parsed_transactions",
      target_id: activeBankId,
      metadata: {
        bank_id: activeBankId,
        from: filter.from,
        to: filter.to,
        deleted_tx: txIds.length,
        cascaded_inputs: claimedInputIds.length,
      },
    });

    setShowDelete(false);
    // Refresh by re-running the effect
    setRows([]);
    setBankStats((prev) => prev.map((s) => ({ ...s }))); // trigger refresh
    setActiveBankId(activeBankId); // re-trigger fetchRows
    // simplest refresh: navigate-replace via location
    window.location.reload();
  }

  if (banks.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-slate-600">
          Belum ada bank. Tambah bank dulu di menu Bank.
        </p>
      </div>
    );
  }

  // ===== CARDS VIEW =====
  if (view === "cards") {
    return (
      <div className="space-y-3">
        <div className="text-sm text-slate-600">
          Klik bank untuk lihat rincian mutasi (12 bulan terakhir, atau filter range).
        </div>

        {statsLoading ? (
          <div className="card p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="mt-2 text-sm text-slate-500">Memuat data bank...</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {banks.map((b) => {
              const s = bankStats.find((x) => x.bankId === b.id);
              return (
                <BankCard
                  key={b.id}
                  bank={b}
                  stats={s}
                  onView={() => openBankDetail(b.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ===== DETAIL VIEW =====
  const activeBank = bankMap.get(activeBankId);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={backToCards}
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
        >
          <ChevronLeft className="h-4 w-4" /> Kembali ke daftar bank
        </button>
        <div className="text-sm font-medium text-slate-900">
          {activeBank ? activeBank.label || activeBank.kode : "—"}
        </div>
      </div>

      <div className="card p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Filter className="h-4 w-4" /> Filter
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500">Dari</label>
            <input
              type="date"
              className="input mt-1"
              value={filter.from}
              onChange={(e) => setFilter((p) => ({ ...p, from: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Sampai</label>
            <input
              type="date"
              className="input mt-1"
              value={filter.to}
              onChange={(e) => setFilter((p) => ({ ...p, to: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Jenis</label>
            <select
              className="input mt-1"
              value={filter.jenis}
              onChange={(e) => setFilter((p) => ({ ...p, jenis: e.target.value as FilterState["jenis"] }))}
            >
              <option value="all">Semua</option>
              <option value="kredit">Kredit (masuk)</option>
              <option value="debet">Debet (keluar)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Status</label>
            <select
              className="input mt-1"
              value={filter.status}
              onChange={(e) => setFilter((p) => ({ ...p, status: e.target.value as FilterState["status"] }))}
            >
              <option value="all">Semua</option>
              <option value="matched">Sudah match</option>
              <option value="unmatched">Belum match</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
          <span className="text-xs text-slate-500 mr-1">Cepat:</span>
          <button type="button" className="chip" onClick={() => applyPreset(7)}>
            7 hari
          </button>
          <button type="button" className="chip" onClick={() => applyPreset(30)}>
            30 hari
          </button>
          <button type="button" className="chip" onClick={() => applyPreset(90)}>
            90 hari
          </button>
          <button type="button" className="chip" onClick={() => applyMonth(0)}>
            Bulan ini
          </button>
          <button type="button" className="chip" onClick={() => applyMonth(-1)}>
            Bulan lalu
          </button>
          <button
            type="button"
            className="chip ml-auto inline-flex items-center gap-1"
            onClick={() => setFilter(getDefaultFilter())}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-4 border-red-200 bg-red-50 text-red-800 text-sm">
          Gagal memuat: {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <h2 className="font-medium text-slate-900">
            Mutasi Rekening{" "}
            {activeBank && (
              <span className="text-sm text-slate-600">
                — {activeBank.label || activeBank.kode}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {rows.length} transaksi
              {rows.length >= 5000 && " (dipotong di 5000)"}
            </span>
            <button
              type="button"
              onClick={handlePrint}
              disabled={printing || loading || rows.length === 0}
              className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Print PDF hasil filter"
            >
              {printing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Printer className="h-3.5 w-3.5" />
              )}
              Print PDF
            </button>
            <button
              type="button"
              onClick={() => setShowDelete(true)}
              disabled={loading || rows.length === 0}
              className="text-xs inline-flex items-center gap-1.5 text-red-700 hover:text-red-900 disabled:opacity-50 disabled:cursor-not-allowed border border-red-200 hover:border-red-300 rounded-md px-2.5 py-1.5"
              title="Hapus data periode ini (privacy)"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Hapus Data
            </button>
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="mt-2 text-sm text-slate-500">Memuat mutasi...</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Tidak ada transaksi sesuai filter.
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Tgl / Jam
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Pengirim / Keterangan
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                    Kredit
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                    Debet
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                    Saldo
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Outlet
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => {
                  const tgl = parseDateISO(r.tanggal);
                  const isMatched = !!r.claimed_by_input_id;
                  const ci = r.claimed_by_input_id
                    ? inputsMap.get(r.claimed_by_input_id)
                    : null;
                  const outlet = ci?.outlet_id ? outletMap.get(ci.outlet_id) : null;
                  const isManual = !!ci?.manual_claim_reason || !!r.manual_claim_reason;
                  // Manual claim (apapun bentuknya) → SELALU abu gelap (system color).
                  // Auto-match → warna outlet.
                  const rowStyle = !isMatched
                    ? undefined
                    : isManual
                      ? { backgroundColor: hexToRgba("#334155", 0.13) }
                      : outlet
                        ? { backgroundColor: hexToRgba(outlet.warna_hex, 0.18) }
                        : undefined;

                  return (
                    <tr
                      key={r.id}
                      style={rowStyle}
                      className={`cursor-pointer hover:bg-slate-100/40 transition-colors ${isMatched ? "" : "bg-white"}`}
                      onClick={() => setSelectedTx(r)}
                    >
                      <td className="px-3 py-2 text-slate-700 whitespace-nowrap">
                        <div>{tgl ? formatDateID(tgl) : r.tanggal}</div>
                        {r.jam && (
                          <div className="text-[10px] text-slate-500">{r.jam}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs max-w-md">
                        <div className="font-medium text-slate-800">
                          {r.nama_pengirim || r.nama_penerima || "—"}
                        </div>
                        {r.deskripsi && (
                          <div className="text-slate-500 truncate" title={r.deskripsi}>
                            {r.deskripsi}
                          </div>
                        )}
                        {r.no_ref && (
                          <div className="text-[10px] text-slate-400">Ref: {r.no_ref}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-green-700">
                        {r.nominal_kredit > 0 ? formatRupiah(r.nominal_kredit) : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-red-700">
                        {r.nominal_debet > 0 ? formatRupiah(r.nominal_debet) : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-600 text-xs">
                        {r.saldo !== null ? formatRupiah(r.saldo) : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {isMatched ? (
                          <div className="flex items-center gap-1.5">
                            {outlet && (
                              <span
                                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: outlet.warna_hex }}
                              />
                            )}
                            <span className="text-slate-700">
                              {outlet?.nama ?? "—"}
                            </span>
                            {isManual && (
                              <span title="Manual claim">
                                <Hand className="h-3 w-3 text-blue-600 flex-shrink-0" />
                              </span>
                            )}
                            <CheckCircle2 className="h-3 w-3 text-green-600 -mt-0.5" />
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">belum match</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedTx && (
        <TransactionDetailModal
          tx={selectedTx}
          inputInfo={
            selectedTx.claimed_by_input_id
              ? inputsMap.get(selectedTx.claimed_by_input_id) ?? null
              : null
          }
          outlet={
            selectedTx.claimed_by_input_id
              ? (() => {
                  const ci = inputsMap.get(selectedTx.claimed_by_input_id);
                  return ci?.outlet_id ? outletMap.get(ci.outlet_id) ?? null : null;
                })()
              : null
          }
          bank={selectedTx.bank_id ? bankMap.get(selectedTx.bank_id) ?? null : null}
          onClose={() => setSelectedTx(null)}
          onClaimManual={() => {
            // Convert MutasiRow → UnclaimedTx (subset of fields)
            setClaimingTx({
              id: selectedTx.id,
              bank_id: selectedTx.bank_id,
              no_ref: selectedTx.no_ref,
              tanggal: selectedTx.tanggal,
              jam: selectedTx.jam,
              nominal_kredit: selectedTx.nominal_kredit,
              nominal_debet: selectedTx.nominal_debet,
              nama_pengirim: selectedTx.nama_pengirim,
              nama_penerima: selectedTx.nama_penerima,
              deskripsi: selectedTx.deskripsi,
            });
            setSelectedTx(null);
          }}
        />
      )}

      {showDelete && activeBank && (
        <DeleteConfirmModal
          title="Hapus Data Mutasi Periode Ini"
          description={`Anda akan menghapus semua transaksi mutasi ${activeBank.label || activeBank.kode} di periode yang difilter, termasuk data input customer dan sesi yang terkait.`}
          details={[
            { label: "Bank", value: activeBank.label || activeBank.kode },
            { label: "Periode", value: `${filter.from} sd ${filter.to}` },
            { label: "Jumlah transaksi", value: String(rows.length) },
          ]}
          onCancel={() => setShowDelete(false)}
          onConfirm={handleRangeDelete}
        />
      )}

      {claimingTx && (
        <ManualClaimModal
          tx={claimingTx}
          outlets={outlets}
          banks={banks}
          accountId={accountId}
          userId={userId}
          onClose={() => setClaimingTx(null)}
          onClaimed={(info) => {
            // Fix 2026-05-15: optimistic local update — bikin row langsung
            // ter-highlight tanpa nunggu re-fetch. router.refresh() di modal
            // hanya re-run server components, sedangkan rows + inputsMap di
            // sini di-fetch client-side via useEffect.
            const now = new Date().toISOString();
            setRows((prev) =>
              prev.map((r) =>
                r.id === info.txId
                  ? {
                      ...r,
                      claimed_by_input_id: info.inputId,
                      manual_claim_reason: info.reason,
                      claimed_at: now,
                    }
                  : r,
              ),
            );
            setInputsMap((prev) => {
              const next = new Map(prev);
              next.set(info.inputId, {
                id: info.inputId,
                outlet_id: info.outletId,
                session_id: null,
                tanggal_input: info.tanggalInput,
                manual_claim_reason: info.reason,
                manual_claimed_at: now,
                created_at: now,
              });
              return next;
            });
          }}
        />
      )}
    </div>
  );
}

// ===== Bank Card Component =====

function BankCard({
  bank,
  stats,
  onView,
}: {
  bank: BankLite;
  stats: BankCardStats | undefined;
  onView: () => void;
}) {
  const totalKredit = stats?.totalKredit ?? 0;
  const totalDebet = stats?.totalDebet ?? 0;
  const txCount = stats?.txCount ?? 0;
  const isActive = bank.is_active !== false;

  return (
    <div
      onClick={isActive ? onView : undefined}
      className={`group relative overflow-hidden rounded-2xl bg-white border border-slate-200 p-5 transition-all
        ${
          isActive
            ? "cursor-pointer shadow-md hover:shadow-2xl hover:-translate-y-1 hover:border-[#10B981]/40"
            : "opacity-60 cursor-not-allowed"
        }`}
      style={{
        boxShadow: isActive
          ? "0 1px 2px 0 rgba(15, 46, 31, 0.05), 0 4px 12px -2px rgba(15, 46, 31, 0.08)"
          : undefined,
      }}
    >
      {/* Decorative bg gradient (3D depth) */}
      <div
        className={`absolute -top-16 -right-16 h-40 w-40 rounded-full transition-all ${
          isActive
            ? "bg-gradient-to-br from-[#10B981]/10 to-[#10B981]/0 group-hover:from-[#10B981]/20"
            : "bg-slate-100"
        }`}
      />
      <div
        className={`absolute -bottom-10 -left-10 h-28 w-28 rounded-full ${
          isActive ? "bg-[#0F2E1F]/5" : "bg-slate-50"
        }`}
      />

      <div className="relative">
        {/* Top: bank name + status */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div
              className={`inline-flex items-center justify-center w-11 h-11 rounded-xl shadow-md ${
                isActive
                  ? "bg-gradient-to-br from-[#1a4530] to-[#0F2E1F] text-white"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#0F2E1F] text-base leading-tight">
                {bank.label || bank.kode}
              </h3>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">
                {bank.kode}
              </div>
            </div>
          </div>
          {isActive ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#10B981]/10 text-[#10B981] text-[10px] font-semibold px-2 py-0.5 border border-[#10B981]/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
              AKTIF
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold px-2 py-0.5">
              OFF
            </span>
          )}
        </div>

        {/* Stats — kredit & debet 12 bulan */}
        <div className="space-y-2 rounded-xl bg-[#FAFAF7] border border-slate-100 p-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600 flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-[#10B981]" />
              Kredit (12 bulan)
            </span>
            <span className="font-mono font-semibold text-[#10B981] text-sm">
              Rp {formatRupiah(totalKredit)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600 flex items-center gap-1.5">
              <TrendingDown className="h-3.5 w-3.5 text-red-600" />
              Debet (12 bulan)
            </span>
            <span className="font-mono font-semibold text-red-700 text-sm">
              Rp {formatRupiah(totalDebet)}
            </span>
          </div>
        </div>

        {/* CTA */}
        <div
          className={`inline-flex items-center justify-center w-full gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors ${
            isActive
              ? "bg-[#0F2E1F] text-white group-hover:bg-[#1a4530]"
              : "bg-slate-200 text-slate-400"
          }`}
        >
          <Eye className="h-4 w-4" />
          Lihat Mutasi
          <span
            className={`inline-flex items-center justify-center min-w-[1.5rem] h-5 rounded-full text-[10px] ml-1 ${
              isActive ? "bg-white/20" : "bg-slate-300/50"
            }`}
          >
            {txCount}
          </span>
        </div>
      </div>
    </div>
  );
}
