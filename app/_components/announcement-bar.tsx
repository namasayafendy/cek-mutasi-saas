import { ShieldCheck } from "lucide-react";

export function AnnouncementBar() {
  return (
    <div className="bg-[#0F2E1F] text-white text-xs sm:text-sm">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-2 flex items-center justify-center gap-2 text-center">
        <ShieldCheck className="h-4 w-4 text-[#10B981] flex-shrink-0" />
        <span>
          <strong>100% aman:</strong> tanpa perlu serahkan{" "}
          <span className="underline decoration-[#10B981] decoration-2 underline-offset-2">
            username &amp; password banking
          </span>{" "}
          Anda
        </span>
      </div>
    </div>
  );
}
