import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Cek Mutasi</h1>
          <p className="mt-1 text-sm text-slate-600">
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
