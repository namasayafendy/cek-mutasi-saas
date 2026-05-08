import { Suspense } from "react";
import SetPasswordForm from "./form";

export default function SetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md card p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Set Password</h1>
          <p className="mt-1 text-sm text-slate-600">
            Anda di-invite ke aplikasi Cek Mutasi. Set password untuk login pertama kali.
          </p>
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Memuat…</p>}>
          <SetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
