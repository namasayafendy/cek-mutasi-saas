import Link from "next/link";
import { LogoIcon, LogoWordmark } from "@/app/logo";
import { AnnouncementBar } from "@/app/_components/announcement-bar";

export function PublicHeader() {
  return (
    <div className="sticky top-0 z-30">
      <AnnouncementBar />
      <header className="bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" aria-label="CekTransfer" className="inline-flex items-center gap-2">
            <LogoIcon size="md" />
            <LogoWordmark size="md" showTld={false} />
          </Link>
          <nav className="hidden sm:flex items-center gap-5 text-sm text-slate-600">
            <Link href="/#fitur" className="hover:text-[#0F2E1F]">Fitur</Link>
            <Link href="/#cara-kerja" className="hover:text-[#0F2E1F]">Cara Kerja</Link>
            <Link href="/#harga" className="hover:text-[#0F2E1F]">Harga</Link>
            <Link href="/faq" className="hover:text-[#0F2E1F]">FAQ</Link>
            <Link href="/kontak" className="hover:text-[#0F2E1F]">Kontak</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="text-sm text-slate-700 hover:text-[#0F2E1F] px-3 py-1.5"
            >
              Login
            </Link>
            <Link
              href="/daftar"
              className="text-sm font-medium bg-[#0F2E1F] hover:bg-[#1a4530] text-white rounded-md px-3 py-1.5 transition-colors"
            >
              Coba Gratis
            </Link>
          </div>
        </div>
      </header>
    </div>
  );
}
