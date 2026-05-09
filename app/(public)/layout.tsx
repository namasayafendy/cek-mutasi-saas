import { PublicHeader } from "@/app/_components/public-header";
import { PublicFooter } from "@/app/_components/public-footer";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main className="bg-white">{children}</main>
      <PublicFooter />
    </>
  );
}
