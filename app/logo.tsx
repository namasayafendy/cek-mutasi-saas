// CekTransfer brand — Konsep 03 "Temu" (kaca pembesar + centang hijau).
// Variants: icon-only / wordmark / full (icon + wordmark).

type LogoSize = "sm" | "md" | "lg" | "xl";

const ICON_PIXELS: Record<LogoSize, number> = {
  sm: 20,
  md: 28,
  lg: 40,
  xl: 64,
};

const WORDMARK_PIXELS: Record<LogoSize, number> = {
  sm: 14,
  md: 18,
  lg: 24,
  xl: 36,
};

export function LogoIcon({
  size = "md",
  className,
}: {
  size?: LogoSize;
  className?: string;
}) {
  const px = ICON_PIXELS[size];
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="CekTransfer logo"
    >
      <rect x="0" y="0" width="200" height="200" rx="44" fill="#FAFAF7" />
      {/* Magnifier handle */}
      <path
        d="M 134 134 L 168 168"
        stroke="#0F2E1F"
        strokeWidth="18"
        strokeLinecap="round"
      />
      {/* Lens outer ring */}
      <circle cx="86" cy="86" r="52" stroke="#0F2E1F" strokeWidth="14" fill="white" />
      {/* Checkmark inside lens */}
      <path
        d="M 62 88 L 80 106 L 112 70"
        stroke="#10B981"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function LogoWordmark({
  size = "md",
  showTld = true,
  className,
}: {
  size?: LogoSize;
  showTld?: boolean;
  className?: string;
}) {
  const px = WORDMARK_PIXELS[size];
  const tldPx = Math.max(10, Math.round(px * 0.5));
  return (
    <span
      className={`inline-flex items-baseline ${className ?? ""}`}
      style={{ fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1 }}
    >
      <span style={{ color: "#10B981", fontSize: `${px}px` }}>cek</span>
      <span style={{ color: "#0F2E1F", fontSize: `${px}px` }}>transfer</span>
      {showTld && (
        <span
          style={{
            color: "#0F2E1F",
            fontSize: `${tldPx}px`,
            fontWeight: 500,
            opacity: 0.55,
            marginLeft: "2px",
          }}
        >
          .com
        </span>
      )}
    </span>
  );
}

/**
 * Logo lengkap: icon + wordmark side by side.
 * Default: medium size, dengan .com.
 */
export function Logo({
  size = "md",
  showTld = true,
  showWordmark = true,
  className,
}: {
  size?: LogoSize;
  showTld?: boolean;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoIcon size={size} />
      {showWordmark && <LogoWordmark size={size} showTld={showTld} />}
    </span>
  );
}
