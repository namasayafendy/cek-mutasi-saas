"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { HCaptcha, resetHcaptcha } from "../hcaptcha";

export function DaftarForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleVerify = useCallback((token: string) => setCaptchaToken(token), []);
  const handleExpire = useCallback(() => setCaptchaToken(null), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!agree) {
      setError("Anda harus menyetujui Syarat Layanan dan Kebijakan Privasi");
      return;
    }
    if (password.length < 8) {
      setError("Password minimal 8 karakter");
      return;
    }
    if (password !== confirmPassword) {
      setError("Konfirmasi password tidak sama");
      return;
    }
    if (!captchaToken) {
      setError("Selesaikan CAPTCHA dulu.");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        captchaToken,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      resetHcaptcha();
      setCaptchaToken(null);
      return;
    }

    // Trigger auto-bikin account + team_member + settings via Postgres trigger.
    // Owner bisa set brand_name nanti dari menu Akun kalau mau.
    if (data.user && !data.session) {
      setInfo(
        `Akun dibuat. Cek email ${email} untuk verifikasi sebelum login. ` +
          `Pastikan cek folder spam kalau tidak ketemu.`,
      );
      setLoading(false);
      return;
    }

    if (data.session) {
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    setLoading(false);
  }

  return (
    <div className="card p-6">
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
            className="input-base mt-1"
            disabled={loading}
          />
        </div>
        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700">
            Konfirmasi Password
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-base mt-1"
            disabled={loading}
          />
        </div>
        <div className="flex items-start gap-2">
          <input
            id="agree"
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-1"
            disabled={loading}
          />
          <label htmlFor="agree" className="text-xs text-slate-600">
            Saya setuju dengan{" "}
            <Link href="/terms" className="text-slate-900 hover:underline">
              Syarat Layanan
            </Link>{" "}
            dan{" "}
            <Link href="/privacy" className="text-slate-900 hover:underline">
              Kebijakan Privasi
            </Link>
          </label>
        </div>
        <HCaptcha onVerify={handleVerify} onExpire={handleExpire} />
        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {info && (
          <div className="rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-700">
            {info}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !captchaToken}
          className="btn-primary w-full"
        >
          {loading ? "Memproses..." : "Daftar — Mulai Trial 7 Hari"}
        </button>
      </form>
    </div>
  );
}
