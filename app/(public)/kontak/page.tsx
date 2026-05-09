import type { Metadata } from "next";
import { Mail, Phone, MessageCircle, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Kontak Kami — CekTransfer",
  description:
    "Hubungi tim CekTransfer untuk pertanyaan, dukungan, atau kerja sama. WhatsApp & email tersedia.",
};

export default function KontakPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 sm:px-6 py-16">
      <h1 className="text-3xl font-bold text-[#0F2E1F]">Hubungi Kami</h1>
      <p className="mt-2 text-slate-600">
        Ada pertanyaan, masalah teknis, atau ingin kerja sama? Tim kami siap
        membantu. Respon biasanya dalam 1&times;24 jam pada hari kerja.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <ContactCard
          icon={<Phone className="h-5 w-5" />}
          title="Telepon &amp; SMS"
          line="0822-7780-2886"
          href="tel:+6282277802886"
          desc="Senin - Sabtu, 09.00 - 18.00 WIB"
        />
        <ContactCard
          icon={<MessageCircle className="h-5 w-5" />}
          title="WhatsApp"
          line="0822-7780-2886"
          href="https://wa.me/6282277802886"
          desc="Klik untuk chat langsung di WhatsApp"
        />
        <ContactCard
          icon={<Mail className="h-5 w-5" />}
          title="Email"
          line="admin@cektransfer.com"
          href="mailto:admin@cektransfer.com"
          desc="Untuk pertanyaan formal, tagihan, atau urusan legal"
        />
        <ContactCard
          icon={<Clock className="h-5 w-5" />}
          title="Jam Operasional"
          line="Senin - Sabtu"
          desc="09.00 - 18.00 WIB. Email di luar jam operasional akan dibalas hari kerja berikutnya."
        />
      </div>

      <div className="mt-12 p-6 bg-[#FAFAF7] border border-slate-200 rounded-xl">
        <h2 className="font-semibold text-[#0F2E1F]">Untuk pertanyaan tertentu</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          <li>
            <strong>Trial &amp; demo:</strong> daftar langsung di{" "}
            <a href="/daftar" className="text-[#10B981] hover:underline">
              halaman daftar
            </a>{" "}
            &mdash; tidak perlu hubungi kami dulu.
          </li>
          <li>
            <strong>Bug atau error teknis:</strong> kirim screenshot ke
            admin@cektransfer.com beserta penjelasan singkat langkah yang
            menyebabkan error.
          </li>
          <li>
            <strong>Permintaan fitur:</strong> WhatsApp atau email kami,
            sertakan use case bisnis Anda.
          </li>
          <li>
            <strong>Pembayaran &amp; tagihan:</strong> hubungi via email untuk
            jejak audit.
          </li>
        </ul>
      </div>

      <p className="mt-12 text-xs text-slate-500">
        CekTransfer.com adalah aplikasi SaaS yang dioperasikan dari Indonesia.
      </p>
    </article>
  );
}

function ContactCard({
  icon,
  title,
  line,
  href,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  line: string;
  href?: string;
  desc: string;
}) {
  const content = (
    <>
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[#10B981]/10 text-[#10B981]">
        {icon}
      </div>
      <h3 className="mt-3 font-semibold text-[#0F2E1F]">{title}</h3>
      <p className="mt-1 text-[#0F2E1F] font-mono">{line}</p>
      <p className="mt-1 text-xs text-slate-500">{desc}</p>
    </>
  );
  return href ? (
    <a
      href={href}
      className="block bg-white border border-slate-200 rounded-xl p-6 hover:border-[#10B981]/40 hover:shadow-sm transition"
    >
      {content}
    </a>
  ) : (
    <div className="bg-white border border-slate-200 rounded-xl p-6">{content}</div>
  );
}
