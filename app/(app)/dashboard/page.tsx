import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  Store,
  Building2,
  FileText,
  Users,
  AlertCircle,
  CheckCircle2,
  MessageCircle,
  Mail,
  Sparkles,
  Activity,
} from "lucide-react";
import { getAccountContext, trialDaysRemaining } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateLong, parseDateISO, diffDays } from "@/lib/format";
import { getLastCheckedDates, todayISOWIB } from "@/lib/sessions/last-checked";

export default async function DashboardPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");
  const { account, member } = ctx;
  const isOwner = member.role === "owner";

  const supabase = await createClient();
  const [outletsRes, banksRes, rulesRes, staffRes, lastChecked] = await Promise.all([
    supabase.from("outlets").select("id"),
    supabase.from("banks").select("id, is_active"),
    supabase
      .from("match_rules")
      .select("id")
      .is("deleted_at", null),
    supabase.from("team_members").select("id, role"),
    getLastCheckedDates(supabase),
  ]);

  const outletCount = outletsRes.data?.length ?? 0;
  const banksTotal = banksRes.data?.length ?? 0;
  const banksActive = (banksRes.data ?? []).filter((b) => b.is_active).length;
  const rulesCount = rulesRes.data?.length ?? 0;
  const staffCount = (staffRes.data ?? []).filter((m) => m.role === "staff").length;
  const staffLimit = account.staff_limit ?? 3;

  const todayISO = todayISOWIB();
  const trialDays = trialDaysRemaining(account);

  const setupComplete = outletCount > 0 && banksActive > 0;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-[#FAFAF7] via-white to-[#10B981]/5 border border-slate-200 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#10B981]/10 border border-[#10B981]/20 px-3 py-1 text-xs font-medium text-[#0F2E1F] mb-3">
              <Sparkles className="h-3.5 w-3.5 text-[#10B981]" />
              Selamat datang
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
              Halo{account.brand_name ? `, ${account.brand_name}` : ""}!
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {setupComplete
                ? "Pilih jenis cek mutasi untuk mulai, atau kelola pengaturan di bawah."
                : "Lengkapi setup awal di bawah, baru bisa mulai cek mutasi."}
            </p>
          </div>
          {account.status === "trial" && trialDays !== null && (
            <div className="inline-flex items-center gap-2 rounded-lg bg-white border border-amber-200 px-4 py-2 text-sm">
              <Calendar className="h-4 w-4 text-amber-600" />
              <span className="text-slate-700">
                Trial sisa <strong className="text-amber-700">{trialDays} hari</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Data terakhir dicek — penanda lanjut setelah libur/tertumpuk */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Data Terakhir Dicek
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <LastCheckedCard
            title="Transaksi Masuk (Kredit)"
            icon={<ArrowDownToLine className="h-5 w-5" />}
            dateISO={lastChecked.kredit}
            todayISO={todayISO}
            href="/check?jenis=kredit"
          />
          <LastCheckedCard
            title="Transaksi Keluar (Debet)"
            icon={<ArrowUpFromLine className="h-5 w-5" />}
            dateISO={lastChecked.debet}
            todayISO={todayISO}
            href="/check?jenis=debet"
          />
        </div>
      </div>

      {/* Setup incomplete warning */}
      {isOwner && !setupComplete && (
        <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="font-semibold text-amber-900">Setup awal belum lengkap</h2>
            <p className="mt-1 text-sm text-amber-800">
              Sebelum cek mutasi, butuh minimal 1 outlet + 1 bank aktif. Atur di
              kartu Setup di bawah.
            </p>
          </div>
        </div>
      )}

      {/* Big CTA — nyawa aplikasi */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Cek Mutasi
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Cek Masuk (Kredit) */}
          <Link
            href={setupComplete ? "/check?jenis=kredit" : "#"}
            aria-disabled={!setupComplete}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#10B981] via-[#059669] to-[#047857] p-6 sm:p-7 text-white shadow-lg transition-all ${
              setupComplete
                ? "hover:shadow-xl hover:-translate-y-0.5 cursor-pointer"
                : "opacity-50 cursor-not-allowed"
            }`}
          >
            {/* Decorative circle */}
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-white/10 group-hover:bg-white/15 transition-colors" />
            <div className="absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-white/5" />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm mb-4">
                <ArrowDownToLine className="h-6 w-6" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold">Cek Transaksi Masuk</h3>
              <p className="mt-1.5 text-sm text-white/80 max-w-sm">
                Cocokkan transferan customer dengan mutasi kredit di rekening
                Anda.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-white text-[#047857] px-4 py-2.5 text-sm font-semibold group-hover:bg-[#FAFAF7] transition-colors">
                Mulai Cek Masuk
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>

          {/* Cek Keluar (Debet) */}
          <Link
            href={setupComplete ? "/check?jenis=debet" : "#"}
            aria-disabled={!setupComplete}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1a4530] via-[#0F2E1F] to-[#0a1f15] p-6 sm:p-7 text-white shadow-lg transition-all ${
              setupComplete
                ? "hover:shadow-xl hover:-translate-y-0.5 cursor-pointer"
                : "opacity-50 cursor-not-allowed"
            }`}
          >
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-[#10B981]/15 group-hover:bg-[#10B981]/25 transition-colors" />
            <div className="absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-[#10B981]/10" />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#10B981]/20 backdrop-blur-sm mb-4">
                <ArrowUpFromLine className="h-6 w-6 text-[#10B981]" />
              </div>
              <h3 className="text-xl sm:text-2xl font-bold">Cek Transaksi Keluar</h3>
              <p className="mt-1.5 text-sm text-white/75 max-w-sm">
                Cocokkan pembayaran ke supplier / vendor dengan mutasi debet
                rekening.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#10B981] hover:bg-[#0ea571] text-white px-4 py-2.5 text-sm font-semibold transition-colors">
                Mulai Cek Keluar
                <ArrowRight className="h-4 w-4" />
              </div>
            </div>
          </Link>
        </div>
      </div>

      {/* Setup cards (4 grids) */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Pengaturan Awal
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SetupCard
            icon={<Store className="h-5 w-5" />}
            title="Outlet"
            count={outletCount}
            countLabel={outletCount === 0 ? "Belum ada" : `${outletCount} cabang`}
            href="/outlets"
            isWarning={outletCount === 0}
            disabled={!isOwner}
          />
          <SetupCard
            icon={<Building2 className="h-5 w-5" />}
            title="Bank"
            count={banksActive}
            countLabel={
              banksTotal === 0
                ? "Belum ada"
                : `${banksActive} aktif${banksTotal > banksActive ? ` (${banksTotal - banksActive} non-aktif)` : ""}`
            }
            href="/banks"
            isWarning={banksActive === 0}
            disabled={!isOwner}
          />
          <SetupCard
            icon={<FileText className="h-5 w-5" />}
            title="Aturan"
            count={rulesCount}
            countLabel={rulesCount === 0 ? "Default sistem" : `${rulesCount} aturan`}
            href="/aturan"
            isWarning={false}
            disabled={!isOwner}
          />
          <SetupCard
            icon={<Users className="h-5 w-5" />}
            title="Staff"
            count={staffCount}
            countLabel={`${staffCount} / ${staffLimit} staff`}
            href="/staff"
            isWarning={false}
            disabled={!isOwner}
          />
        </div>
      </div>

      {/* Help / Hubungi Kami */}
      <div className="rounded-2xl bg-gradient-to-br from-[#FAFAF7] to-[#10B981]/5 border border-slate-200 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#10B981]/15 text-[#10B981] flex-shrink-0">
            <MessageCircle className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-[#0F2E1F]">Butuh bantuan?</h3>
            <p className="mt-1 text-sm text-slate-600 leading-relaxed">
              Bank Anda belum didukung? PDF mutasi gagal di-parse? Atau ada
              masalah lain? Hubungi kami langsung. Kirim file PDF lewat email,
              tim kami akan benerin segera (biasanya kurang dari 24 jam pada
              hari kerja).
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <a
                href="mailto:admin@cektransfer.com?subject=Bantuan%20CekTransfer"
                className="inline-flex items-center justify-center gap-2 bg-[#0F2E1F] hover:bg-[#1a4530] text-white rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
              >
                <Mail className="h-4 w-4" />
                Email (preferred)
                <span className="text-xs text-white/70 hidden sm:inline">
                  · admin@cektransfer.com
                </span>
              </a>
              <a
                href="https://wa.me/6282277802886?text=Halo%20CekTransfer%2C%20saya%20butuh%20bantuan"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-white hover:bg-[#FAFAF7] text-[#0F2E1F] border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
              >
                <MessageCircle className="h-4 w-4 text-[#10B981]" />
                WhatsApp
                <span className="text-xs text-slate-500 hidden sm:inline">
                  · 0822-7780-2886
                </span>
              </a>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              <strong>Tip:</strong> Lampirkan file PDF mutasi di email — kami
              akan tambahkan parser bank baru atau perbaiki yang rusak.
            </p>
          </div>
        </div>
      </div>

      {/* Trial / subscription info */}
      {account.status === "trial" && trialDays !== null && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-[#10B981] flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-sm text-slate-700">
            Anda dalam masa trial &mdash; sisa <strong>{trialDays} hari</strong>.
            {isOwner && (
              <>
                {" "}
                <Link
                  href="/akun"
                  className="text-[#10B981] hover:underline font-medium"
                >
                  Upgrade ke Pro
                </Link>{" "}
                untuk lanjut pakai setelah trial habis.
              </>
            )}
          </div>
        </div>
      )}

      {/* Activity link for owners */}
      {isOwner && (
        <div className="text-center text-sm text-slate-500">
          <Link
            href="/activity"
            className="inline-flex items-center gap-1.5 hover:text-[#0F2E1F]"
          >
            <Activity className="h-4 w-4" />
            Lihat log aktivitas akun
          </Link>
        </div>
      )}
    </div>
  );
}

function LastCheckedCard({
  title,
  icon,
  dateISO,
  todayISO,
  href,
}: {
  title: string;
  icon: React.ReactNode;
  dateISO: string | null;
  todayISO: string;
  href: string;
}) {
  const date = dateISO ? parseDateISO(dateISO) : null;
  const today = parseDateISO(todayISO);
  const daysAgo = date && today ? diffDays(today, date) : null;
  const nextDate = date ? new Date(date.getTime() + 24 * 60 * 60 * 1000) : null;

  // Umur data: hijau <=1 hari, kuning 2-3 hari, merah >3 hari (tertumpuk)
  let badgeLabel = "Belum pernah cek";
  let badgeClass = "bg-slate-100 text-slate-600 border-slate-200";
  if (daysAgo !== null) {
    if (daysAgo <= 0) {
      badgeLabel = "hari ini";
      badgeClass = "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30";
    } else if (daysAgo === 1) {
      badgeLabel = "kemarin";
      badgeClass = "bg-[#10B981]/10 text-[#047857] border-[#10B981]/30";
    } else if (daysAgo <= 3) {
      badgeLabel = `${daysAgo} hari lalu`;
      badgeClass = "bg-amber-50 text-amber-700 border-amber-300";
    } else {
      badgeLabel = `${daysAgo} hari lalu — tertumpuk!`;
      badgeClass = "bg-red-50 text-red-700 border-red-300";
    }
  }

  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white p-5 hover:border-[#10B981]/40 hover:shadow-sm transition-all block"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-slate-500 text-xs font-medium">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[#10B981]/10 text-[#10B981]">
            {icon}
          </span>
          <span>{title}</span>
        </div>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeClass}`}
        >
          {badgeLabel}
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500">terakhir dicek s/d transaksi tanggal</p>
      <p className="mt-0.5 text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
        {date ? formatDateLong(date) : "—"}
      </p>
      {nextDate && (
        <p className="mt-2 text-sm text-slate-600">
          Lanjut upload mutasi mulai{" "}
          <strong className="text-[#0F2E1F]">{formatDateLong(nextDate)}</strong>
          <ArrowRight className="inline h-3.5 w-3.5 ml-1 text-[#10B981] group-hover:translate-x-0.5 transition-transform" />
        </p>
      )}
    </Link>
  );
}

function SetupCard({
  icon,
  title,
  count,
  countLabel,
  href,
  isWarning,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  countLabel: string;
  href: string;
  isWarning: boolean;
  disabled: boolean;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between">
        <div
          className={`inline-flex items-center justify-center w-10 h-10 rounded-lg ${
            isWarning
              ? "bg-amber-100 text-amber-700"
              : "bg-[#10B981]/10 text-[#10B981]"
          }`}
        >
          {icon}
        </div>
        {isWarning && (
          <AlertCircle className="h-4 w-4 text-amber-500" aria-label="Belum diatur" />
        )}
      </div>
      <h3 className="mt-3 font-semibold text-[#0F2E1F]">{title}</h3>
      <div className="mt-1">
        <p className="text-2xl font-bold text-[#0F2E1F]">{count}</p>
        <p className="text-xs text-slate-500 mt-0.5">{countLabel}</p>
      </div>
      {!disabled && (
        <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#10B981] group-hover:gap-1.5 transition-all">
          {count === 0 ? "Atur sekarang" : "Kelola"}
          <ArrowRight className="h-3 w-3" />
        </div>
      )}
    </>
  );

  if (disabled) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 opacity-60 cursor-not-allowed">
        {content}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group rounded-xl border border-slate-200 bg-white p-4 hover:border-[#10B981]/40 hover:shadow-sm transition-all block"
    >
      {content}
    </Link>
  );
}
