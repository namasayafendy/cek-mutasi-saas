import { redirect } from "next/navigation";
import { getAccountContext, trialDaysRemaining } from "@/lib/supabase/context";
import { formatDateLong, parseDateISO } from "@/lib/format";
import { Construction } from "lucide-react";

export default async function AkunPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  const { account, member } = ctx;

  const trialDays = trialDaysRemaining(account);
  const trialEndsDate = account.trial_ends_at ? parseDateISO(account.trial_ends_at.split("T")[0]) : null;
  const periodEndDate = account.current_period_end ? parseDateISO(account.current_period_end.split("T")[0]) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Akun & Tagihan</h1>
        <p className="mt-1 text-sm text-slate-600">
          Status subscription + riwayat invoice.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="font-medium text-slate-900">Status Subscription</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <div className="text-slate-500 text-xs">Status</div>
            <div className="font-medium text-slate-900 capitalize">{account.status}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Plan</div>
            <div className="font-medium text-slate-900">{account.plan}</div>
          </div>
          {account.status === "trial" && trialEndsDate && (
            <div>
              <div className="text-slate-500 text-xs">Trial Berakhir</div>
              <div className="font-medium text-slate-900">
                {formatDateLong(trialEndsDate)}
                {trialDays !== null && ` (sisa ${trialDays} hari)`}
              </div>
            </div>
          )}
          {periodEndDate && (
            <div>
              <div className="text-slate-500 text-xs">Renewal Berikutnya</div>
              <div className="font-medium text-slate-900">{formatDateLong(periodEndDate)}</div>
            </div>
          )}
          <div>
            <div className="text-slate-500 text-xs">Role Anda</div>
            <div className="font-medium text-slate-900 capitalize">{member.role}</div>
          </div>
        </div>
      </div>

      <div className="card p-8 text-center">
        <Construction className="h-10 w-10 mx-auto text-slate-400" />
        <h2 className="mt-3 font-medium text-slate-900">Pembayaran Midtrans</h2>
        <p className="mt-1 text-sm text-slate-600 max-w-md mx-auto">
          Integrasi billing Midtrans + invoice dirilis di Phase 7. Sementara ini akun Anda
          tetap aktif di periode trial.
        </p>
      </div>
    </div>
  );
}
