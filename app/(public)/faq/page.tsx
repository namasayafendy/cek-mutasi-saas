import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "FAQ — CekTransfer",
  description: "Pertanyaan yang sering diajukan tentang CekTransfer.",
};

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Apa itu CekTransfer?",
    a: (
      <p>
        CekTransfer adalah aplikasi web yang membantu UMKM Indonesia
        mencocokkan transferan customer dengan mutasi rekening bank secara
        otomatis. Daripada cek manual baris per baris di mobile banking, Anda
        upload PDF mutasi sekali, sistem cocokkan otomatis dengan input
        nominal customer Anda.
      </p>
    ),
  },
  {
    q: "Apakah PDF mutasi saya aman? Apakah di-upload ke server?",
    a: (
      <p>
        <strong>Tidak.</strong> File PDF mutasi diproses langsung di browser
        Anda menggunakan teknologi client-side parsing. Server kami hanya
        menyimpan hasil akhir berupa metadata transaksi (tanggal, nominal,
        deskripsi singkat), bukan file PDF aslinya. Privacy-by-design adalah
        prinsip utama kami.
      </p>
    ),
  },
  {
    q: "Bank apa saja yang didukung?",
    a: (
      <>
        <p>Saat ini kami support format mutasi dari:</p>
        <ul className="list-disc pl-5 mt-2">
          <li>BSI (BSINet, BYOND)</li>
          <li>BCA (e-Statement, KlikBCA HTML)</li>
          <li>BNI</li>
          <li>Mandiri</li>
          <li>e-wallet seperti DANA (treated as bank)</li>
        </ul>
        <p className="mt-2">
          Bank lain akan ditambahkan secara berkala. Kalau bank Anda belum
          didukung, kontak kami &mdash; kami bisa pertimbangkan menambahkan.
        </p>
      </>
    ),
  },
  {
    q: "Bagaimana cara kerja matching-nya?",
    a: (
      <p>
        Anda input nominal yang Anda harapkan dari customer (misal Rp 250.000
        dari Bu Sari, tanggal 8 Mei). Sistem akan cari transaksi mutasi yang
        match dengan nominal + tanggal tersebut. Aturan matching bisa Anda
        atur sendiri (mis. toleransi tanggal H-1/H+1, allow nominal exact-only
        atau range, dst).
      </p>
    ),
  },
  {
    q: "Bisa berapa staff per akun?",
    a: (
      <p>
        Saat ini 3 staff per akun. Owner bisa tambahkan staff via menu Staff,
        dan staff hanya punya akses ke fitur Cek Mutasi (tidak bisa lihat
        history rekap, atur outlet, dll).
      </p>
    ),
  },
  {
    q: "Bisnis multi-cabang, gimana?",
    a: (
      <p>
        Bisa. Tambah outlet di menu Outlet, lalu saat input nominal customer,
        pilih outlet-nya. Hasil cocokan, history, dan rekap PDF otomatis
        terpisah per outlet sehingga laporan ke masing-masing kepala cabang
        bersih.
      </p>
    ),
  },
  {
    q: "Bagaimana sistem membedakan transfer customer vs bunga bank vs biaya admin?",
    a: (
      <p>
        Sistem otomatis cocokkan ke input customer. Kalau ada transaksi
        mutasi yang tidak match (misal bunga bank, biaya admin, atau transfer
        pribadi), Anda bisa tandai manual via fitur &quot;Claim Manual&quot;
        dengan kategori (bunga / admin / lain) supaya tetap masuk hitungan
        rekap dengan benar.
      </p>
    ),
  },
  {
    q: "Trial-nya berapa lama? Perlu kartu kredit?",
    a: (
      <p>
        Trial 7 hari gratis, <strong>tanpa kartu kredit</strong>. Setelah
        trial habis, akun otomatis nonaktif. Anda baru perlu input metode
        pembayaran kalau memutuskan untuk berlangganan.
      </p>
    ),
  },
  {
    q: "Berapa harga setelah trial?",
    a: (
      <p>
        Rp 99.000/bulan flat (sudah termasuk PPN). Semua fitur include
        &mdash; tidak ada multi-tier. Sampai 3 staff, multi-outlet,
        multi-bank, history, rekap PDF, manual claim, semuanya satu paket.
      </p>
    ),
  },
  {
    q: "Bagaimana cara pembayarannya?",
    a: (
      <p>
        Pembayaran diproses oleh Midtrans, payment gateway resmi di Indonesia.
        Mendukung transfer bank, virtual account, e-wallet (GoPay, OVO, DANA,
        ShopeePay), QRIS, dan kartu kredit. Tagihan otomatis tiap bulan, bisa
        cancel kapan saja.
      </p>
    ),
  },
  {
    q: "Bisa cancel kapan saja?",
    a: (
      <p>
        Bisa. Cancel via menu Akun &amp; Tagihan. Akses tetap aktif sampai
        akhir periode tagihan yang sudah dibayar, setelah itu akun nonaktif.
        Tidak ada fee pembatalan, tidak ada pertanyaan.
      </p>
    ),
  },
  {
    q: "Data saya hilang kalau cancel?",
    a: (
      <p>
        Tidak hilang seketika. Setelah langganan berakhir, akun masuk mode
        read-only selama 30 hari &mdash; Anda masih bisa lihat dan export
        history. Setelah 30 hari, data di-arsip. Kalau Anda re-aktivasi
        sebelum 30 hari, semua data utuh.
      </p>
    ),
  },
  {
    q: "Apakah hasil match dijamin 100% akurat?",
    a: (
      <p>
        Kami berusaha keras menjaga akurasi, tapi tidak menjamin 100% benar
        untuk semua kasus (mis. nominal sama persis dari 2 customer berbeda
        di tanggal sama). Untuk keputusan bisnis kritis seperti melepas barang
        gadai, tetap verifikasi sendiri sebelum eksekusi.
      </p>
    ),
  },
  {
    q: "Bagaimana cara minta bantuan?",
    a: (
      <p>
        WhatsApp 0822-7780-2886 atau email{" "}
        <a href="mailto:admin@cektransfer.com" className="text-[#10B981] hover:underline">
          admin@cektransfer.com
        </a>
        . Kami biasanya respon dalam 1&times;24 jam pada hari kerja.
      </p>
    ),
  },
];

export default function FaqPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-[#0F2E1F]">
        Pertanyaan yang Sering Diajukan
      </h1>
      <p className="mt-2 text-slate-600">
        Tidak menemukan jawaban di sini?{" "}
        <Link href="/kontak" className="text-[#10B981] hover:underline">
          Hubungi kami
        </Link>
        .
      </p>

      <div className="mt-10 space-y-4">
        {FAQS.map((item, i) => (
          <details
            key={i}
            className="group bg-white border border-slate-200 rounded-xl p-5 open:border-[#10B981]/40 open:shadow-sm transition"
          >
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <h2 className="font-semibold text-[#0F2E1F] pr-4">{item.q}</h2>
              <span className="text-[#10B981] text-xl group-open:rotate-45 transition-transform">
                +
              </span>
            </summary>
            <div className="mt-3 text-slate-700 leading-relaxed text-sm">
              {item.a}
            </div>
          </details>
        ))}
      </div>

      <div className="mt-12 p-6 bg-[#FAFAF7] border border-slate-200 rounded-xl text-center">
        <p className="text-sm text-slate-700">
          Masih ragu? Coba dulu, gratis 7 hari, tanpa kartu kredit.
        </p>
        <Link
          href="/daftar"
          className="mt-4 inline-flex items-center justify-center bg-[#0F2E1F] hover:bg-[#1a4530] text-white rounded-md px-6 py-2.5 text-sm font-semibold transition-colors"
        >
          Daftar Trial Gratis
        </Link>
      </div>
    </article>
  );
}
