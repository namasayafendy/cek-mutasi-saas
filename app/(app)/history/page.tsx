import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccountContext } from "@/lib/supabase/context";
import { createClient } from "@/lib/supabase/server";
import { formatDateLong, parseDateISO, formatRupiah } from "@/lib/format";
import { ArrowDown, ArrowUp, Eye, History as HistoryIcon } from "lucide-react";

type SessionRow = {
  id: string;
  user_id: string;
  jenis: "kredit" | "debet";
  period_mutasi_start: string | null;
  period_mutasi_end: string | null;
  total_input: number;
  total_matched: number;
  total_unmatched: number;
  total_conflict: number;
  total_nominal_input: number;
  total_nominal_matched: number;
  created_at: string;
};

export default async function HistoryPage() {
  const ctx = await getAccountContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const { data: sessions, error } = await supabase
    .from("cek_sessions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="card p-5 border-red-200 bg-red-50 text-red-800 text-sm">
        Gagal memuat history: {error.message}
      </div>
    );
  }

  const rows = (sessions ?? []) as SessionRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">History Cek Mutasi</h1>
        <p className="mt-1 text-sm text-slate-600">
          Riwayat semua sesi cek mutasi (kredit + debet). Maksimal 100 sesi terbaru.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <HistoryIcon className="h-10 w-10 mx-auto text-slate-400" />
          <h2 className="mt-3 font-medium text-slate-900">Belum ada history</h2>
          <p className="mt-1 text-sm text-slate-600">
            Setelah Anda selesai cek mutasi dan download hasilnya, sesi-nya akan muncul di sini.
          </p>
          <Link href="/check" className="btn-primary mt-3">
            Mulai Cek Mutasi
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Tgl Cek
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Jenis
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase text-slate-500">
                  Periode Mutasi
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Input
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Tidak Match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Total Match
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase text-slate-500">
                  Aksi
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((s) => {
                const created = new Date(s.created_at);
                const periodStart = s.period_mutasi_start
                  ? parseDateISO(s.period_mutasi_start)
                  : null;
                const periodEnd = s.period_mutasi_end
                  ? parseDateISO(s.period_mutasi_end)
                  : null;
                const isOwn = s.user_id === ctx.user.id;
                return (
                  <tr key={s.id} className={isOwn ? "" : "bg-slate-50/50"}>
                    <td className="px-4 py-2 text-slate-700">
                      {formatDateLong(created)}
                      <div className="text-xs text-slate-500">
                        {created.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {s.jenis === "kredit" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          <ArrowDown className="h-3 w-3" /> Kredit
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          <ArrowUp className="h-3 w-3" /> Debet
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {periodStart && periodEnd
                        ? `${periodStart.getUTCDate()}/${periodStart.getUTCMonth() + 1} – ${periodEnd.getUTCDate()}/${periodEnd.getUTCMonth() + 1}/${periodEnd.getUTCFullYear()}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{s.total_input}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-700">
                      {s.total_matched}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-red-700">
                      {s.total_unmatched}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      Rp {formatRupiah(s.total_nominal_matched)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/history/${s.id}`}
                        className="inline-flex items-center gap-1 text-xs text-slate-700 hover:text-slate-900"
                      >
                        <Eye className="h-3.5 w-3.5" /> Detail
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
