import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Check,
  Shield,
  Zap,
  Building2,
  FileText,
  Hand,
  Layers,
  Upload,
  Calculator,
  Download,
} from "lucide-react";
import { getAccountContext } from "@/lib/supabase/context";
import { PublicHeader } from "@/app/_components/public-header";
import { PublicFooter } from "@/app/_components/public-footer";
import { LogoIcon } from "@/app/logo";

export default async function LandingPage() {
  const ctx = await getAccountContext();
  if (ctx) redirect("/dashboard");

  return (
    <>
      <PublicHeader />

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#FAFAF7] to-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-20 sm:py-28 text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 px-3 py-1 text-xs font-medium text-[#0F2E1F] mb-6">
            <Shield className="h-3.5 w-3.5 text-[#10B981]" />
            Privacy-first &middot; PDF tidak pernah di-upload ke server
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-[#0F2E1F] leading-tight">
            Cocokkan transferan customer <br className="hidden sm:block" />
            dengan mutasi bank dalam{" "}
            <span className="text-[#10B981]">hitungan detik</span>
          </h1>
          <p className="mt-5 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
            Upload PDF mutasi rekening, sistem otomatis cocokkan dengan input
            customer Anda. Tidak perlu lagi cek manual baris per baris. Cocok untuk
            pegadaian, toko, kos-kosan, atau bisnis apa pun yang menerima transfer.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/daftar"
              className="inline-flex items-center justify-center gap-2 bg-[#0F2E1F] hover:bg-[#1a4530] text-white rounded-md px-6 py-3 text-sm font-semibold transition-colors"
            >
              Mulai Trial 7 Hari Gratis
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="#fitur"
              className="inline-flex items-center justify-center gap-2 bg-white hover:bg-[#FAFAF7] text-[#0F2E1F] border border-slate-200 rounded-md px-6 py-3 text-sm font-semibold transition-colors"
            >
              Lihat Fitur
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Tidak perlu kartu kredit &middot; Bebas cancel kapan saja
          </p>
        </div>
      </section>

      {/* Trust badges */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          <TrustBadge icon={<Shield className="h-5 w-5" />} title="Privacy-first">
            PDF di-proses di browser
          </TrustBadge>
          <TrustBadge icon={<Building2 className="h-5 w-5" />} title="Multi-Bank">
            BSI, BCA, BNI, Mandiri
          </TrustBadge>
          <TrustBadge icon={<Layers className="h-5 w-5" />} title="Multi-Cabang">
            Pisahkan per outlet
          </TrustBadge>
          <TrustBadge icon={<Zap className="h-5 w-5" />} title="Cepat">
            Match dalam detik
          </TrustBadge>
        </div>
      </section>

      {/* Fitur */}
      <section id="fitur" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
              Semua yang Anda butuhkan untuk cek mutasi
            </h2>
            <p className="mt-3 text-slate-600">
              Dirancang khusus untuk UMKM Indonesia. Tidak perlu pelatihan, tidak
              perlu IT &mdash; tinggal pakai.
            </p>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<Zap className="h-5 w-5" />}
              title="Match Otomatis"
              desc="Sistem cocokkan input customer ke transaksi mutasi berdasarkan tanggal & nominal. Tidak perlu cek manual."
            />
            <FeatureCard
              icon={<Building2 className="h-5 w-5" />}
              title="Multi-Bank"
              desc="Support BSI, BCA, BNI, Mandiri, dan e-wallet seperti DANA. Upload sekaligus, cross-match antar bank."
            />
            <FeatureCard
              icon={<Layers className="h-5 w-5" />}
              title="Multi-Outlet / Cabang"
              desc="Bisnis multi-cabang? Tag tiap input ke outlet, hasil rekap otomatis terpisah per cabang."
            />
            <FeatureCard
              icon={<Shield className="h-5 w-5" />}
              title="Privacy by Design"
              desc="PDF mutasi diproses langsung di browser Anda. Server kami hanya menyimpan hasil cocokan, bukan PDF."
            />
            <FeatureCard
              icon={<FileText className="h-5 w-5" />}
              title="History &amp; Rekap PDF"
              desc="Semua sesi cek tersimpan rapi. Export rekap PDF per bulan untuk laporan ke owner atau audit."
            />
            <FeatureCard
              icon={<Hand className="h-5 w-5" />}
              title="Manual Claim"
              desc="Bisa tandai transfer sebagai bunga bank, biaya admin, atau transfer pribadi. Bukan hanya transaksi customer."
            />
          </div>
        </div>
      </section>

      {/* Cara Kerja */}
      <section id="cara-kerja" className="py-20 sm:py-24 bg-[#FAFAF7]">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
              Tiga langkah, selesai
            </h2>
            <p className="mt-3 text-slate-600">
              Dari buka aplikasi sampai tahu siapa customer yang sudah transfer
              &mdash; rata-rata kurang dari 2 menit.
            </p>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            <Step
              num="1"
              icon={<Upload className="h-5 w-5" />}
              title="Upload PDF Mutasi"
              desc="Pilih bank, upload file mutasi yang Anda download dari mobile/internet banking."
            />
            <Step
              num="2"
              icon={<Calculator className="h-5 w-5" />}
              title="Input Nominal Customer"
              desc="Ketik nominal transfer customer + tanggal + outlet. Bisa banyak sekaligus."
            />
            <Step
              num="3"
              icon={<Download className="h-5 w-5" />}
              title="Lihat Hasil &amp; Export"
              desc="Hasil match langsung tampil. Bisa download PDF rekap, simpan ke history, atau lanjut input lagi."
            />
          </div>
        </div>
      </section>

      {/* Harga */}
      <section id="harga" className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#0F2E1F]">
              Harga sederhana, tanpa kejutan
            </h2>
            <p className="mt-3 text-slate-600">
              Satu paket flat, semua fitur include. Cancel kapan saja.
            </p>
          </div>
          <div className="mt-10 max-w-md mx-auto">
            <div className="p-8 border-2 border-[#10B981] shadow-lg relative bg-white rounded-2xl">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#10B981] text-white text-xs font-semibold px-3 py-1 rounded-full">
                Trial 7 Hari Gratis
              </div>
              <h3 className="text-lg font-semibold text-[#0F2E1F]">CekTransfer Pro</h3>
              <p className="mt-1 text-sm text-slate-500">Cocok untuk UMKM dan multi-cabang</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold text-[#0F2E1F]">Rp 99.000</span>
                <span className="text-slate-500">/bulan</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Sudah termasuk PPN. Trial 7 hari, tanpa kartu kredit.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-slate-700">
                <PriceFeature>Cek mutasi unlimited</PriceFeature>
                <PriceFeature>Sampai 3 staff per akun</PriceFeature>
                <PriceFeature>Multi-outlet / cabang</PriceFeature>
                <PriceFeature>Multi-bank (BSI, BCA, BNI, Mandiri, dst)</PriceFeature>
                <PriceFeature>History &amp; rekap PDF</PriceFeature>
                <PriceFeature>Manual claim untuk non-customer</PriceFeature>
                <PriceFeature>Privacy: PDF tidak di-upload ke server</PriceFeature>
                <PriceFeature>Support email &amp; WhatsApp</PriceFeature>
              </ul>
              <Link
                href="/daftar"
                className="mt-7 inline-flex w-full items-center justify-center gap-2 bg-[#0F2E1F] hover:bg-[#1a4530] text-white rounded-md px-5 py-3 text-sm font-semibold transition-colors"
              >
                Mulai Trial Gratis
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Akhir */}
      <section className="py-16 bg-[#0F2E1F] text-white">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/10 mb-4">
            <LogoIcon size="md" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold">
            Coba CekTransfer hari ini
          </h2>
          <p className="mt-3 text-white/80 max-w-xl mx-auto">
            Gratis 7 hari. Tidak perlu kartu kredit. Bebas cancel kapan saja
            &mdash; tidak ada pertanyaan.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/daftar"
              className="inline-flex items-center justify-center gap-2 bg-[#10B981] hover:bg-[#0ea571] text-white rounded-md px-6 py-3 text-sm font-semibold transition-colors"
            >
              Daftar Gratis
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/kontak"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white rounded-md px-6 py-3 text-sm font-semibold transition-colors"
            >
              Hubungi Kami
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </>
  );
}

function TrustBadge({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#10B981]/10 text-[#10B981] mx-auto">
        {icon}
      </div>
      <p className="mt-2 text-sm font-semibold text-[#0F2E1F]">{title}</p>
      <p className="text-xs text-slate-500">{children}</p>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 hover:border-[#10B981]/40 hover:shadow-sm transition">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#10B981]/10 text-[#10B981]">
        {icon}
      </div>
      <h3 className="mt-4 font-semibold text-[#0F2E1F]">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{desc}</p>
    </div>
  );
}

function Step({
  num,
  icon,
  title,
  desc,
}: {
  num: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white border-2 border-slate-200 text-[#0F2E1F] relative">
        {icon}
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[#10B981] text-white text-xs font-bold inline-flex items-center justify-center">
          {num}
        </span>
      </div>
      <h3 className="mt-4 font-semibold text-[#0F2E1F]">{title}</h3>
      <p className="mt-1.5 text-sm text-slate-600 leading-relaxed max-w-xs mx-auto">
        {desc}
      </p>
    </div>
  );
}

function PriceFeature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Check className="h-4 w-4 text-[#10B981] mt-0.5 flex-shrink-0" />
      <span>{children}</span>
    </li>
  );
}
