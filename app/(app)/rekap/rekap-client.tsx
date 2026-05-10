"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  Filter,
  FileText,
  FileSpreadsheet,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateID, parseDateISO, toDateISO } from "@/lib/format";

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

type InputRow = {
  id: string;
  session_id: string;
  tanggal_input: string;
  outlet_id: string | null;
  bank_id: string | null;
  nominal: number;
  jenis: "kredit" | "debet";
  match_status: "matched" | "no_candidate" | "all_taken" | "manual_claimed" | null;
  manual_claim_reason: string | null;
  created_at: string;
};

type FilterState = {
  from: string; // YYYY-MM-DD
  to: string;
  jenis: "all" | "kredit" | "debet";
  bankId: string; // "all" or uuid
  outletId: string; // "all" or uuid
  status: "all" | "matched" | "unmatched" | "conflict";
};

function getDefaultFilter(): FilterState {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 30);
  return {
    from: toDateISO(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))),
    to: toDateISO(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))),
    jenis: "all",
    bankId: "all",
    outletId: "all",
    status: "all",
  };
}

export default function RekapClient({
  outlets,
  banks,
  brandName,
}: {
  outlets: OutletLite[];
  banks: BankLite[];
  brandName: string;
}) {
  const [filter, setFilter] = useState<FilterState>(getDefaultFilter);
  const [rows, setRows] = useState<InputRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"" | "pdf" | "csv">("");

  const outletMap = useMemo(() => new Map(outlets.map((o) => [o.id, o])), [outlets]);
  const bankMap = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  // Fetch data when filter changes
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      let q = supabase
        .from("cek_inputs")
        .select(
          "id, session_id, tanggal_input, outlet_id, bank_id, nominal, jenis, match_status, manual_claim_reason, created_at",
        )
        .gte("tanggal_input", filter.from)
        .lte("tanggal_input", filter.to)
        .order("tanggal_input", { ascending: false })
        .limit(5000);

      if (filter.jenis !== "all") q = q.eq("jenis", filter.jenis);
      if (filter.bankId !== "all") q = q.eq("bank_id", filter.bankId);
      if (filter.outletId !== "all") q = q.eq("outlet_id", filter.outletId);
      if (filter.status === "matched") q = q.in("match_status", ["matched", "manual_claimed"]);
      if (filter.status === "unmatched") q = q.eq("match_status", "no_candidate");
      if (filter.status === "conflict") q = q.eq("match_status", "all_taken");

      const { data, error } = await q;
      if (cancelled) return;

      if (error) {
        setError(error.message);
        setRows([]);
      } else {
        setRows((data ?? []) as InputRow[]);
      }
      setLoading(false);
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [filter]);

  // Aggregations
  const stats = useMemo(() => {
    let totalInput = 0;
    let totalNominal = 0;
    let matched = 0;
    let matchedNominal = 0;
    let unmatched = 0;
    let unmatchedNominal = 0;
    let conflict = 0;
    let conflictNominal = 0;
    let manualClaim = 0;

    for (const r of rows) {
      totalInput += 1;
      totalNominal += r.nominal;
      if (r.match_status === "matched") {
        matched += 1;
        matchedNominal += r.nominal;
      } else if (r.match_status === "manual_claimed") {
        matched += 1;
        matchedNominal += r.nominal;
        manualClaim += 1;
      } else if (r.match_status === "no_candidate") {
        unmatched += 1;
        unmatchedNominal += r.nominal;
      } else if (r.match_status === "all_taken") {
        conflict += 1;
        conflictNominal += r.nominal;
      }
    }

    const matchRate = totalInput > 0 ? (matched / totalInput) * 100 : 0;

    return {
      totalInput,
      totalNominal,
      matched,
      matchedNominal,
      unmatched,
      unmatchedNominal,
      conflict,
      conflictNominal,
      manualClaim,
      matchRate,
    };
  }, [rows]);

  // Breakdown per outlet
  const perOutlet = useMemo(() => {
    type Agg = {
      outletId: string | null;
      nama: string;
      warna: string;
      input: number;
      matched: number;
      unmatched: number;
      nominalMatched: number;
      nominalUnmatched: number;
    };
    const map = new Map<string, Agg>();
    for (const r of rows) {
      const key = r.outlet_id ?? "_none";
      const o = r.outlet_id ? outletMap.get(r.outlet_id) : null;
      if (!map.has(key)) {
        map.set(key, {
          outletId: r.outlet_id,
          nama: o?.nama ?? "(tanpa outlet)",
          warna: o?.warna_hex ?? "#cbd5e1",
          input: 0,
          matched: 0,
          unmatched: 0,
          nominalMatched: 0,
          nominalUnmatched: 0,
        });
      }
      const agg = map.get(key)!;
      agg.input += 1;
      if (r.match_status === "matched" || r.match_status === "manual_claimed") {
        agg.matched += 1;
        agg.nominalMatched += r.nominal;
      } else if (r.match_status === "no_candidate") {
        agg.unmatched += 1;
        agg.nominalUnmatched += r.nominal;
      } else if (r.match_status === "all_taken") {
        agg.unmatched += 1;
        agg.nominalUnmatched += r.nominal;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.nominalMatched - a.nominalMatched);
  }, [rows, outletMap]);

  // Breakdown per bank
  const perBank = useMemo(() => {
    type Agg = {
      bankId: string | null;
      label: string;
      input: number;
      matched: number;
      unmatched: number;
      nominalMatched: number;
      nominalUnmatched: number;
    };
    const map = new Map<string, Agg>();
    for (const r of rows) {
      const key = r.bank_id ?? "_none";
      const b = r.bank_id ? bankMap.get(r.bank_id) : null;
      if (!map.has(key)) {
        map.set(key, {
          bankId: r.bank_id,
          label: b ? b.label || b.kode : "(tanpa bank)",
          input: 0,
          matched: 0,
          unmatched: 0,
          nominalMatched: 0,
          nominalUnmatched: 0,
        });
      }
      const agg = map.get(key)!;
      agg.input += 1;
      if (r.match_status === "matched" || r.match_status === "manual_claimed") {
        agg.matched += 1;
        agg.nominalMatched += r.nominal;
      } else if (r.match_status === "no_candidate") {
        agg.unmatched += 1;
        agg.nominalUnmatched += r.nominal;
      } else if (r.match_status === "all_taken") {
        agg.unmatched += 1;
        agg.nominalUnmatched += r.nominal;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.nominalMatched - a.nominalMatched);
  }, [rows, bankMap]);

  function applyPreset(days: number) {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - days);
    setFilter((prev) => ({
      ...prev,
      from: toDateISO(new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))),
      to: toDateISO(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()))),
    }));
  }

  function applyMonth(offset: number) {
    const today = new Date();
    const target = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const start = new Date(Date.UTC(target.getFullYear(), target.getMonth(), 1));
    const endDate = new Date(Date.UTC(target.getFullYear(), target.getMonth() + 1, 0));
    setFilter((prev) => ({
      ...prev,
      from: toDateISO(start),
      to: toDateISO(endDate),
    }));
  }

  function resetFilter() {
    setFilter(getDefaultFilter());
  }

  async function exportCsv() {
    setExporting("csv");
    try {
      const header = [
        "Tanggal Input",
        "Jenis",
        "Outlet",
        "Bank",
        "Nominal",
        "Status",
        "Catatan Manual",
      ];
      const lines = [header.join(",")];
      for (const r of rows) {
        const outlet = r.outlet_id ? outletMap.get(r.outlet_id) : null;
        const bank = r.bank_id ? bankMap.get(r.bank_id) : null;
        const status =
          r.match_status === "matched"
            ? "Match"
            : r.match_status === "manual_claimed"
              ? "Manual claim"
              : r.match_status === "no_candidate"
                ? "Tidak ditemukan"
                : r.match_status === "all_taken"
                  ? "Bentrok"
                  : "—";
        const tgl = parseDateISO(r.tanggal_input);
        const csvRow = [
          tgl ? formatDateID(tgl) : r.tanggal_input,
          r.jenis,
          outlet?.nama ?? "",
          bank ? bank.label || bank.kode : "",
          r.nominal,
          status,
          (r.manual_claim_reason ?? "").replace(/[\n\r,;"]/g, " "),
        ];
        lines.push(csvRow.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
      }
      const csv = "﻿" + lines.join("\n"); // BOM untuk Excel agar UTF-8 di-recognize
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rekap-${filter.from}-sd-${filter.to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting("");
    }
  }

  async function exportPdf() {
    setExporting("pdf");
    try {
      const { generateRekapPdf } = await import("./generate-rekap-pdf");
      const buffer = await generateRekapPdf({
        brandName,
        filter,
        outlets,
        banks,
        rows,
        perOutlet,
        perBank,
        stats,
      });
      const blob = new Blob([new Uint8Array(buffer)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rekap-${filter.from}-sd-${filter.to}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting("");
    }
  }

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl bg-gradient-to-br from-[#FAFAF7] via-white to-[#10B981]/5 border border-slate-200 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 px-3 py-1 text-xs font-medium text-[#0F2E1F] mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-[#10B981]" />
            Rekap
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
            Rekap &amp; Analisa
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-xl">
            Filter dan analisa hasil cek mutasi. Total claimed vs unclaimed,
            breakdown per outlet &amp; per bank, plus export PDF/CSV.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            className="text-sm inline-flex items-center gap-1.5 bg-white hover:bg-[#FAFAF7] text-[#0F2E1F] border border-slate-200 rounded-md px-3 py-2 font-medium transition-colors disabled:opacity-50"
            onClick={exportCsv}
            disabled={loading || rows.length === 0 || exporting !== ""}
          >
            {exporting === "csv" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            CSV
          </button>
          <button
            type="button"
            className="text-sm inline-flex items-center gap-1.5 bg-[#0F2E1F] hover:bg-[#1a4530] text-white rounded-md px-4 py-2 font-medium transition-colors disabled:bg-slate-300"
            onClick={exportPdf}
            disabled={loading || rows.length === 0 || exporting !== ""}
          >
            {exporting === "pdf" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            Export PDF
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Filter className="h-4 w-4" /> Filter
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
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
            <label className="text-xs text-slate-500">Bank</label>
            <select
              className="input mt-1"
              value={filter.bankId}
              onChange={(e) => setFilter((p) => ({ ...p, bankId: e.target.value }))}
            >
              <option value="all">Semua bank</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label || b.kode}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Outlet</label>
            <select
              className="input mt-1"
              value={filter.outletId}
              onChange={(e) => setFilter((p) => ({ ...p, outletId: e.target.value }))}
            >
              <option value="all">Semua outlet</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nama}
                </option>
              ))}
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
              <option value="matched">Match</option>
              <option value="unmatched">Tidak ditemukan</option>
              <option value="conflict">Bentrok</option>
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
            onClick={resetFilter}
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-4 border-red-200 bg-red-50 text-red-800 text-sm">
          Gagal memuat data: {error}
        </div>
      )}

      {/* Big number cards — palette themed */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {/* Total Input — neutral */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#FAFAF7] to-white border border-slate-200 p-4 shadow-sm">
          <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-[#0F2E1F]/5" />
          <div className="relative">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Total Input
            </div>
            <div className="mt-2 text-2xl font-bold text-[#0F2E1F]">
              {loading ? "…" : stats.totalInput}
            </div>
            <div className="text-xs text-slate-600 mt-1 font-mono">
              Rp {formatRupiah(stats.totalNominal)}
            </div>
          </div>
        </div>
        {/* Match — emerald */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#10B981]/10 via-white to-[#10B981]/5 border border-[#10B981]/30 p-4 shadow-sm">
          <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-[#10B981]/15" />
          <div className="relative">
            <div className="text-xs font-semibold text-[#10B981] uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Match
            </div>
            <div className="mt-2 text-2xl font-bold text-[#10B981]">
              {loading ? "…" : stats.matched}
            </div>
            <div className="text-xs text-[#10B981] mt-1 font-mono">
              Rp {formatRupiah(stats.matchedNominal)}
            </div>
          </div>
        </div>
        {/* Tidak ditemukan — red */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-red-50 via-white to-red-50/50 border border-red-200 p-4 shadow-sm">
          <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-red-200/30" />
          <div className="relative">
            <div className="text-xs font-semibold text-red-700 uppercase tracking-wider flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> Tidak ditemukan
            </div>
            <div className="mt-2 text-2xl font-bold text-red-700">
              {loading ? "…" : stats.unmatched}
            </div>
            <div className="text-xs text-red-600 mt-1 font-mono">
              Rp {formatRupiah(stats.unmatchedNominal)}
            </div>
          </div>
        </div>
        {/* Bentrok — amber */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-50 via-white to-amber-50/50 border border-amber-200 p-4 shadow-sm">
          <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-amber-200/40" />
          <div className="relative">
            <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Bentrok
            </div>
            <div className="mt-2 text-2xl font-bold text-amber-700">
              {loading ? "…" : stats.conflict}
            </div>
            <div className="text-xs text-amber-600 mt-1 font-mono">
              Rp {formatRupiah(stats.conflictNominal)}
            </div>
          </div>
        </div>
        {/* Match rate — dark forest */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-[#0F2E1F] to-[#1a4530] text-white p-4 shadow-md">
          <div className="absolute -top-8 -right-8 h-20 w-20 rounded-full bg-[#10B981]/15" />
          <div className="relative">
            <div className="text-xs font-semibold text-white/80 uppercase tracking-wider">
              Match Rate
            </div>
            <div className="mt-2 text-2xl font-bold text-[#10B981]">
              {loading ? "…" : `${stats.matchRate.toFixed(1)}%`}
            </div>
            <div className="text-xs text-white/70 mt-1">
              {stats.manualClaim > 0
                ? `${stats.manualClaim} manual claim`
                : "auto-match saja"}
            </div>
          </div>
        </div>
      </div>

      {/* Per outlet */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Breakdown per Outlet</h2>
          <span className="text-xs text-slate-500">{perOutlet.length} outlet</span>
        </div>
        {perOutlet.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            {loading ? "Memuat…" : "Belum ada data."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Outlet
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Input
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Tidak match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Nominal Match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Match %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {perOutlet.map((o) => {
                const rate = o.input > 0 ? (o.matched / o.input) * 100 : 0;
                return (
                  <tr key={o.outletId ?? "none"}>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: o.warna }}
                        />
                        {o.nama}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{o.input}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-700">{o.matched}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-700">{o.unmatched}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      Rp {formatRupiah(o.nominalMatched)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{rate.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Per bank */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Breakdown per Bank</h2>
          <span className="text-xs text-slate-500">{perBank.length} bank</span>
        </div>
        {perBank.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">
            {loading ? "Memuat…" : "Belum ada data."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50/50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Bank
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Input
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Tidak match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Nominal Match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Match %
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {perBank.map((b) => {
                const rate = b.input > 0 ? (b.matched / b.input) * 100 : 0;
                return (
                  <tr key={b.bankId ?? "none"}>
                    <td className="px-4 py-2 text-slate-700">{b.label}</td>
                    <td className="px-4 py-2 text-right font-mono">{b.input}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-700">{b.matched}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-700">{b.unmatched}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      Rp {formatRupiah(b.nominalMatched)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{rate.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail rows */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="font-medium text-slate-900">Detail ({rows.length})</h2>
          {rows.length >= 5000 && (
            <span className="text-xs text-amber-700">
              Hasil dipotong di 5000 baris terbaru — perketat filter untuk lebih akurat.
            </span>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            {loading ? "Memuat…" : "Tidak ada data sesuai filter."}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/50 border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Tgl Input
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Jenis
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Outlet
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Bank
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                    Nominal
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rows.map((r) => {
                  const outlet = r.outlet_id ? outletMap.get(r.outlet_id) : null;
                  const bank = r.bank_id ? bankMap.get(r.bank_id) : null;
                  const tgl = parseDateISO(r.tanggal_input);
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 text-slate-700">
                        {tgl ? formatDateID(tgl) : r.tanggal_input}
                      </td>
                      <td className="px-4 py-2">
                        {r.jenis === "kredit" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-700">
                            <ArrowDown className="h-3 w-3" /> Kredit
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-red-700">
                            <ArrowUp className="h-3 w-3" /> Debet
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {outlet ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: outlet.warna_hex }}
                            />
                            {outlet.nama}
                          </span>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600 text-xs">
                        {bank ? bank.label || bank.kode : "—"}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        Rp {formatRupiah(r.nominal)}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {r.match_status === "matched" && (
                          <span className="inline-flex items-center gap-1 text-green-700">
                            <CheckCircle2 className="h-3 w-3" /> Match
                          </span>
                        )}
                        {r.match_status === "manual_claimed" && (
                          <span className="inline-flex items-center gap-1 text-blue-700">
                            <CheckCircle2 className="h-3 w-3" /> Manual claim
                          </span>
                        )}
                        {r.match_status === "no_candidate" && (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <XCircle className="h-3 w-3" /> Tidak ada
                          </span>
                        )}
                        {r.match_status === "all_taken" && (
                          <span className="inline-flex items-center gap-1 text-amber-700">
                            <AlertTriangle className="h-3 w-3" /> Bentrok
                          </span>
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
