import { Suspense } from "react";
import { BelumCocokClient } from "./belum-cocok-client";

export const dynamic = "force-dynamic";

export default function BelumCocokPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Resi belum ketemu di rekening</h1>
        <p className="mt-1 text-sm text-slate-600">
          Lapis 2 — resi yang sudah dicari di mutasi dan tidak ditemukan. Selama belum
          diselesaikan di sini, ia muncul lagi di setiap laporan.
        </p>
      </div>
      <Suspense fallback={<div className="card p-6 text-center text-sm text-slate-500">Memuat…</div>}>
        <BelumCocokClient />
      </Suspense>
    </div>
  );
}
