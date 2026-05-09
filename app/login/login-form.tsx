"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { HCaptcha, resetHcaptcha } from "../hcaptcha";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";
  const reason = searchParams.get("reason");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVerify = useCallback((token: string) => {
    setCaptchaToken(token);
  }, []);
  const handleExpire = useCallback(() => {
    setCaptchaToken(null);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!captchaToken) {
      setError("Selesaikan CAPTCHA dulu.");
      return;
    }
    setLoading(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      // Reset CAPTCHA setelah error — token sudah ke-consume
      resetHcaptcha();
      setCaptchaToken(null);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <div className="card p-6">
      {reason === "idle" && (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
          Sesi Anda berakhir karena tidak ada aktivitas. Silakan login lagi.
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-base mt-1"
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-base mt-1"
            disabled={loading}
          />
          <div className="mt-1 text-right">
            <Link
              href="/lupa-password"
              className="text-xs text-slate-600 hover:text-slate-900"
            >
              Lupa password?
            </Link>
          </div>
        </div>
        <HCaptcha onVerify={handleVerify} onExpire={handleExpire} />
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !captchaToken}
          className="btn-primary w-full"
        >
          {loading ? "Memproses..." : "Login"}
        </button>
      </form>
    </div>
  );
}
