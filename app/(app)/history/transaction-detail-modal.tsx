"use client";

import Link from "next/link";
import {
  X,
  Calendar,
  Hand,
  CheckCircle2,
  ArrowDown,
  ArrowUp,
  Building2,
  ExternalLink,
  Clock,
  PencilLine,
  FileText,
} from "lucide-react";
import { formatRupiah, formatDateID, parseDateISO, formatDateLong } from "@/lib/format";

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
  /** Id klaim Aceh Gadai yang memegang baris ini. */
  gadai_klaim_id?: string | null;
  /** Nomor kontrak (SBR/SJB) pemegangnya. NULL untuk baris lama (kolomnya baru
   *  ada 13 Agustus 2026) dan untuk input manual lokal yang bukan klaim gadai. */
  gadai_no_faktur?: string | null;
};

type OutletLite = { id: string; nama: string; warna_hex: string };
type BankLite = { id: string; kode: string; label: string | null };

export function TransactionDetailModal({
  tx,
  inputInfo,
  outlet,
  bank,
  onClose,
  onClaimManual,
}: {
  tx: MutasiRow;
  inputInfo: ClaimedInputInfo | null;
  outlet: OutletLite | null;
  bank: BankLite | null;
  onClose: () => void;
  onClaimManual?: () => void;
}) {
  const isKredit = tx.nominal_kredit > 0;
  const amount = isKredit ? tx.nominal_kredit : tx.nominal_debet;
  const txDate = parseDateISO(tx.tanggal);
  const inputDate = inputInfo?.tanggal_input ? parseDateISO(inputInfo.tanggal_input) : null;
  const claimedAt = tx.claimed_at ? new Date(tx.claimed_at) : null;
  const inputCreatedAt = inputInfo?.created_at ? new Date(inputInfo.created_at) : null;
  const manualClaimedAt = inputInfo?.manual_claimed_at
    ? new Date(inputInfo.manual_claimed_at)
    : null;

  const isMatched = !!tx.claimed_by_input_id;
  const isManual = !!inputInfo?.manual_claim_reason || !!tx.manual_claim_reason;
  const reason = inputInfo?.manual_claim_reason ?? tx.manual_claim_reason;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-900 flex items-center gap-2">
            {isKredit ? (
              <ArrowDown className="h-4 w-4 text-green-600" />
            ) : (
              <ArrowUp className="h-4 w-4 text-red-600" />
            )}
            Detail Transaksi
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Tutup"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tx info section */}
          <div className="rounded-md bg-slate-50 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Tanggal Transaksi
              </span>
              <span className="font-medium text-slate-900">
                {txDate ? formatDateLong(txDate) : tx.tanggal}
                {tx.jam && <span className="text-slate-500 ml-1">{tx.jam}</span>}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" /> Bank
              </span>
              <span className="font-medium text-slate-900">
                {bank ? bank.label || bank.kode : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Jenis</span>
              {isKredit ? (
                <span className="text-green-700 font-medium">Kredit (masuk)</span>
              ) : (
                <span className="text-red-700 font-medium">Debet (keluar)</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm pt-1.5 border-t border-slate-200">
              <span className="text-slate-500 text-xs">Nominal</span>
              <span
                className={`font-mono font-semibold ${
                  isKredit ? "text-green-700" : "text-red-700"
                }`}
              >
                Rp {formatRupiah(amount)}
              </span>
            </div>
            {tx.saldo !== null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Saldo setelah tx</span>
                <span className="font-mono text-slate-700">Rp {formatRupiah(tx.saldo)}</span>
              </div>
            )}
            {(tx.nama_pengirim || tx.nama_penerima || tx.deskripsi) && (
              <div className="pt-1.5 border-t border-slate-200 space-y-0.5">
                {(tx.nama_pengirim || tx.nama_penerima) && (
                  <div className="text-xs">
                    <span className="text-slate-500">{isKredit ? "Pengirim" : "Penerima"}: </span>
                    <span className="text-slate-900">
                      {tx.nama_pengirim || tx.nama_penerima}
                    </span>
                  </div>
                )}
                {tx.deskripsi && (
                  <div className="text-xs text-slate-600 italic break-words">
                    {tx.deskripsi}
                  </div>
                )}
                {tx.no_ref && (
                  <div className="text-[10px] text-slate-400">No.Ref: {tx.no_ref}</div>
                )}
              </div>
            )}
          </div>

          {/* Tracking section */}
          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Tracking
            </h3>

            {!isMatched ? (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                Transaksi ini <strong>belum di-claim</strong> oleh input manapun. Belum pernah
                muncul di sesi cek mutasi.
              </div>
            ) : (
              <div className="space-y-2">
                {/* Status: matched */}
                <div className="rounded-md bg-green-50 border border-green-200 p-3 text-xs space-y-1.5">
                  <div className="flex items-center gap-1.5 font-medium text-green-800">
                    {isManual ? (
                      <>
                        <Hand className="h-3.5 w-3.5" />
                        Di-claim manual
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Auto-matched dengan input
                      </>
                    )}
                  </div>
                  {outlet && (
                    <div className="flex items-center gap-1.5 text-green-700">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: outlet.warna_hex }}
                      />
                      Outlet: <strong>{outlet.nama}</strong>
                    </div>
                  )}
                  {/* NOMOR KONTRAKNYA, bukan cuma outletnya.
                      Pemilik, 13 Agustus 2026: "sekarang hanya ada catatan
                      diklaim oleh outlet mana — buat no kontraknya juga tampil".
                      Menelusuri "uang ini milik siapa" mustahil dengan nama
                      outlet: satu outlet mengklaim puluhan baris sehari. */}
                  {inputInfo?.gadai_no_faktur && (
                    <div className="flex items-center gap-1.5 text-green-800">
                      <FileText className="h-3.5 w-3.5" />
                      Kontrak: <strong>{inputInfo.gadai_no_faktur}</strong>
                    </div>
                  )}
                  {/* Baris lama belum menyimpan nomor kontrak (kolomnya baru
                      ada 13 Agu 2026). Id klaimnya tetap ditampilkan supaya
                      tidak ada yang kosong tanpa keterangan — id itu masih bisa
                      dicari di aplikasi gadai. */}
                  {!inputInfo?.gadai_no_faktur && inputInfo?.gadai_klaim_id && (
                    <div className="flex items-center gap-1.5 text-green-700">
                      <FileText className="h-3.5 w-3.5" />
                      Klaim gadai: <strong>{inputInfo.gadai_klaim_id}</strong>
                      <span className="text-green-600/70">(no kontrak belum tercatat)</span>
                    </div>
                  )}
                  {reason && (
                    <div className="text-green-800 italic break-words">
                      Alasan: &quot;{reason}&quot;
                    </div>
                  )}
                </div>

                {/* Timeline */}
                <div className="space-y-1.5">
                  {inputDate && (
                    <TrackingRow
                      icon={<Calendar className="h-3 w-3" />}
                      label="Tanggal di-input owner"
                      value={formatDateID(inputDate)}
                      hint="Tanggal yang diketik owner saat cek mutasi"
                    />
                  )}
                  {inputCreatedAt && (
                    <TrackingRow
                      icon={<PencilLine className="h-3 w-3" />}
                      label="Kapan input dibuat"
                      value={`${formatDateLong(inputCreatedAt)} ${inputCreatedAt.toLocaleTimeString(
                        "id-ID",
                        { hour: "2-digit", minute: "2-digit" },
                      )}`}
                      hint="Saat owner ketik nominal di form input"
                    />
                  )}
                  {claimedAt && !manualClaimedAt && (
                    <TrackingRow
                      icon={<CheckCircle2 className="h-3 w-3" />}
                      label="Kapan ke-match"
                      value={`${formatDateLong(claimedAt)} ${claimedAt.toLocaleTimeString(
                        "id-ID",
                        { hour: "2-digit", minute: "2-digit" },
                      )}`}
                      hint="Saat sistem auto-match input ke transaksi ini"
                    />
                  )}
                  {manualClaimedAt && (
                    <TrackingRow
                      icon={<Hand className="h-3 w-3" />}
                      label="Kapan di-claim manual"
                      value={`${formatDateLong(manualClaimedAt)} ${manualClaimedAt.toLocaleTimeString(
                        "id-ID",
                        { hour: "2-digit", minute: "2-digit" },
                      )}`}
                      hint="Saat owner klik 'Claim manual' di /history"
                    />
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button onClick={onClose} className="btn-secondary text-sm flex-1">
              Tutup
            </button>
            {!isMatched && onClaimManual && (
              <button
                onClick={onClaimManual}
                className="btn-primary text-sm flex-1 inline-flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Claim Manual
              </button>
            )}
            {inputInfo?.session_id && (
              <Link
                href={`/history/${inputInfo.session_id}`}
                className="btn-primary text-sm flex-1 inline-flex items-center justify-center gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Buka Session
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackingRow({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500 inline-flex items-center gap-1">
          {icon} {label}
        </span>
        <span className="font-medium text-slate-900">{value}</span>
      </div>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}
