import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/daftar", "/tos", "/privacy", "/lupa-password"];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true;
  if (path.startsWith("/_next")) return true;
  if (path.startsWith("/favicon")) return true;
  if (path.startsWith("/api/health")) return true;
  return false;
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
    return NextResponse.redirect(url);
  }

  // Logged in user trying to access /login or /daftar → redirect to dashboard
  if (user && (path === "/login" || path === "/daftar")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
