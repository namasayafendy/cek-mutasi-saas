import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan — CekTransfer",
  description:
    "Syarat dan ketentuan penggunaan layanan CekTransfer.",
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-[#0F2E1F]">Syarat &amp; Ketentuan</h1>
      <p className="text-slate-500 text-sm mt-1">
        Berlaku efektif: 9 Mei 2026
      </p>

      <div className="mt-8 space-y-6 text-slate-700 leading-relaxed">
        <Section title="1. Penerimaan Syarat">
          <p>
            Dengan mendaftar dan/atau menggunakan layanan CekTransfer.com,
            Anda menyatakan telah membaca, memahami, dan menyetujui Syarat
            &amp; Ketentuan ini. Jika Anda tidak menyetujui, mohon untuk
            tidak menggunakan layanan kami.
          </p>
        </Section>

        <Section title="2. Definisi">
          <ul className="space-y-2 list-disc pl-5">
            <li>
              <strong>Layanan:</strong> aplikasi web CekTransfer.com beserta
              semua fitur, konten, dan dokumentasi terkait.
            </li>
            <li>
              <strong>Pengguna:</strong> pemilik akun (owner) maupun staff yang
              di-invite ke akun owner.
            </li>
            <li>
              <strong>Akun:</strong> entitas tenant yang berisi data outlet,
              bank, transaksi, dan staff.
            </li>
            <li>
              <strong>Trial:</strong> masa uji coba gratis 7 (tujuh) hari sejak
              tanggal registrasi pertama.
            </li>
          </ul>
        </Section>

        <Section title="3. Akun Pengguna">
          <ul className="space-y-2 list-disc pl-5">
            <li>
              Anda harus berusia minimal 18 tahun untuk mendaftar.
            </li>
            <li>
              Anda wajib memberikan informasi yang akurat dan
              memperbaruinya jika ada perubahan.
            </li>
            <li>
              Anda bertanggung jawab penuh atas kerahasiaan password dan
              semua aktivitas yang terjadi pada akun Anda.
            </li>
            <li>
              Satu akun hanya boleh digunakan oleh satu entitas bisnis. Tidak
              diperbolehkan menjual, menyewakan, atau membagikan akun ke
              pihak lain di luar tim Anda.
            </li>
            <li>
              Owner dapat menambah hingga 3 (tiga) staff per akun. Tambahan
              staff di luar batas tersebut, jika tersedia, dapat dikenakan
              biaya tambahan.
            </li>
          </ul>
        </Section>

        <Section title="4. Trial dan Langganan">
          <ul className="space-y-2 list-disc pl-5">
            <li>
              Trial gratis berlaku 7 hari sejak tanggal registrasi, tanpa
              kartu kredit.
            </li>
            <li>
              Setelah masa trial berakhir, akun akan otomatis nonaktif.
              Untuk lanjut menggunakan, Anda perlu berlangganan paket
              berbayar.
            </li>
            <li>
              Biaya langganan ditagih bulanan di muka melalui Midtrans.
            </li>
            <li>
              Harga dapat berubah sewaktu-waktu dengan pemberitahuan minimal
              30 hari sebelumnya. Perubahan harga tidak berlaku surut untuk
              periode yang sudah dibayar.
            </li>
            <li>
              Anda dapat membatalkan langganan kapan saja melalui menu
              &quot;Akun &amp; Tagihan&quot; di dalam aplikasi. Pembatalan
              berlaku di akhir periode tagihan berjalan.
            </li>
          </ul>
        </Section>

        <Section title="5. Penggunaan yang Dilarang">
          <p>Anda dilarang:</p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>
              Melanggar hukum yang berlaku, termasuk hukum perlindungan data
              pribadi.
            </li>
            <li>
              Memproses data milik pihak lain tanpa izin yang sah.
            </li>
            <li>
              Mengakses atau mencoba mengakses akun pengguna lain tanpa
              otorisasi.
            </li>
            <li>
              Melakukan reverse engineering, scraping, atau eksfiltrasi data
              dari sistem kami.
            </li>
            <li>
              Mengganggu kestabilan sistem, mis. dengan serangan DDoS, brute
              force, atau injeksi.
            </li>
            <li>
              Menggunakan layanan untuk tujuan ilegal, penipuan, pencucian
              uang, atau mendukung aktivitas yang melanggar hukum.
            </li>
          </ul>
          <p className="mt-3">
            Pelanggaran terhadap pasal ini dapat mengakibatkan suspend atau
            penutupan akun tanpa pengembalian biaya.
          </p>
        </Section>

        <Section title="6. Hak Kekayaan Intelektual">
          <p>
            Semua hak atas aplikasi, kode, desain, logo, dan dokumentasi
            tetap menjadi milik kami. Anda diberikan lisensi terbatas, tidak
            eksklusif, dan tidak dapat dipindahtangankan untuk menggunakan
            layanan sesuai dengan langganan yang aktif.
          </p>
          <p className="mt-3">
            Data yang Anda input (nominal customer, nama outlet, dst) tetap
            menjadi milik Anda. Kami hanya memproses data tersebut untuk
            menjalankan layanan.
          </p>
        </Section>

        <Section title="7. Akurasi Data">
          <p>
            Aplikasi membantu mencocokkan data berdasarkan algoritma yang
            kami buat. Meski kami berupaya keras menjaga akurasi, kami tidak
            menjamin hasil cocokan 100% benar untuk semua kasus. Anda tetap
            bertanggung jawab memverifikasi hasil sebelum mengambil
            keputusan bisnis (mis. melepaskan barang gadai ke customer).
          </p>
        </Section>

        <Section title="8. Penghentian Layanan">
          <p>
            Kami berhak menghentikan atau menangguhkan akses Anda jika:
          </p>
          <ul className="space-y-2 list-disc pl-5 mt-3">
            <li>Anda melanggar Syarat &amp; Ketentuan ini</li>
            <li>Tagihan tidak dibayar setelah jatuh tempo</li>
            <li>Diperintahkan oleh otoritas yang berwenang</li>
            <li>Untuk alasan keamanan sistem</li>
          </ul>
          <p className="mt-3">
            Dalam kasus penghentian karena pelanggaran berat, kami berhak
            tidak mengembalikan biaya yang sudah dibayar.
          </p>
        </Section>

        <Section title="9. Batasan Tanggung Jawab">
          <p>
            Layanan disediakan &quot;sebagaimana adanya&quot; (as-is). Kami
            tidak bertanggung jawab atas kerugian tidak langsung,
            konsekuensial, atau insidental yang timbul akibat penggunaan
            atau ketidakmampuan menggunakan layanan, termasuk tetapi tidak
            terbatas pada kehilangan keuntungan, kehilangan data, atau
            gangguan bisnis.
          </p>
          <p className="mt-3">
            Total tanggung jawab kami atas klaim apa pun terkait layanan
            ini, dalam kondisi apa pun, tidak akan melebihi total biaya
            langganan yang Anda bayarkan dalam 12 bulan terakhir.
          </p>
        </Section>

        <Section title="10. Force Majeure">
          <p>
            Kami tidak bertanggung jawab atas kegagalan atau keterlambatan
            layanan yang disebabkan oleh keadaan di luar kendali wajar
            kami, termasuk bencana alam, perang, pandemi, gangguan internet
            massal, gangguan dari penyedia infrastruktur (Vercel, Supabase,
            dll), atau tindakan pemerintah.
          </p>
        </Section>

        <Section title="11. Perubahan Syarat">
          <p>
            Kami dapat memperbarui Syarat &amp; Ketentuan ini sewaktu-waktu.
            Perubahan signifikan akan diberitahukan melalui email atau
            pemberitahuan dalam aplikasi. Penggunaan layanan setelah
            tanggal efektif perubahan dianggap sebagai persetujuan terhadap
            syarat baru.
          </p>
        </Section>

        <Section title="12. Hukum yang Berlaku">
          <p>
            Syarat &amp; Ketentuan ini tunduk pada hukum Republik Indonesia.
            Setiap sengketa yang tidak dapat diselesaikan secara musyawarah
            akan diselesaikan melalui jalur hukum yang berlaku di
            Indonesia.
          </p>
        </Section>

        <Section title="13. Kontak">
          <p>
            Pertanyaan terkait Syarat &amp; Ketentuan ini dapat dikirim ke{" "}
            <a href="mailto:admin@cektransfer.com" className="text-[#10B981] hover:underline">
              admin@cektransfer.com
            </a>{" "}
            atau via WhatsApp 0812-6540-077.
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
