import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cek Mutasi BSI",
  description: "Cocokkan transferan tebusan dengan mutasi rekening BSI",
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
