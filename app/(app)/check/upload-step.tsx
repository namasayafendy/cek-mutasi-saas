"use client";

import { useState, useRef } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { parsePdfFile } from "@/lib/pdf/parser";
import { renderAllPages } from "@/lib/pdf/renderer";
import type { ParsedPdf } from "@/lib/pdf/parser";
import type { RenderedPage } from "@/lib/pdf/renderer";

export function UploadStep({
  onParsed,
}: {
  onParsed: (parsed: ParsedPdf, rendered: RenderedPage[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("File harus berekstensi .pdf");
      return;
    }
    setLoading(true);
    try {
      setProgress("Parsing PDF...");
      const parsed = await parsePdfFile(file);
      if (parsed.transactions.length === 0) {
        setError(
          "Tidak ada transaksi kredit terdeteksi. Pastikan format PDF adalah Mutasi Rekening BSI standard.",
        );
        setLoading(false);
        return;
      }
      setProgress(`Render ${parsed.pages.length} halaman...`);
      const rendered = await renderAllPages(parsed.fileBuffer, 1.4);
      onParsed(parsed, rendered);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Gagal parse PDF");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Cek Mutasi</h1>
        <p className="mt-1 text-sm text-slate-600">
          Upload PDF mutasi BSI untuk mulai cek transferan tebusan.
        </p>
      </div>

      <div className="card p-8">
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-10 text-center">
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 text-slate-500 animate-spin" />
              <p className="text-sm text-slate-700 font-medium">{progress}</p>
              <p className="text-xs text-slate-500">Sedang memproses, sebentar...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 rounded-full bg-slate-100">
                <FileText className="h-8 w-8 text-slate-600" />
              </div>
              <div>
                <h3 className="font-medium text-slate-900">Upload PDF Mutasi BSI</h3>
                <p className="text-sm text-slate-600 mt-1">
                  File PDF Anda diproses lokal di browser, tidak di-upload ke server.
                </p>
              </div>
              <button
                onClick={() => inputRef.current?.click()}
                className="btn-primary mt-2"
              >
                <Upload className="h-4 w-4" />
                Pilih File PDF
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,application/pdf"
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
          <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Cara kerja singkat</h2>
        <ol className="mt-2 space-y-1.5 text-sm text-slate-600 list-decimal list-inside">
          <li>Upload PDF mutasi BSI Anda.</li>
          <li>
            Pilih outlet + tanggal di form input, ketik nominal-nominal transferan
            satu per baris (bulk).
          </li>
          <li>
            Sistem otomatis cocokkan: nominal sama, tanggal di PDF ≤ tanggal input,
            max mundur 3 hari.
          </li>
          <li>PDF di sebelah kiri otomatis ter-highlight realtime sesuai warna outlet.</li>
          <li>Selesai → klik download untuk dapat PDF asli yang sudah ter-highlight + lampiran rekap.</li>
        </ol>
      </div>
    </div>
  );
}
