import { Suspense } from "react";
import Link from "next/link";
import { DaftarForm } from "./daftar-form";
import { Logo } from "@/app/logo";

export default function DaftarPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" aria-label="CekTransfer" className="inline-flex">
            <Logo size="lg" showTld />
          </Link>
          <h1 className="mt-3 text-xl font-semibold text-slate-900">
            Daftar — Trial 7 Hari Gratis
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Tanpa kartu kredit. Bebas cancel kapan saja.
          </p>
        </div>
        <Suspense fallback={<div className="card p-6 text-center text-sm text-slate-500">Memuat...</div>}>
          <DaftarForm />
        </Suspense>
        <p className="mt-4 text-center text-sm text-slate-600">
          Sudah punya akun?{" "}
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            Login
          </Link>
        </p>
      </div>
    </div>
  );
}
