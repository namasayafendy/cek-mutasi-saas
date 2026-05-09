import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tentang Kami — CekTransfer",
  description:
    "CekTransfer adalah aplikasi web untuk membantu UMKM Indonesia mencocokkan transferan customer dengan mutasi rekening bank secara otomatis.",
};

export default function TentangPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-[#0F2E1F]">Tentang CekTransfer</h1>
      <p className="text-slate-500 text-sm mt-1">
        Aplikasi cek mutasi rekening untuk UMKM Indonesia.
      </p>

      <div className="mt-8 space-y-6 text-slate-700 leading-relaxed">
        <p>
          <strong>CekTransfer.com</strong> adalah aplikasi web yang membantu pemilik
          bisnis kecil dan menengah di Indonesia mencocokkan transferan dari
          customer dengan mutasi rekening bank secara otomatis. Aplikasi ini
          dirancang khusus untuk bisnis dengan volume transaksi harian yang
          banyak namun belum punya tim akuntansi penuh waktu &mdash; seperti
          pegadaian, toko retail, kos-kosan, jasa laundry, dan UMKM lainnya.
        </p>

        <h2 className="text-xl font-semibold text-[#0F2E1F] mt-8">
          Cerita di balik aplikasi
        </h2>
        <p>
          Aplikasi ini awalnya dibangun untuk kebutuhan internal sebuah usaha
          pegadaian multi-cabang. Setiap hari, owner harus mencocokkan ratusan
          tebusan customer dengan mutasi rekening bank manual baris per baris
          &mdash; pekerjaan yang memakan waktu berjam-jam dan rawan kesalahan.
        </p>
        <p>
          Setelah satu bulan dipakai internal dan terbukti memangkas waktu
          rekonsiliasi dari 3 jam menjadi kurang dari 5 menit, kami memutuskan
          membuka aplikasi ini sebagai SaaS supaya pemilik bisnis lain di
          Indonesia juga bisa menikmati manfaat yang sama.
        </p>

        <h2 className="text-xl font-semibold text-[#0F2E1F] mt-8">
          Komitmen kami
        </h2>
        <ul className="space-y-2 list-disc pl-5">
          <li>
            <strong>Privacy by design.</strong> File PDF mutasi diproses langsung
            di browser Anda dan tidak pernah di-upload ke server kami. Yang kami
            simpan hanya hasil akhir cocokan, bukan data mutasi mentah.
          </li>
          <li>
            <strong>Sederhana &amp; cepat.</strong> Tidak ada fitur ribet yang
            tidak dipakai. Fokus kami: bantu owner cek mutasi sehari-hari dengan
            cepat.
          </li>
          <li>
            <strong>Harga jujur.</strong> Satu paket flat. Tidak ada tier
            membingungkan, tidak ada biaya tersembunyi.
          </li>
        </ul>

        <h2 className="text-xl font-semibold text-[#0F2E1F] mt-8">
          Informasi Perusahaan
        </h2>
        <p>
          CekTransfer.com adalah layanan SaaS untuk UMKM Indonesia. Untuk pertanyaan
          umum, kerja sama, atau urusan legal, silakan hubungi kami melalui
          halaman{" "}
          <a href="/kontak" className="text-[#10B981] hover:underline">
            Kontak
          </a>.
        </p>
      </div>
    </article>
  );
}
