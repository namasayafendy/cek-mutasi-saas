"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Filter,
  Loader2,
  RotateCcw,
  Hand,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateID, parseDateISO, toDateISO } from "@/lib/format";

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

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
};

type ClaimedInputInfo = {
  id: string;
  outlet_id: string | null;
  session_id: string | null;
  tanggal_input: string;
  manual_claim_reason: string | null;
  manual_claimed_at: string | null;
};

type FilterState = {
  bankId: string;
  from: string;
  to: string;
  jenis: "all" | "kredit" | "debet";
  status: "all" | "matched" | "unmatched";
};

function getDefault(banks: BankLite[]): FilterState {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return {
    bankId: banks[0]?.id ?? "",
    from: toDateISO(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))),
    to: toDateISO(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))),
    jenis: "all",
    status: "all",
  };
}

/**
 * Helper: ubah hex jadi rgba dengan alpha tertentu (untuk row tint).
 */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{6})$/i);
  if (!m) return `rgba(203, 213, 225, ${alpha})`; // slate-300 fallback
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function MutasiTab({
  banks,
  outlets,
}: {
  banks: BankLite[];
  outlets: OutletLite[];
}) {
  const [filter, setFilter] = useState<FilterState>(() => getDefault(banks));
  const [rows, setRows] = useState<MutasiRow[]>([]);
  const [inputsMap, setInputsMap] = useState<Map<string, ClaimedInputInfo>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const bankMap = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  useEffect(() => {
    if (!filter.bankId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const { data, error } = await supabase
        .from("parsed_transactions")
        .select(
          "id, bank_id, no_ref, tanggal, jam, nominal_kredit, nominal_debet, nama_pengirim, nama_penerima, deskripsi, saldo, claimed_by_input_id, manual_claim_reason, claimed_at",
        )
        .eq("bank_id", filter.bankId)
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

      // Apply jenis + status filters client-side (cheaper than rebuilding query)
      const filtered = all.filter((r) => {
        if (filter.jenis === "kredit" && r.nominal_kredit <= 0) return false;
        if (filter.jenis === "debet" && r.nominal_debet <= 0) return false;
        if (filter.status === "matched" && !r.claimed_by_input_id) return false;
        if (filter.status === "unmatched" && r.claimed_by_input_id) return false;
        return true;
      });

      // Batch fetch cek_inputs untuk rows yang matched (to get outlet info + manual claim details)
      const inputIds = Array.from(
        new Set(filtered.map((r) => r.claimed_by_input_id).filter((v): v is string => !!v)),
      );
      const newInputsMap = new Map<string, ClaimedInputInfo>();
      if (inputIds.length > 0) {
        // Chunk supaya URL tidak kepanjangan
        const CHUNK = 200;
        for (let i = 0; i < inputIds.length; i += CHUNK) {
          const slice = inputIds.slice(i, i + CHUNK);
          const { data: ciData, error: ciErr } = await supabase
            .from("cek_inputs")
            .select(
              "id, outlet_id, session_id, tanggal_input, manual_claim_reason, manual_claimed_at",
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
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Aggregations untuk footer
  const stats = useMemo(() => {
    let totalKredit = 0;
    let totalDebet = 0;
    let matchedKredit = 0;
    let matchedDebet = 0;
    let unmatchedCount = 0;
    let matchedCount = 0;
    const perOutlet = new Map<
      string,
      { nama: string; warna: string; nominal: number; count: number }
    >();
    for (const r of rows) {
      totalKredit += r.nominal_kredit;
      totalDebet += r.nominal_debet;
      const amount = r.nominal_kredit > 0 ? r.nominal_kredit : r.nominal_debet;
      if (r.claimed_by_input_id) {
        matchedCount += 1;
        if (r.nominal_kredit > 0) matchedKredit += r.nominal_kredit;
        else matchedDebet += r.nominal_debet;
        const ci = inputsMap.get(r.claimed_by_input_id);
        const outletId = ci?.outlet_id ?? "_none";
        const outlet = ci?.outlet_id ? outletMap.get(ci.outlet_id) : null;
        if (!perOutlet.has(outletId)) {
          perOutlet.set(outletId, {
            nama: outlet?.nama ?? "(tanpa outlet)",
            warna: outlet?.warna_hex ?? "#cbd5e1",
            nominal: 0,
            count: 0,
          });
        }
        const agg = perOutlet.get(outletId)!;
        agg.nominal += amount;
        agg.count += 1;
      } else {
        unmatchedCount += 1;
      }
    }
    return {
      totalKredit,
      totalDebet,
      matchedKredit,
      matchedDebet,
      matchedCount,
      unmatchedCount,
      perOutlet: Array.from(perOutlet.values()).sort((a, b) => b.nominal - a.nominal),
    };
  }, [rows, inputsMap, outletMap]);

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
    setFilter((p) => ({
      ...p,
      from: toDateISO(start),
      to: toDateISO(endDate),
    }));
  }

  function reset() {
    setFilter(getDefault(banks));
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

  const selectedBank = bankMap.get(filter.bankId);

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="card p-3 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Filter className="h-4 w-4" /> Filter Mutasi
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-slate-500">
              Bank <span className="text-red-600">*</span>
            </label>
            <select
              className="input mt-1"
              value={filter.bankId}
              onChange={(e) => setFilter((p) => ({ ...p, bankId: e.target.value }))}
            >
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
            onClick={reset}
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

      {/* Summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="card p-3">
          <div className="text-xs text-slate-500">Total Transaksi</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {loading ? "…" : rows.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {selectedBank ? selectedBank.label || selectedBank.kode : ""}
          </div>
        </div>
        <div className="card p-3 bg-green-50 border-green-200">
          <div className="text-xs text-green-700 flex items-center gap-1">
            <ArrowDown className="h-3 w-3" /> Total Kredit
          </div>
          <div className="mt-1 text-lg font-semibold text-green-700">
            Rp {formatRupiah(stats.totalKredit)}
          </div>
          <div className="text-[11px] text-green-700 mt-0.5">
            Match Rp {formatRupiah(stats.matchedKredit)}
          </div>
        </div>
        <div className="card p-3 bg-red-50 border-red-200">
          <div className="text-xs text-red-700 flex items-center gap-1">
            <ArrowUp className="h-3 w-3" /> Total Debet
          </div>
          <div className="mt-1 text-lg font-semibold text-red-700">
            Rp {formatRupiah(stats.totalDebet)}
          </div>
          <div className="text-[11px] text-red-700 mt-0.5">
            Match Rp {formatRupiah(stats.matchedDebet)}
          </div>
        </div>
        <div className="card p-3 bg-slate-50 border-slate-300">
          <div className="text-xs text-slate-600">Match / Belum</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            <span className="text-green-700">{stats.matchedCount}</span> /{" "}
            <span className="text-amber-700">{stats.unmatchedCount}</span>
          </div>
          <div className="text-[11px] text-slate-600 mt-0.5">
            {rows.length > 0
              ? `${((stats.matchedCount / rows.length) * 100).toFixed(0)}% claimed`
              : "—"}
          </div>
        </div>
      </div>

      {/* Per outlet breakdown */}
      {stats.perOutlet.length > 0 && (
        <div className="card p-3">
          <div className="text-xs font-medium text-slate-700 mb-2">Breakdown per Outlet</div>
          <div className="flex flex-wrap gap-2">
            {stats.perOutlet.map((o, idx) => (
              <div
                key={idx}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-xs"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: o.warna }}
                />
                <span className="text-slate-700">{o.nama}</span>
                <span className="font-mono text-slate-900 ml-1">
                  Rp {formatRupiah(o.nominal)}
                </span>
                <span className="text-slate-400">({o.count})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">
            Mutasi Rekening{" "}
            {selectedBank && (
              <span className="text-sm text-slate-600">
                — {selectedBank.label || selectedBank.kode}
              </span>
            )}
          </h2>
          <span className="text-xs text-slate-500">
            {rows.length} transaksi
            {rows.length >= 5000 && " (dipotong di 5000, perketat filter)"}
          </span>
        </div>
        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400 mx-auto" />
            <p className="mt-2 text-sm text-slate-500">Memuat mutasi…</p>
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
                  const tooltipParts: string[] = [];
                  if (outlet) tooltipParts.push(`Outlet: ${outlet.nama}`);
                  if (ci?.tanggal_input) {
                    const d = parseDateISO(ci.tanggal_input);
                    tooltipParts.push(`Input tgl: ${d ? formatDateID(d) : ci.tanggal_input}`);
                  }
                  const reason = ci?.manual_claim_reason ?? r.manual_claim_reason;
                  if (reason) tooltipParts.push(`Manual: ${reason}`);
                  const tooltip = tooltipParts.join(" · ");

                  const rowStyle = isMatched && outlet
                    ? { backgroundColor: hexToRgba(outlet.warna_hex, 0.18) }
                    : undefined;

                  return (
                    <tr
                      key={r.id}
                      style={rowStyle}
                      title={tooltip || undefined}
                      className={isMatched ? "" : "bg-white"}
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
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">belum match</span>
                        )}
                        {isMatched && (
                          <CheckCircle2 className="inline-block h-3 w-3 text-green-600 ml-1 -mt-0.5" />
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
    </div>
  );
}
