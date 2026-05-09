import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kebijakan Privasi — CekTransfer",
  description:
    "Kebijakan privasi CekTransfer: bagaimana kami mengumpulkan, menggunakan, dan melindungi data pengguna.",
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-[#0F2E1F]">Kebijakan Privasi</h1>
      <p className="text-slate-500 text-sm mt-1">
        Berlaku efektif: 9 Mei 2026
      </p>

      <div className="mt-8 space-y-6 text-slate-700 leading-relaxed">
        <Section title="1. Pendahuluan">
          <p>
            Kebijakan Privasi ini menjelaskan bagaimana CekTransfer.com
            (&quot;kami&quot;) mengumpulkan, menggunakan, menyimpan, dan
            melindungi informasi pribadi Anda saat menggunakan aplikasi web kami.
            Dengan menggunakan aplikasi ini, Anda menyetujui praktik yang
            dijelaskan di bawah.
          </p>
        </Section>

        <Section title="2. Data yang Kami Kumpulkan">
          <p>Kami mengumpulkan informasi berikut:</p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>
              <strong>Data akun:</strong> nama, alamat email, password (di-hash),
              nama bisnis, informasi kontak.
            </li>
            <li>
              <strong>Data operasional:</strong> nominal transfer, tanggal,
              outlet/cabang, nama bank, hasil cocokan transaksi. Data ini hanya
              berisi metadata, bukan PDF mutasi mentah.
            </li>
            <li>
              <strong>Data teknis:</strong> alamat IP, jenis browser, log akses
              untuk keperluan keamanan dan pencegahan penyalahgunaan.
            </li>
            <li>
              <strong>Data pembayaran:</strong> diproses oleh penyedia pembayaran
              pihak ketiga (Midtrans). Kami tidak menyimpan nomor kartu kredit
              atau detail rekening Anda.
            </li>
          </ul>
        </Section>

        <Section title="3. Apa yang TIDAK Kami Kumpulkan">
          <p className="font-semibold">
            File PDF mutasi rekening Anda TIDAK pernah di-upload ke server kami.
          </p>
          <p className="mt-3">
            Aplikasi memproses PDF mutasi langsung di browser Anda
            (client-side). Setelah parsing selesai, hanya hasil akhir berupa
            metadata transaksi (tanggal, nominal, deskripsi singkat) yang
            disimpan di database kami untuk keperluan cocokan dan history.
            Konten PDF asli tidak pernah meninggalkan perangkat Anda.
          </p>
        </Section>

        <Section title="4. Bagaimana Kami Menggunakan Data">
          <ul className="space-y-2 list-disc pl-5">
            <li>Memberikan layanan cek mutasi (cocokan, history, rekap)</li>
            <li>Memproses pembayaran langganan</li>
            <li>Mengirim notifikasi terkait akun (mis. trial habis, invoice)</li>
            <li>Meningkatkan keamanan dan mendeteksi penyalahgunaan</li>
            <li>Memberikan support pelanggan saat Anda menghubungi kami</li>
            <li>
              Memenuhi kewajiban hukum (mis. permintaan data dari otoritas yang
              berwenang)
            </li>
          </ul>
        </Section>

        <Section title="5. Berbagi Data dengan Pihak Ketiga">
          <p>
            Kami tidak menjual data Anda. Kami hanya berbagi data terbatas
            dengan penyedia layanan berikut, dan hanya seperlunya:
          </p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>
              <strong>Supabase</strong> &mdash; sebagai penyedia database dan
              autentikasi.
            </li>
            <li>
              <strong>Vercel</strong> &mdash; sebagai penyedia hosting aplikasi.
            </li>
            <li>
              <strong>Midtrans</strong> &mdash; sebagai payment gateway untuk
              memproses pembayaran langganan.
            </li>
            <li>
              <strong>hCaptcha</strong> &mdash; untuk verifikasi anti-bot saat
              login dan registrasi.
            </li>
          </ul>
          <p className="mt-3">
            Semua penyedia di atas terikat kewajiban kerahasiaan dan
            menggunakan data hanya untuk menjalankan layanan kepada kami.
          </p>
        </Section>

        <Section title="6. Keamanan Data">
          <p>
            Kami menerapkan langkah keamanan teknis dan organisasional yang
            wajar untuk melindungi data Anda, termasuk:
          </p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>Enkripsi data saat transit (HTTPS/TLS)</li>
            <li>Password di-hash menggunakan algoritma yang aman</li>
            <li>Row-Level Security (RLS) untuk memisahkan data antar akun</li>
            <li>Auto-logout setelah 1 jam tidak aktif</li>
            <li>Pembatasan akses internal hanya untuk personel berwenang</li>
          </ul>
          <p className="mt-3">
            Meski demikian, tidak ada sistem yang 100% aman. Kami menganjurkan
            Anda menjaga kerahasiaan password dan tidak membagikan akun ke
            pihak yang tidak berwenang.
          </p>
        </Section>

        <Section title="7. Penyimpanan Data">
          <p>
            Data akun dan operasional disimpan selama akun Anda aktif. Jika
            Anda menutup akun, kami akan menghapus atau menganonimkan data
            Anda dalam waktu wajar, kecuali kami diwajibkan menyimpannya untuk
            kepentingan hukum, pajak, atau audit.
          </p>
        </Section>

        <Section title="8. Hak Anda">
          <p>Anda memiliki hak untuk:</p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>Mengakses dan memperbarui data akun Anda kapan saja</li>
            <li>Mengekspor data operasional dalam format PDF</li>
            <li>Meminta penghapusan akun dan data Anda</li>
            <li>
              Mengajukan pertanyaan atau keluhan terkait pemrosesan data
            </li>
          </ul>
          <p className="mt-3">
            Untuk eksekusi hak ini, hubungi kami di{" "}
            <a href="mailto:admin@cektransfer.com" className="text-[#10B981] hover:underline">
              admin@cektransfer.com
            </a>.
          </p>
        </Section>

        <Section title="9. Cookies">
          <p>
            Kami menggunakan cookies seperlunya untuk menjaga sesi login dan
            preferensi Anda. Kami tidak menggunakan cookies pelacak iklan
            pihak ketiga.
          </p>
        </Section>

        <Section title="10. Anak di Bawah Umur">
          <p>
            Layanan kami tidak ditujukan untuk anak di bawah usia 18 tahun.
            Kami tidak dengan sengaja mengumpulkan data dari anak di bawah
            umur. Jika Anda mengetahui ada data anak di bawah umur yang masuk
            ke sistem kami, segera hubungi kami untuk dihapus.
          </p>
        </Section>

        <Section title="11. Perubahan Kebijakan">
          <p>
            Kami dapat memperbarui Kebijakan Privasi ini sewaktu-waktu.
            Perubahan signifikan akan diberitahukan melalui email atau
            pemberitahuan dalam aplikasi. Tanggal &quot;Berlaku efektif&quot;
            di atas akan diperbarui sesuai dengan versi terbaru.
          </p>
        </Section>

        <Section title="12. Kontak">
          <p>
            Pertanyaan terkait Kebijakan Privasi ini dapat dikirim ke{" "}
            <a href="mailto:admin@cektransfer.com" className="text-[#10B981] hover:underline">
              admin@cektransfer.com
            </a>{" "}
            atau via WhatsApp 0822-7780-2886.
          </p>
        </Section>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-[#0F2E1F] mt-2 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
