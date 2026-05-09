import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pembatalan & Refund — CekTransfer",
  description: "Kebijakan pembatalan langganan dan pengembalian dana CekTransfer.",
};

export default function RefundPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-[#0F2E1F]">Pembatalan &amp; Refund</h1>
      <p className="text-slate-500 text-sm mt-1">
        Berlaku efektif: 9 Mei 2026
      </p>

      <div className="mt-8 space-y-6 text-slate-700 leading-relaxed">
        <Section title="Ringkasan">
          <p>
            Kami percaya pada transparansi. Berikut ringkasan singkat kebijakan
            kami:
          </p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>Trial 7 hari gratis &mdash; tanpa kartu kredit</li>
            <li>Bisa cancel kapan saja, langganan berakhir di akhir periode</li>
            <li>
              Pembayaran yang sudah masuk untuk periode aktif <strong>tidak
              dikembalikan</strong>, kecuali ada kasus khusus (lihat di bawah)
            </li>
          </ul>
        </Section>

        <Section title="1. Pembatalan Trial">
          <p>
            Trial berlaku 7 hari sejak registrasi. Jika Anda tidak ingin
            melanjutkan, cukup biarkan akun nonaktif &mdash; tidak ada penagihan
            otomatis. Tidak ada kartu kredit yang Anda input selama trial,
            sehingga tidak ada biaya yang akan ditarik.
          </p>
        </Section>

        <Section title="2. Pembatalan Langganan Berbayar">
          <p>
            Anda dapat membatalkan langganan kapan saja melalui menu{" "}
            <strong>Akun &amp; Tagihan</strong> di dalam aplikasi. Setelah
            pembatalan:
          </p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>
              Akses penuh tetap tersedia hingga akhir periode tagihan yang sudah
              dibayar.
            </li>
            <li>
              Tidak ada penagihan otomatis untuk periode berikutnya.
            </li>
            <li>
              Anda dapat mengaktifkan kembali kapan saja sebelum periode
              berakhir tanpa kehilangan data.
            </li>
            <li>
              Setelah periode berakhir, akun masuk mode read-only selama 30
              hari sebelum data di-arsipkan.
            </li>
          </ul>
        </Section>

        <Section title="3. Kebijakan Pengembalian Dana (Refund)">
          <p>
            Sebagai layanan SaaS bulanan, kami umumnya tidak memberikan
            pengembalian dana untuk periode yang sudah berjalan. Namun kami
            akan mempertimbangkan pengembalian dana penuh atau sebagian dalam
            kasus berikut:
          </p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>
              <strong>Pembayaran ganda:</strong> jika Anda terkena charge dua
              kali untuk periode yang sama, kami akan refund 100% atas
              kelebihan tersebut.
            </li>
            <li>
              <strong>Layanan tidak dapat diakses dalam waktu lama:</strong>{" "}
              jika layanan kami down lebih dari 72 jam berturut-turut karena
              masalah dari pihak kami, Anda berhak meminta refund prorata atas
              periode yang terkena gangguan.
            </li>
            <li>
              <strong>Salah charge:</strong> jika Midtrans memproses tagihan
              setelah Anda membatalkan langganan, kami akan refund 100%.
            </li>
          </ul>
        </Section>

        <Section title="4. Yang TIDAK Termasuk Refund">
          <p>Kami tidak memberikan refund dalam kondisi berikut:</p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>
              Anda berubah pikiran atau tidak jadi membutuhkan layanan setelah
              pembayaran berhasil.
            </li>
            <li>
              Anda jarang menggunakan atau tidak login selama periode aktif.
            </li>
            <li>
              Anda tidak puas dengan fitur tertentu (silakan sampaikan feedback
              ke kami sebelum berlangganan).
            </li>
            <li>
              Akun di-suspend karena melanggar Syarat &amp; Ketentuan.
            </li>
            <li>
              Gangguan singkat (di bawah 72 jam) yang merupakan bagian normal
              dari operasional layanan.
            </li>
          </ul>
        </Section>

        <Section title="5. Cara Mengajukan Refund">
          <p>
            Untuk mengajukan refund yang memenuhi kriteria di atas:
          </p>
          <ol className="space-y-2 list-decimal pl-5 mt-3">
            <li>
              Kirim email ke{" "}
              <a href="mailto:admin@cektransfer.com" className="text-[#10B981] hover:underline">
                admin@cektransfer.com
              </a>{" "}
              dengan subjek &quot;Permintaan Refund&quot;.
            </li>
            <li>
              Sertakan: alamat email akun, tanggal pembayaran, jumlah, dan
              alasan refund.
            </li>
            <li>
              Lampirkan bukti yang relevan (mis. screenshot tagihan ganda).
            </li>
          </ol>
          <p className="mt-3">
            Kami akan merespon dalam 2 hari kerja. Refund yang disetujui akan
            diproses melalui Midtrans dalam 7-14 hari kerja, ke metode
            pembayaran asli yang Anda gunakan.
          </p>
        </Section>

        <Section title="6. Kontak">
          <p>
            Pertanyaan tentang kebijakan ini dapat dikirim ke{" "}
            <a href="mailto:admin@cektransfer.com" className="text-[#10B981] hover:underline">
              admin@cektransfer.com
            </a>{" "}
            atau WhatsApp 0822-7780-2886.
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
