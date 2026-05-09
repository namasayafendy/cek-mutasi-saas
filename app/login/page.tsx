import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { Logo } from "@/app/logo";

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" aria-label="CekTransfer" className="inline-flex">
            <Logo size="lg" showTld />
          </Link>
          <p className="mt-3 text-sm text-slate-600">
            Login untuk mulai cek mutasi rekening
          </p>
        </div>
        <Suspense fallback={<div className="card p-6 text-center text-sm text-slate-500">Memuat...</div>}>
          <LoginForm />
        </Suspense>
        <p className="mt-4 text-center text-sm text-slate-600">
          Belum punya akun?{" "}
          <Link href="/daftar" className="font-medium text-slate-900 hover:underline">
            Daftar gratis 7 hari
          </Link>
        </p>
      </div>
    </div>
  );
}
