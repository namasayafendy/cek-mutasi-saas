"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah, formatDateID, parseDateISO, toDateISO } from "@/lib/format";

export type UnclaimedTx = {
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

type ClaimType = "customer" | "bunga" | "admin" | "lain";

export function ManualClaimModal({
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

  const [claimType, setClaimType] = useState<ClaimType>("customer");
  const [outletId, setOutletId] = useState<string>(outlets[0]?.id ?? "");
  const [tanggalInput, setTanggalInput] = useState<string>(
    txDate ? toDateISO(txDate) : tx.tanggal,
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bank = tx.bank_id ? banks.find((b) => b.id === tx.bank_id) : null;
  const isCustomer = claimType === "customer";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Alasan / catatan wajib diisi.");
      return;
    }
    if (isCustomer && !outletId) {
      setError("Outlet wajib dipilih untuk claim customer.");
      return;
    }

    setSaving(true);
    setError(null);

    const supabase = createClient();
    const now = new Date().toISOString();

    const { data: insertedInput, error: insertErr } = await supabase
      .from("cek_inputs")
      .insert({
        session_id: null,
        account_id: accountId,
        tanggal_input: tanggalInput,
        outlet_id: isCustomer ? outletId : null,
        bank_id: tx.bank_id,
        nominal: amount,
        jenis: isKredit ? "kredit" : "debet",
        match_status: "manual_claimed",
        matched_tx_id: tx.id,
        manual_claim_reason: reason.trim(),
        manual_claimed_at: now,
        claim_category: claimType,
      })
      .select("id")
      .single();

    if (insertErr || !insertedInput) {
      setError(`Gagal claim: ${insertErr?.message ?? "unknown"}`);
      setSaving(false);
      return;
    }

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

    await supabase.from("audit_logs").insert({
      account_id: accountId,
      user_id: userId,
      action: "tx.manual_claimed",
      target_type: "parsed_transaction",
      target_id: tx.id,
      metadata: {
        nominal: amount,
        jenis: isKredit ? "kredit" : "debet",
        outlet_id: isCustomer ? outletId : null,
        category: claimType,
        reason: reason.trim(),
      },
    });

    setSaving(false);
    onClose();
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">Claim Manual Transaksi</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" disabled={saving}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Tipe Claim
            </label>
            <div className="grid grid-cols-2 gap-2">
              <ClaimTypeCard
                label="Customer"
                desc="Transferan customer (perlu outlet)"
                active={claimType === "customer"}
                onClick={() => setClaimType("customer")}
              />
              <ClaimTypeCard
                label="Bunga"
                desc="Bunga bank"
                active={claimType === "bunga"}
                onClick={() => setClaimType("bunga")}
              />
              <ClaimTypeCard
                label="Fee Admin"
                desc="Biaya admin / transfer"
                active={claimType === "admin"}
                onClick={() => setClaimType("admin")}
              />
              <ClaimTypeCard
                label="Lain-lain"
                desc="Transfer pribadi, refund, dll"
                active={claimType === "lain"}
                onClick={() => setClaimType("lain")}
              />
            </div>
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

          {isCustomer && (
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
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700">
              {isCustomer ? "Alasan / Catatan" : "Catatan"}{" "}
              <span className="text-red-600">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={
                isCustomer
                  ? "Misal: Customer Pak Budi setor cicilan tapi lupa input. Dibuktikan WA."
                  : claimType === "bunga"
                    ? "Misal: Bunga giro bulan April"
                    : claimType === "admin"
                      ? "Misal: Biaya admin transfer antarbank"
                      : "Misal: Transfer pribadi dari rekening lain"
              }
              className="input mt-1 resize-y"
              required
            />
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

function ClaimTypeCard({
  label,
  desc,
  active,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-2 rounded border ${
        active
          ? "border-slate-900 bg-slate-50"
          : "border-slate-200 bg-white hover:border-slate-400"
      }`}
    >
      <div className="text-xs font-medium text-slate-900">{label}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{desc}</div>
    </button>
  );
}
