"use client";

import { useState, useRef, useMemo } from "react";
import { Upload, FileText, Loader2, AlertCircle, Lock, CheckCircle2 } from "lucide-react";
import { renderAllPages } from "@/lib/pdf/renderer";
import { parsePdfByParserId, ParserNotImplementedError } from "@/lib/parsers";
import {
  persistTransactions,
  lookupParsedTxIds,
  rowLookupKey,
  type PersistResult,
} from "@/lib/parsers/persist";
import { getParserSpec } from "@/lib/banks/registry";
import { createClient } from "@/lib/supabase/client";
import type { ParsedPdf } from "@/lib/pdf/parser";
import type { RenderedPage } from "@/lib/pdf/renderer";
import type { Bank, Jenis, PdfTransaction } from "@/lib/types";

export function UploadStep({
  banks,
  jenis,
  accountId,
  onParsed,
}: {
  banks: Bank[];
  jenis: Jenis;
  accountId: string;
  onParsed: (parsed: ParsedPdf, rendered: RenderedPage[], bank: Bank) => void;
}) {
  const [bankId, setBankId] = useState<string>(banks[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [persistInfo, setPersistInfo] = useState<PersistResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedBank = useMemo(() => banks.find((b) => b.id === bankId), [banks, bankId]);
  const spec = useMemo(() => (selectedBank ? getParserSpec(selectedBank.parser_id) : undefined), [selectedBank]);
  const requiresPassword = spec?.password_required ?? false;
  const fileAccept = spec?.format === "html" ? ".html,text/html" : ".pdf,application/pdf";

  async function handleFile(file: File) {
    setError(null);
    setPersistInfo(null);
    if (!selectedBank || !spec) {
      setError("Pilih bank/e-wallet dulu");
      return;
    }
    if (requiresPassword && !password) {
      setError("PDF ini butuh password. Isi password di bawah dulu.");
      return;
    }
    setLoading(true);
    try {
      setProgress(`Parsing ${spec.label}...`);
      const doc = await parsePdfByParserId(file, selectedBank.parser_id, {
        password: password || undefined,
      });

      // Persist all rows to history (auto dedup by no_ref + fingerprint)
      setProgress("Menyimpan ke history (auto dedup)...");
      const supabase = createClient();
      const persisted = await persistTransactions(supabase, accountId, selectedBank.id, doc.rows);
      setPersistInfo(persisted);

      // Phase 4.3: lookup parsed_tx IDs supaya match bisa di-link & claimed_by_input_id ke-update
      const idMap = await lookupParsedTxIds(supabase, accountId, selectedBank.id, doc.rows);

      // Filter rows by jenis untuk matching pool
      const transactions: PdfTransaction[] = doc.rows
        .filter((r) => (jenis === "kredit" ? r.kredit > 0 : r.debet > 0))
        .map((r) => ({
          no: r.no,
          page: r.page,
          tanggal: r.tanggal,
          tanggalDate: r.tanggalDate,
          waktu: r.waktu,
          namaPengirim: r.namaPengirim,
          deskripsi: r.deskripsi,
          kredit: jenis === "kredit" ? r.kredit : r.debet,
          bbox: r.bbox,
          parsedTxId: idMap.get(rowLookupKey(r)),
          source: "current",
        }));

      if (transactions.length === 0) {
        setError(
          `Tidak ada transaksi ${jenis} terdeteksi di file ini. ` +
            `Pastikan file adalah mutasi ${spec.label} dan ada transaksi ${jenis}-nya.`,
        );
        setLoading(false);
        return;
      }

      setProgress(`Render ${doc.pages.length} halaman...`);
      const parsed: ParsedPdf = {
        transactions,
        pages: doc.pages,
        fileBuffer: doc.fileBuffer,
      };
      const rendered = await renderAllPages(doc.fileBuffer, 1.4);
      onParsed(parsed, rendered, selectedBank);
    } catch (err) {
      console.error(err);
      if (err instanceof ParserNotImplementedError) {
        setError(
          `Parser untuk ${err.parserId} belum tersedia. Akan dirilis di update berikutnya.`,
        );
      } else {
        setError(err instanceof Error ? err.message : "Gagal parse file");
      }
      setLoading(false);
    }
  }

  if (banks.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Cek Mutasi {jenis === "kredit" ? "Kredit" : "Debet"}
          </h1>
        </div>
        <div className="card p-5 border-amber-200 bg-amber-50">
          <h2 className="font-medium text-amber-900">Belum ada bank ready</h2>
          <p className="mt-1 text-sm text-amber-800">
            Tambah dulu rekening bank di menu <strong>Bank</strong>. Pilih bank yang status-nya
            &ldquo;Ready&rdquo; supaya bisa upload mutasi.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          Cek Mutasi {jenis === "kredit" ? "Kredit (Transaksi Masuk)" : "Debet (Transaksi Keluar)"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Pilih bank, lalu upload mutasi. File diproses lokal di browser, tidak di-upload ke server.
        </p>
      </div>

      <div className="card p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700">Bank / E-Wallet</label>
          <select
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
            className="input-base mt-1"
            disabled={loading}
          >
            {banks.map((b) => {
              const sp = getParserSpec(b.parser_id);
              return (
                <option key={b.id} value={b.id}>
                  {b.label || sp?.label || b.kode}
                </option>
              );
            })}
          </select>
          {spec?.hint && <p className="mt-1 text-xs text-slate-500">{spec.hint}</p>}
        </div>

        {requiresPassword && (
          <div>
            <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" />
              Password PDF
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Misal: tanggal lahir DDMMYYYY"
              className="input-base mt-1"
              disabled={loading}
            />
            <p className="mt-1 text-xs text-slate-500">
              Mandiri PDF biasanya pakai password tanggal lahir format DDMMYYYY.
            </p>
          </div>
        )}

        <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center">
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 text-slate-500 animate-spin" />
              <p className="text-sm text-slate-700 font-medium">{progress}</p>
              <p className="text-xs text-slate-500">Sedang memproses...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-full bg-slate-100">
                <FileText className="h-8 w-8 text-slate-600" />
              </div>
              <div>
                <h3 className="font-medium text-slate-900">
                  Upload {spec?.format === "html" ? "HTML" : "PDF"} {spec?.label || ""}
                </h3>
              </div>
              <button onClick={() => inputRef.current?.click()} className="btn-primary mt-1">
                <Upload className="h-4 w-4" /> Pilih File
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={fileAccept}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {persistInfo && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-700 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>
              Disimpan ke history: <strong>{persistInfo.newCount} transaksi baru</strong>
              {persistInfo.dupCount > 0 && (
                <>, <strong>{persistInfo.dupCount} sudah ada</strong> di history (auto dedup)</>
              )}
              {persistInfo.errorCount > 0 && (
                <span className="text-red-700">
                  , {persistInfo.errorCount} error
                </span>
              )}
              .
            </span>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Cara kerja</h2>
        <ol className="mt-2 space-y-1.5 text-sm text-slate-600 list-decimal list-inside">
          <li>Pilih bank yang sesuai dengan PDF mutasi yang akan di-upload.</li>
          <li>Upload file mutasi (PDF atau HTML tergantung bank).</li>
          <li>
            Sistem otomatis simpan transaksi ke history.{" "}
            <strong>Kalau Anda upload mutasi yang overlap (misal tgl 1-3 lalu tgl 3-10),
            transaksi yang sama tidak akan dobel</strong> — di-dedup pakai No.Referensi.
          </li>
          <li>Input nominal di form, sistem cocokkan otomatis sesuai aturan di menu Aturan.</li>
          <li>Download PDF mutasi yang sudah ter-highlight + lampiran rekap.</li>
        </ol>
      </div>
    </div>
  );
}
