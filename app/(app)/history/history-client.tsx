"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  History as HistoryIcon,
  Inbox,
  Loader2,
  X,
  AlertCircle,
  ListChecks,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDateLong, parseDateISO, formatRupiah, formatDateID, toDateISO } from "@/lib/format";
import MutasiTab from "./mutasi-tab";

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

type UnclaimedTx = {
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

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

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
}: {
  sessions: SessionRow[];
  unclaimed: UnclaimedTx[];
  outlets: OutletLite[];
  banks: BankLite[];
  currentUserId: string;
  accountId: string;
  sessionsError: string | null;
  unclaimedError: string | null;
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
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">History Cek Mutasi</h1>
        <p className="mt-1 text-sm text-slate-600">
          Riwayat sesi cek mutasi dan transaksi yang belum di-match.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6">
          <button
            onClick={() => setTab("mutasi")}
            className={`pb-3 px-1 text-sm font-medium border-b-2 -mb-px ${
              tab === "mutasi"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <ListChecks className="inline-block h-4 w-4 mr-1.5 -mt-0.5" />
            Mutasi
          </button>
          <button
            onClick={() => setTab("sessions")}
            className={`pb-3 px-1 text-sm font-medium border-b-2 -mb-px ${
              tab === "sessions"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <HistoryIcon className="inline-block h-4 w-4 mr-1.5 -mt-0.5" />
            Sesi ({sessions.length})
          </button>
          <button
            onClick={() => setTab("belum-match")}
            className={`pb-3 px-1 text-sm font-medium border-b-2 -mb-px ${
              tab === "belum-match"
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            <Inbox className="inline-block h-4 w-4 mr-1.5 -mt-0.5" />
            Belum Match ({unclaimed.length})
            {unclaimed.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5">
                !
              </span>
            )}
          </button>
        </nav>
      </div>

      {tab === "mutasi" && <MutasiTab banks={banks} outlets={outlets} />}

      {tab === "sessions" && (
        <SessionsTab
          sessions={sessions}
          currentUserId={currentUserId}
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

// ===== Sessions tab =====

function SessionsTab({
  sessions,
  currentUserId,
  error,
}: {
  sessions: SessionRow[];
  currentUserId: string;
  error: string | null;
}) {
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
                    <span
                      className="ml-1 inline-flex items-center text-[10px] text-blue-600"
                      title="Carry-over digunakan"
                    >
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
                  <Link
                    href={`/history/${s.id}`}
                    className="inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
                  >
                    <Eye className="h-3.5 w-3.5" /> Detail
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
}) {
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
        <div className="ml-auto text-sm text-slate-600">
          Menampilkan {unclaimed.length} dari {totalCount} transaksi belum match
        </div>
      </div>

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

// ===== Manual claim modal =====

function ManualClaimModal({
  tx,
  outlets,
  banks,
  accountId,
  userId,
  onClose,
}: {
  tx: UnclaimedTx;
  outlets: OutletLite[];
  banks: BankLite[];
  accountId: string;
  userId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const isKredit = tx.nominal_kredit > 0;
  const amount = isKredit ? tx.nominal_kredit : tx.nominal_debet;
  const txDate = parseDateISO(tx.tanggal);

  const [outletId, setOutletId] = useState<string>(outlets[0]?.id ?? "");
  const [tanggalInput, setTanggalInput] = useState<string>(
    txDate ? toDateISO(txDate) : tx.tanggal,
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bank = tx.bank_id ? banks.find((b) => b.id === tx.bank_id) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Alasan wajib diisi.");
      return;
    }
    if (!outletId) {
      setError("Outlet wajib dipilih.");
      return;
    }

    setSaving(true);
    setError(null);

    const supabase = createClient();
    const now = new Date().toISOString();

    // Insert cek_inputs row dengan session_id null + manual_claim_reason
    const { data: insertedInput, error: insertErr } = await supabase
      .from("cek_inputs")
      .insert({
        session_id: null,
        account_id: accountId,
        tanggal_input: tanggalInput,
        outlet_id: outletId,
        bank_id: tx.bank_id,
        nominal: amount,
        jenis: isKredit ? "kredit" : "debet",
        match_status: "manual_claimed",
        matched_tx_id: tx.id,
        manual_claim_reason: reason.trim(),
        manual_claimed_at: now,
      })
      .select("id")
      .single();

    if (insertErr || !insertedInput) {
      setError(`Gagal claim: ${insertErr?.message ?? "unknown"}`);
      setSaving(false);
      return;
    }

    // Update parsed_transactions.claimed_by_input_id
    const { error: updateErr } = await supabase
      .from("parsed_transactions")
      .update({
        claimed_by_input_id: insertedInput.id,
        claimed_at: now,
        manual_claim_reason: reason.trim(),
      })
      .eq("id", tx.id)
      .is("claimed_by_input_id", null);

    if (updateErr) {
      setError(
        `Claim partially failed — input ter-save tapi mark transaksi gagal: ${updateErr.message}`,
      );
      setSaving(false);
      return;
    }

    setSaving(false);
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Claim Manual Transaksi</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" disabled={saving}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Tx info */}
          <div className="rounded-md bg-slate-50 p-3 text-sm">
            <div className="text-xs text-slate-500">Transaksi</div>
            <div className="font-medium text-slate-900 mt-0.5">
              {txDate ? formatDateID(txDate) : tx.tanggal}
              {tx.jam && <span className="text-slate-500"> {tx.jam}</span>}
            </div>
            <div className="text-xs text-slate-700 mt-1">
              {bank ? bank.label || bank.kode : "—"} ·{" "}
              {isKredit ? (
                <span className="text-green-700">Kredit</span>
              ) : (
                <span className="text-red-700">Debet</span>
              )}{" "}
              · <span className="font-mono">Rp {formatRupiah(amount)}</span>
            </div>
            {(tx.nama_pengirim || tx.deskripsi) && (
              <div className="text-xs text-slate-600 mt-1.5 italic">
                {tx.nama_pengirim ?? ""} {tx.deskripsi ? `— ${tx.deskripsi}` : ""}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Tanggal input <span className="text-slate-400 text-xs">(default: tanggal transaksi)</span>
            </label>
            <input
              type="date"
              value={tanggalInput}
              onChange={(e) => setTanggalInput(e.target.value)}
              className="input mt-1"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Outlet <span className="text-red-600">*</span>
            </label>
            <select
              value={outletId}
              onChange={(e) => setOutletId(e.target.value)}
              className="input mt-1"
              required
            >
              {outlets.length === 0 && <option value="">— Belum ada outlet —</option>}
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nama}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Alasan / Catatan <span className="text-red-600">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Misal: Customer Pak Budi setor cicilan tapi lupa input. Dibuktikan WA."
              className="input mt-1 resize-y"
              required
            />
            <p className="mt-1 text-xs text-slate-500">
              Wajib — biar audit log jelas kenapa transaksi ini di-claim manual.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary text-sm flex-1"
              disabled={saving}
            >
              Batal
            </button>
            <button type="submit" className="btn-primary text-sm flex-1" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Menyimpan…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Claim
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
