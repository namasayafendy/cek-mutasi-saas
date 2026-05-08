import { Construction } from "lucide-react";

export default function AturanPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Aturan Matching</h1>
        <p className="mt-1 text-sm text-slate-600">
          Atur lookback period, forward window, match mode (exact / toleransi).
        </p>
      </div>
      <div className="card p-8 text-center">
        <Construction className="h-10 w-10 mx-auto text-slate-400" />
        <h2 className="mt-3 font-medium text-slate-900">Sedang dibangun</h2>
        <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
          Halaman ini akan dirilis di Phase 1D. Sementara default rules: lookback 3 hari, exact match.
        </p>
      </div>
    </div>
  );
}
