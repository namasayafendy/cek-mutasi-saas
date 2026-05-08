import { Construction } from "lucide-react";

export default function BanksPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Bank & Rekening</h1>
        <p className="mt-1 text-sm text-slate-600">
          Atur rekening bank/e-wallet yang Anda pakai untuk terima/kirim transferan.
        </p>
      </div>
      <div className="card p-8 text-center">
        <Construction className="h-10 w-10 mx-auto text-slate-400" />
        <h2 className="mt-3 font-medium text-slate-900">Sedang dibangun</h2>
        <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
          Halaman ini akan dirilis di Phase 1C. CRUD bank, parser per format, multi-rekening
          merge vs separate mode.
        </p>
      </div>
    </div>
  );
}
