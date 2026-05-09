import Link from "next/link";
import { Logo } from "@/app/logo";
import { Mail, Phone } from "lucide-react";

export function PublicFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-slate-200 bg-[#FAFAF7] mt-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo size="md" showTld />
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Cek mutasi rekening untuk UMKM Indonesia. Cocokkan transferan customer
            dengan mutasi bank dalam hitungan detik.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#0F2E1F] mb-3">Produk</h3>
          <ul className="space-y-2 text-sm text-slate-600">
            <li><Link href="/#fitur" className="hover:text-[#0F2E1F]">Fitur</Link></li>
            <li><Link href="/#harga" className="hover:text-[#0F2E1F]">Harga</Link></li>
            <li><Link href="/faq" className="hover:text-[#0F2E1F]">FAQ</Link></li>
            <li><Link href="/login" className="hover:text-[#0F2E1F]">Login</Link></li>
            <li><Link href="/daftar" className="hover:text-[#0F2E1F]">Daftar Trial</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#0F2E1F] mb-3">Perusahaan</h3>
          <ul className="space-y-2 text-sm text-slate-600">
            <li><Link href="/tentang" className="hover:text-[#0F2E1F]">Tentang Kami</Link></li>
            <li><Link href="/kontak" className="hover:text-[#0F2E1F]">Kontak</Link></li>
            <li><Link href="/privacy" className="hover:text-[#0F2E1F]">Kebijakan Privasi</Link></li>
            <li><Link href="/terms" className="hover:text-[#0F2E1F]">Syarat &amp; Ketentuan</Link></li>
            <li><Link href="/refund" className="hover:text-[#0F2E1F]">Pembatalan &amp; Refund</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#0F2E1F] mb-3">Hubungi Kami</h3>
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <Phone className="h-4 w-4 mt-0.5 text-[#10B981] flex-shrink-0" />
              <a href="https://wa.me/628126540077" className="hover:text-[#0F2E1F]">
                0812-6540-077
              </a>
            </li>
            <li className="flex items-start gap-2">
              <Mail className="h-4 w-4 mt-0.5 text-[#10B981] flex-shrink-0" />
              <a href="mailto:admin@cektransfer.com" className="hover:text-[#0F2E1F]">
                admin@cektransfer.com
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-slate-200">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6 flex flex-col sm:flex-row gap-2 items-center justify-between text-xs text-slate-500">
          <p>&copy; {year} CekTransfer.com. Semua hak dilindungi.</p>
          <p>Made with care in Aceh, Indonesia.</p>
        </div>
      </div>
    </footer>
  );
}
