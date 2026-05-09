import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CekTransfer — Cek Mutasi Rekening Cepat",
  description:
    "Cocokkan transferan customer dengan mutasi rekening dalam hitungan detik. Privacy-first: PDF diproses di browser, tidak pernah di-upload ke server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-900 flex flex-col">
        {children}
      </body>
    </html>
  );
}
