"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { CheckCircle2, Gift, Loader2, AlertCircle } from "lucide-react";
import { HCaptcha, resetHcaptcha } from "../hcaptcha";
import { redeemReferralCode, validateReferralCode } from "./actions";

export function DaftarForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [referral, setReferral] = useState("");
  const [referralStatus, setReferralStatus] = useState<
    | { state: "idle" }
    | { state: "checking" }
    | { state: "valid"; rewardLabel: string }
    | { state: "invalid"; message: string }
  >({ state: "idle" });
  const [agree, setAgree] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleVerify = useCallback((token: string) => setCaptchaToken(token), []);
  const handleExpire = useCallback(() => setCaptchaToken(null), []);

  async function checkReferral() {
    const code = referral.trim();
    if (!code) {
      setReferralStatus({ state: "idle" });
      return;
    }
    setReferralStatus({ state: "checking" });
    const result = await validateReferralCode(code);
    if (result.ok) {
      setReferralStatus({ state: "valid", rewardLabel: result.rewardLabel });
    } else {
      setReferralStatus({ state: "invalid", message: result.error });
    }
  }

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
    if (referral.trim() && referralStatus.state === "invalid") {
      setError("Kode referral tidak valid. Hapus atau perbaiki dulu.");
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

    // Apply referral code (if any) — call server action.
    // We need account_id which is created by trigger after signup; do it
    // via the active session if user is auto-confirmed, OR defer for manual
    // verify via email (we'll redeem on first login).
    let referralMsg = "";
    if (referral.trim() && data.user && data.session) {
      // Auto-confirmed: account row exists, can redeem now
      // Lookup account_id via team_members
      const { data: tm } = await supabase
        .from("team_members")
        .select("account_id")
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (tm?.account_id) {
        const r = await redeemReferralCode(referral.trim(), data.user.id, tm.account_id);
        referralMsg = r.ok ? ` Kode referral diterapkan: ${r.reward}.` : ` (Kode gagal: ${r.error})`;
      }
    }

    if (data.user && !data.session) {
      // Email confirmation required. Store referral code in URL param so we
      // can apply on first login (defer redemption).
      const referralParam = referral.trim()
        ? `&referral=${encodeURIComponent(referral.trim())}`
        : "";
      // Note: Supabase email link goes to emailRedirectTo. We can't customize it,
      // so we rely on session cookie. For now, just inform user.
      setInfo(
        `Akun dibuat. Cek email ${email} untuk verifikasi sebelum login. ` +
          (referral.trim()
            ? "Kode referral akan diterapkan saat Anda login pertama kali."
            : "Pastikan cek folder spam kalau tidak ketemu."),
      );
      // Stash referral in localStorage so first login can apply it
      if (referral.trim()) {
        try {
          localStorage.setItem("pending_referral", referral.trim());
        } catch {}
      }
      // Make linter happy: referralParam declared but not used (link customization deferred)
      void referralParam;
      setLoading(false);
      return;
    }

    if (data.session) {
      setInfo(`Akun berhasil dibuat.${referralMsg}`);
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

        {/* Referral code (optional) */}
        <div>
          <label htmlFor="referral" className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
            <Gift className="h-3.5 w-3.5 text-[#10B981]" />
            Kode Referral{" "}
            <span className="text-xs text-slate-500 font-normal">(opsional)</span>
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="referral"
              type="text"
              value={referral}
              onChange={(e) => {
                setReferral(e.target.value.toUpperCase());
                setReferralStatus({ state: "idle" });
              }}
              onBlur={checkReferral}
              placeholder="Misal: TEMAN2026"
              className="input-base flex-1 uppercase tracking-wider"
              disabled={loading}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={checkReferral}
              disabled={loading || !referral.trim() || referralStatus.state === "checking"}
              className="text-xs bg-white hover:bg-[#FAFAF7] text-[#0F2E1F] border border-slate-200 rounded-md px-3 py-2 font-medium transition-colors disabled:opacity-50"
            >
              {referralStatus.state === "checking" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Cek"
              )}
            </button>
          </div>
          {referralStatus.state === "valid" && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[#10B981] font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {referralStatus.rewardLabel}
            </div>
          )}
          {referralStatus.state === "invalid" && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-red-700">
              <AlertCircle className="h-3.5 w-3.5" />
              {referralStatus.message}
            </div>
          )}
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
