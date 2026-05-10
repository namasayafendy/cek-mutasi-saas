"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  History as HistoryIcon,
  Inbox,
  ListChecks,
  Loader2,
  Printer,
  Trash2,
} from "lucide-react";
import { formatDateLong, parseDateISO, formatRupiah, formatDateID, toDateISO } from "@/lib/format";
import MutasiTab from "./mutasi-tab";
import { ManualClaimModal, type UnclaimedTx } from "./manual-claim-modal";
import { downloadMutasiPdf } from "./generate-mutasi-pdf";
import { DeleteConfirmModal } from "./delete-confirm-modal";
import { createClient } from "@/lib/supabase/client";

type SessionRow = {
  id: string;
  user_id: string;
  jenis: "kredit" | "debet";
  period_mutasi_start: string | null;
  period_mutasi_end: string | null;
  total_input: number;
  total_matched: number;
  total_unmatched: number;
  total_conflict: number;
  total_nominal_input: number;
  total_nominal_matched: number;
  carry_over_used: boolean | null;
  multi_bank_used: boolean | null;
  created_at: string;
};

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null; is_active?: boolean };

type Tab = "mutasi" | "sessions" | "belum-match";

export default function HistoryClient({
  sessions,
  unclaimed,
  outlets,
  banks,
  currentUserId,
  accountId,
  sessionsError,
  unclaimedError,
  brandName,
}: {
  sessions: SessionRow[];
  unclaimed: UnclaimedTx[];
  outlets: OutletLite[];
  banks: BankLite[];
  currentUserId: string;
  accountId: string;
  sessionsError: string | null;
  unclaimedError: string | null;
  brandName: string;
}) {
  const [tab, setTab] = useState<Tab>("mutasi");
  const [filterJenis, setFilterJenis] = useState<"all" | "kredit" | "debet">("all");
  const [filterBank, setFilterBank] = useState<string>("all");
  const [claimingTx, setClaimingTx] = useState<UnclaimedTx | null>(null);

  const bankMap = useMemo(() => new Map(banks.map((b) => [b.id, b])), [banks]);

  const filteredUnclaimed = useMemo(() => {
    return unclaimed.filter((tx) => {
      const isKredit = tx.nominal_kredit > 0;
      const txJenis = isKredit ? "kredit" : "debet";
      if (filterJenis !== "all" && filterJenis !== txJenis) return false;
      if (filterBank !== "all" && tx.bank_id !== filterBank) return false;
      return true;
    });
  }, [unclaimed, filterJenis, filterBank]);

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="rounded-2xl bg-gradient-to-br from-[#FAFAF7] via-white to-[#10B981]/5 border border-slate-200 p-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 px-3 py-1 text-xs font-medium text-[#0F2E1F] mb-2">
          <HistoryIcon className="h-3.5 w-3.5 text-[#10B981]" />
          History
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
          History Cek Mutasi
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Riwayat sesi cek mutasi, daftar transaksi mutasi rekening, dan
          transaksi yang belum di-match.
        </p>
      </div>

      {/* Big tab cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <TabCard
          active={tab === "mutasi"}
          onClick={() => setTab("mutasi")}
          icon={<ListChecks className="h-5 w-5" />}
          title="Mutasi"
          subtitle="Daftar transaksi"
          variant="emerald"
        />
        <TabCard
          active={tab === "sessions"}
          onClick={() => setTab("sessions")}
          icon={<HistoryIcon className="h-5 w-5" />}
          title="Sesi"
          subtitle={`${sessions.length} riwayat`}
          variant="dark"
        />
        <TabCard
          active={tab === "belum-match"}
          onClick={() => setTab("belum-match")}
          icon={<Inbox className="h-5 w-5" />}
          title="Belum Match"
          subtitle={`${unclaimed.length} tx`}
          variant="amber"
          badge={unclaimed.length > 0}
        />
      </div>

      {tab === "mutasi" && (
        <MutasiTab
          banks={banks}
          outlets={outlets}
          accountId={accountId}
          userId={currentUserId}
          brandName={brandName}
        />
      )}

      {tab === "sessions" && (
        <SessionsTab
          sessions={sessions}
          currentUserId={currentUserId}
          accountId={accountId}
          error={sessionsError}
        />
      )}

      {tab === "belum-match" && (
        <BelumMatchTab
          unclaimed={filteredUnclaimed}
          totalCount={unclaimed.length}
          banks={banks}
          bankMap={bankMap}
          filterJenis={filterJenis}
          setFilterJenis={setFilterJenis}
          filterBank={filterBank}
          setFilterBank={setFilterBank}
          onClaim={(tx) => setClaimingTx(tx)}
          error={unclaimedError}
          brandName={brandName}
        />
      )}

      {claimingTx && (
        <ManualClaimModal
          tx={claimingTx}
          outlets={outlets}
          banks={banks}
          accountId={accountId}
          userId={currentUserId}
          onClose={() => setClaimingTx(null)}
        />
      )}
    </div>
  );
}

// ===== Tab Card (header navigation) =====

function TabCard({
  active,
  onClick,
  icon,
  title,
  subtitle,
  variant,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  variant: "emerald" | "dark" | "amber";
  badge?: boolean;
}) {
  const activeStyles: Record<typeof variant, string> = {
    emerald:
      "bg-gradient-to-br from-[#10B981] to-[#059669] text-white shadow-lg shadow-[#10B981]/30",
    dark:
      "bg-gradient-to-br from-[#1a4530] to-[#0F2E1F] text-white shadow-lg shadow-[#0F2E1F]/30",
    amber:
      "bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/30",
  };
  const inactiveStyles: Record<typeof variant, string> = {
    emerald:
      "bg-white border border-slate-200 text-[#0F2E1F] hover:border-[#10B981]/40 hover:shadow-sm",
    dark:
      "bg-white border border-slate-200 text-[#0F2E1F] hover:border-[#0F2E1F]/40 hover:shadow-sm",
    amber:
      "bg-white border border-slate-200 text-[#0F2E1F] hover:border-amber-400 hover:shadow-sm",
  };
  const iconBg = active
    ? "bg-white/20"
    : variant === "emerald"
      ? "bg-[#10B981]/10 text-[#10B981]"
      : variant === "dark"
        ? "bg-[#0F2E1F]/10 text-[#0F2E1F]"
        : "bg-amber-100 text-amber-700";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl p-3 sm:p-4 text-left transition-all ${
        active ? activeStyles[variant] : inactiveStyles[variant]
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${iconBg} flex-shrink-0`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold text-base sm:text-lg leading-tight truncate">
              {title}
            </h3>
            {badge && (
              <span
                className={`inline-flex items-center justify-center min-w-[1.25rem] h-5 rounded-full text-[10px] font-bold px-1.5 ${
                  active
                    ? "bg-white text-amber-700"
                    : "bg-amber-500 text-white"
                }`}
              >
                !
              </span>
            )}
          </div>
          <p
            className={`text-xs truncate ${
              active ? "text-white/80" : "text-slate-500"
            }`}
          >
            {subtitle}
          </p>
        </div>
      </div>
    </button>
  );
}

// ===== Sessions tab =====

function SessionsTab({
  sessions,
  currentUserId,
  accountId,
  error,
}: {
  sessions: SessionRow[];
  currentUserId: string;
  accountId: string;
  error: string | null;
}) {
  const [deleteTarget, setDeleteTarget] = useState<SessionRow | null>(null);

  async function handleDeleteSession(s: SessionRow) {
    const supabase = createClient();
    const now = new Date().toISOString();

    // Get all input ids in this session (alive + soft-deleted, both fine).
    const { data: inputs, error: inputErr } = await supabase
      .from("cek_inputs")
      .select("id")
      .eq("session_id", s.id);
    if (inputErr) throw inputErr;
    const inputIds = (inputs ?? []).map((r) => r.id);

    // Soft-delete parsed_transactions claimed by these inputs.
    if (inputIds.length > 0) {
      const { error: txErr } = await supabase
        .from("parsed_transactions")
        .update({ deleted_at: now })
        .in("claimed_by_input_id", inputIds)
        .is("deleted_at", null);
      if (txErr) throw txErr;

      const { error: ciErr } = await supabase
        .from("cek_inputs")
        .update({ deleted_at: now })
        .in("id", inputIds)
        .is("deleted_at", null);
      if (ciErr) throw ciErr;
    }

    // Soft-delete the session itself.
    const { error: sesErr } = await supabase
      .from("cek_sessions")
      .update({ deleted_at: now })
      .eq("id", s.id);
    if (sesErr) throw sesErr;

    await supabase.from("audit_logs").insert({
      account_id: accountId,
      user_id: currentUserId,
      action: "history.session_delete",
      target_type: "cek_session",
      target_id: s.id,
      metadata: {
        deleted_inputs: inputIds.length,
        jenis: s.jenis,
      },
    });

    setDeleteTarget(null);
    window.location.reload();
  }

  if (error) {
    return (
      <div className="card p-5 border-red-200 bg-red-50 text-red-800 text-sm">
        Gagal memuat history: {error}
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="card p-8 text-center">
        <HistoryIcon className="h-10 w-10 mx-auto text-slate-400" />
        <h2 className="mt-3 font-medium text-slate-900">Belum ada history</h2>
        <p className="mt-1 text-sm text-slate-600">
          Setelah Anda selesai cek mutasi dan download hasilnya, sesi-nya akan muncul di sini.
        </p>
        <Link href="/check" className="btn-primary mt-3">
          Mulai Cek Mutasi
        </Link>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
              Tgl Cek
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
              Jenis
            </th>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
              Periode Mutasi
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
              Input
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
              Match
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
              Tidak Match
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
              Total Match
            </th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {sessions.map((s) => {
            const created = new Date(s.created_at);
            const periodStart = s.period_mutasi_start ? parseDateISO(s.period_mutasi_start) : null;
            const periodEnd = s.period_mutasi_end ? parseDateISO(s.period_mutasi_end) : null;
            const isOwn = s.user_id === currentUserId;
            return (
              <tr key={s.id} className={isOwn ? "" : "bg-slate-50/50"}>
                <td className="px-4 py-2 text-slate-700">
                  {formatDateLong(created)}
                  <div className="text-xs text-slate-500">
                    {created.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </td>
                <td className="px-4 py-2">
                  {s.jenis === "kredit" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      <ArrowDown className="h-3 w-3" /> Kredit
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                      <ArrowUp className="h-3 w-3" /> Debet
                    </span>
                  )}
                  {s.carry_over_used && (
                    <span className="ml-1 inline-flex items-center text-[10px] text-blue-600" title="Carry-over digunakan">
                      ⏳
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {periodStart && periodEnd
                    ? `${periodStart.getUTCDate()}/${periodStart.getUTCMonth() + 1} – ${periodEnd.getUTCDate()}/${periodEnd.getUTCMonth() + 1}/${periodEnd.getUTCFullYear()}`
                    : "—"}
                </td>
                <td className="px-4 py-2 text-right font-mono">{s.total_input}</td>
                <td className="px-4 py-2 text-right font-mono text-green-700">
                  {s.total_matched}
                </td>
                <td className="px-4 py-2 text-right font-mono text-red-700">
                  {s.total_unmatched}
                </td>
                <td className="px-4 py-2 text-right font-mono">
                  Rp {formatRupiah(s.total_nominal_matched)}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex items-center gap-3">
                    <Link
                      href={`/history/${s.id}`}
                      className="inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
                    >
                      <Eye className="h-3.5 w-3.5" /> Detail
                    </Link>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(s)}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800"
                      title="Hapus sesi ini (privacy)"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Hapus
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {deleteTarget && (
        <DeleteConfirmModal
          title="Hapus Sesi Cek Mutasi"
          description="Anda akan menghapus sesi ini beserta semua input dan transaksi mutasi yang ke-claim di dalamnya."
          details={[
            {
              label: "Jenis",
              value: deleteTarget.jenis === "kredit" ? "Kredit" : "Debet",
            },
            {
              label: "Tanggal",
              value: new Date(deleteTarget.created_at).toLocaleDateString("id-ID"),
            },
            { label: "Total input", value: String(deleteTarget.total_input) },
            {
              label: "Total nominal",
              value: `Rp ${formatRupiah(deleteTarget.total_nominal_matched)}`,
            },
          ]}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => handleDeleteSession(deleteTarget)}
        />
      )}
    </div>
  );
}

// ===== Belum match tab =====

function BelumMatchTab({
  unclaimed,
  totalCount,
  banks,
  bankMap,
  filterJenis,
  setFilterJenis,
  filterBank,
  setFilterBank,
  onClaim,
  error,
  brandName,
}: {
  unclaimed: UnclaimedTx[];
  totalCount: number;
  banks: BankLite[];
  bankMap: Map<string, BankLite>;
  filterJenis: "all" | "kredit" | "debet";
  setFilterJenis: (v: "all" | "kredit" | "debet") => void;
  filterBank: string;
  setFilterBank: (v: string) => void;
  onClaim: (tx: UnclaimedTx) => void;
  error: string | null;
  brandName: string;
}) {
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  async function handlePrint() {
    if (unclaimed.length === 0 || printing) return;
    setPrinting(true);
    setPrintError(null);
    try {
      // Compute periode dari range tgl tx yang ada (atau pakai 12 bulan terakhir).
      const tanggals = unclaimed.map((t) => t.tanggal).sort();
      const from = tanggals[0] ?? toDateISO(new Date());
      const to = tanggals[tanggals.length - 1] ?? toDateISO(new Date());

      // Convert UnclaimedTx → MutasiRow shape (semua belum match → claimed_by_input_id null)
      const rows = unclaimed.map((t) => ({
        id: t.id,
        bank_id: t.bank_id,
        no_ref: t.no_ref,
        tanggal: t.tanggal,
        jam: t.jam,
        nominal_kredit: t.nominal_kredit,
        nominal_debet: t.nominal_debet,
        nama_pengirim: t.nama_pengirim,
        nama_penerima: t.nama_penerima,
        deskripsi: t.deskripsi,
        saldo: null,
        claimed_by_input_id: null,
        manual_claim_reason: null,
      }));

      // Bank filter: kalau "all" → bank=null, kalau spesifik → ambil dari bankMap
      const bank =
        filterBank === "all"
          ? null
          : (() => {
              const b = bankMap.get(filterBank);
              return b ? { id: b.id, kode: b.kode, label: b.label } : null;
            })();

      await downloadMutasiPdf({
        brandName,
        bank,
        filter: {
          from,
          to,
          jenis: filterJenis,
          status: "unmatched",
        },
        rows,
        inputsMap: new Map(),
        outlets: [],
      });
    } catch (err) {
      console.error("Failed to generate belum-match PDF", err);
      setPrintError("Gagal generate PDF: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setPrinting(false);
    }
  }

  if (error) {
    return (
      <div className="card p-5 border-red-200 bg-red-50 text-red-800 text-sm">
        Gagal memuat: {error}
      </div>
    );
  }
  if (totalCount === 0) {
    return (
      <div className="card p-8 text-center">
        <CheckCircle2 className="h-10 w-10 mx-auto text-green-500" />
        <h2 className="mt-3 font-medium text-slate-900">Semua transaksi sudah ke-match</h2>
        <p className="mt-1 text-sm text-slate-600">
          Tidak ada transaksi belum-match di periode 12 bulan terakhir. 🎉
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card p-3 flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500">Jenis</label>
          <select
            value={filterJenis}
            onChange={(e) => setFilterJenis(e.target.value as "all" | "kredit" | "debet")}
            className="input mt-1 min-w-[140px]"
          >
            <option value="all">Semua</option>
            <option value="kredit">Kredit (masuk)</option>
            <option value="debet">Debet (keluar)</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500">Bank</label>
          <select
            value={filterBank}
            onChange={(e) => setFilterBank(e.target.value)}
            className="input mt-1 min-w-[160px]"
          >
            <option value="all">Semua bank</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label || b.kode}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-slate-600">
            Menampilkan {unclaimed.length} dari {totalCount} transaksi belum match
          </span>
          <button
            type="button"
            onClick={handlePrint}
            disabled={printing || unclaimed.length === 0}
            className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Print PDF list belum match"
          >
            {printing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Printer className="h-3.5 w-3.5" />
            )}
            Print PDF
          </button>
        </div>
      </div>
      {printError && (
        <div className="card p-3 border-red-200 bg-red-50 text-red-800 text-xs">{printError}</div>
      )}

      {unclaimed.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-500">
          Tidak ada transaksi yang sesuai filter.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Tanggal
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
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {unclaimed.map((tx) => {
                const bank = tx.bank_id ? bankMap.get(tx.bank_id) : null;
                const isKredit = tx.nominal_kredit > 0;
                const amount = isKredit ? tx.nominal_kredit : tx.nominal_debet;
                const tgl = parseDateISO(tx.tanggal);
                return (
                  <tr key={tx.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-700">
                      {tgl ? formatDateID(tgl) : tx.tanggal}
                      {tx.jam && (
                        <div className="text-xs text-slate-500">{tx.jam}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-slate-700">
                        {bank ? bank.label || bank.kode : "—"}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {isKredit ? (
                          <span className="text-green-700">Kredit</span>
                        ) : (
                          <span className="text-red-700">Debet</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700 max-w-md">
                      <div className="font-medium">{tx.nama_pengirim || tx.nama_penerima || "—"}</div>
                      {tx.deskripsi && (
                        <div className="text-slate-500 truncate" title={tx.deskripsi}>
                          {tx.deskripsi}
                        </div>
                      )}
                      {tx.no_ref && (
                        <div className="text-[10px] text-slate-400">Ref: {tx.no_ref}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      Rp {formatRupiah(amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onClaim(tx)}
                        className="btn-secondary text-xs py-1 px-2"
                      >
                        Claim manual
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
  );
}
