// Analisa kelengkapan & kontinuitas mutasi (fitur "Bukti Utuh" + deteksi bolong).
// A: kelengkapan = total tercetak header vs jumlah baris terbaca (eksak).
// B: kontinuitas = saldo awal upload ini menyambung saldo akhir upload terakhir.
import type { ParsedDocument } from "./types";

export type IntegrityResult = {
  hasMeta: boolean;
  // A — kelengkapan
  sumKredit: number;
  sumDebet: number;
  printedKredit: number | null;
  printedDebet: number | null;
  complete: boolean | null;   // null kalau total tercetak tak terbaca
  missingKredit: number;      // tercetak - terbaca (+ = ada yg tak terbaca)
  missingDebet: number;
  chainBreaks: number;        // jumlah "lompatan" saldo antar-baris (transaksi ke-skip)
  // B — kontinuitas
  saldoAwal: number | null;
  saldoAkhir: number | null;
  firstDate: string | null;
  lastDate: string | null;
  connected: boolean | null;  // null kalau belum ada titik terakhir tersimpan
  gapAmount: number;          // perkiraan selisih saldo kalau tidak nyambung
};

const TOL = 1; // toleransi Rp1 utk pembulatan per-baris

export function analyzeIntegrity(doc: ParsedDocument, lastSaldo: number | null): IntegrityResult {
  const rows = doc.rows;
  const sumKredit = rows.reduce((s, r) => s + (r.kredit || 0), 0);
  const sumDebet = rows.reduce((s, r) => s + (r.debet || 0), 0);

  const m = doc.statementMeta;
  const printedKredit = m?.printedKredit ?? null;
  const printedDebet = m?.printedDebet ?? null;
  const complete =
    printedKredit != null && printedDebet != null
      ? sumKredit === printedKredit && sumDebet === printedDebet
      : null;

  // rantai saldo: saldo[n] harus = saldo[n-1] + kredit[n] - debet[n]
  let chainBreaks = 0;
  const ordered = rows.filter((r) => r.saldo != null).slice().sort((a, b) => a.no - b.no);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1].saldo as number;
    const cur = ordered[i];
    const expected = prev + (cur.kredit || 0) - (cur.debet || 0);
    if (Math.abs(expected - (cur.saldo as number)) > TOL) chainBreaks++;
  }

  const saldoAwal = m?.saldoAwal ?? null;
  const saldoAkhir = m?.saldoAkhir ?? null;

  let connected: boolean | null = null;
  let gapAmount = 0;
  if (lastSaldo != null && saldoAwal != null) {
    // nyambung kalau saldo awal == titik terakhir, ATAU upload ini mengandung
    // baris yg saldonya == titik terakhir (overlap / download dari tgl terakhir).
    const overlap = rows.some((r) => r.saldo != null && Math.abs((r.saldo as number) - lastSaldo) <= TOL);
    connected = Math.abs(saldoAwal - lastSaldo) <= TOL || overlap;
    if (!connected) gapAmount = Math.abs(saldoAwal - lastSaldo);
  }

  return {
    hasMeta: !!m,
    sumKredit,
    sumDebet,
    printedKredit,
    printedDebet,
    complete,
    missingKredit: printedKredit != null ? printedKredit - sumKredit : 0,
    missingDebet: printedDebet != null ? printedDebet - sumDebet : 0,
    chainBreaks,
    saldoAwal,
    saldoAkhir,
    firstDate: m?.firstDate ?? null,
    lastDate: m?.lastDate ?? null,
    connected,
    gapAmount,
  };
}
