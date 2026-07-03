import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
  // Marketing / landing
  "/",
  "/tentang",
  "/kontak",
  "/faq",
  // Legal
  "/privacy",
  "/terms",
  "/tos", // legacy alias
  "/refund",
  // Auth flows
  "/login",
  "/daftar",
  "/lupa-password",
  "/set-password",
];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true;
  if (path.startsWith("/_next")) return true;
  if (path.startsWith("/favicon")) return true;
  if (path.startsWith("/api/health")) return true;
  // Server-to-server internal API (AI Hub) — auth sendiri via x-internal-secret
  // di route-nya (fail-closed), jangan di-redirect ke /login.
  if (path.startsWith("/api/internal/")) return true;
  return false;
}

/**
 * Phase 8.6: security headers — CSP + HSTS + X-Frame-Options dll.
 * CSP-nya cukup permissive untuk pdfjs (worker blob), Tailwind (inline style),
 * Supabase (connect-src wss/https), Google Fonts dll.
 */
function applySecurityHeaders(res: NextResponse) {
  // Content-Security-Policy
  const csp = [
    "default-src 'self'",
    // Script: Next.js inline + jsdelivr (pdfjs worker) + hCaptcha
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.hcaptcha.com https://hcaptcha.com",
    // Style: Tailwind inline + hCaptcha
    "style-src 'self' 'unsafe-inline' https://*.hcaptcha.com https://hcaptcha.com",
    // Image: data + blob untuk PDF render
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Supabase WebSocket + REST + Auth + hCaptcha API
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://*.hcaptcha.com https://hcaptcha.com",
    // pdfjs Web Worker pakai blob URL
    "worker-src 'self' blob:",
    // hCaptcha widget render via iframe
    "frame-src https://*.hcaptcha.com https://hcaptcha.com",
    "object-src 'none'",
    // Form action: only same origin
    "form-action 'self'",
    // base-uri restrict
    "base-uri 'self'",
    // Prevent clickjacking via frame-ancestors
    "frame-ancestors 'none'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  // Klasik clickjacking protection (legacy browser fallback)
  res.headers.set("X-Frame-Options", "DENY");
  // Stop MIME sniffing
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Referrer minimal supaya tidak bocor URL ke 3rd-party
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Strict transport security: force HTTPS for 6 bulan
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=15552000; includeSubDomains",
  );
  // Permission policy: nonaktifkan akses sensor yang tidak dipakai
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    const redirectRes = NextResponse.redirect(url);
    applySecurityHeaders(redirectRes);
    return redirectRes;
  }

  // Logged-in user landing on /login or /daftar → redirect to dashboard.
  // Note: "/" is now a public landing page; it has its own server-side
  // redirect-when-logged-in inside app/page.tsx, so we don't force it here.
  if (user && (path === "/login" || path === "/daftar")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.delete("next");
    const redirectRes = NextResponse.redirect(url);
    applySecurityHeaders(redirectRes);
    return redirectRes;
  }

  applySecurityHeaders(supabaseResponse);
  return supabaseResponse;
}
