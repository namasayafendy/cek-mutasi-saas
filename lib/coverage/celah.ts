// ============================================================
// KANAL MASUK MUTASI — Uji bolong cakupan (Fase 2)
// File: lib/coverage/celah.ts
//
// Menjawab pertanyaan yang selama ini tidak pernah dijawab siapa pun:
// APAKAH SEMUA TANGGAL SUDAH PERNAH DIPERIKSA.
//
// Bukan "apakah ada temuan" — ketiadaan temuan bisa berarti ketiadaan data,
// dan itu justru keadaan paling berbahaya karena terasa seperti aman.
//
// ── KENAPA KALENDER SAJA TIDAK CUKUP ──
// Parser menurunkan rentang sebuah berkas dari tanggal BARIS-nya, bukan dari
// periode tercetak di header (lib/parsers/bsi-bsinet.ts:283-284). Jadi kalau
// hari terakhir sebuah export kebetulan nihil transaksi (Minggu, libur), hari
// itu tidak ikut tercatat — dan kalender polos akan menudingnya "bolong"
// padahal tidak ada yang hilang. Alarm palsu yang berulang tiap minggu akan
// membuat seluruh laporan berhenti dibaca, dan itu lebih berbahaya daripada
// tidak ada alarm sama sekali.
//
// ── YANG MENENGAHI ADALAH UANG ──
// Kalau saldo_akhir rentang sebelumnya sama persis dengan saldo_awal rentang
// sesudahnya, maka perubahan saldo NETO di antara keduanya adalah nol.
//
// Batas kejujuran yang harus disebut: neto nol BUKAN berarti tidak ada
// transaksi — masuk Rp 1 jt lalu keluar Rp 1 jt menghasilkan saldo yang sama
// persis. Untuk tujuan kita ia tetap cukup kuat, karena transfer MASUK yang
// tidak diimbangi keluar pasti menggeser saldo. Tapi celahnya tetap disebut
// di laporan sebagai baris informasi, bukan disembunyikan — pembaca berhak
// tahu tanggal mana yang dilewati dan atas dasar apa.
//
// Celah yang saldonya TIDAK bertemu dilaporkan lengkap dengan selisih
// rupiahnya — itu bukan lagi dugaan, itu bukti ada uang yang belum terperiksa.
// ============================================================

export interface BarisCakupan {
  tgl_awal: string;   // YYYY-MM-DD
  tgl_akhir: string;  // YYYY-MM-DD
  saldo_awal: number | null;
  saldo_akhir: number | null;
}

export interface Celah {
  dari: string;   // hari pertama yang tidak tercakup
  sampai: string; // hari terakhir yang tidak tercakup
  hari: number;
  /** Selisih saldo di batas celah. 0 = saldo bertemu (celah terbukti kosong). */
  selisih: number;
  /**
   * true = saldo di kedua sisi bertemu.
   *
   * HATI-HATI MENAFSIRKAN INI. Yang terbukti adalah perubahan saldo NETO nol,
   * BUKAN ketiadaan transaksi: masuk Rp 1 jt lalu keluar Rp 1 jt di hari yang
   * sama menghasilkan saldo yang sama persis. Untuk tujuan kita ia cukup —
   * transfer masuk yang tidak diimbangi keluar PASTI menggeser saldo — tapi
   * jangan pernah menuliskannya sebagai "tidak ada transaksi".
   */
  terbuktiKosong: boolean;
}

export interface HasilCakupan {
  /** Rentang gabungan setelah digabung-satukan, urut menaik. */
  rentang: { dari: string; sampai: string }[];
  /** Celah yang BENAR-BENAR perlu ditindak (yang terbukti kosong dibuang). */
  celah: Celah[];
  /** Celah yang saldonya bertemu — disimpan untuk transparansi, bukan alarm. */
  celahTerbuktiKosong: Celah[];
  /** Hari pertama & terakhir yang pernah tercakup. null kalau belum ada apa pun. */
  awal: string | null;
  akhir: string | null;
  /** Berapa hari mutasi tertinggal dari hari ini (WIB). null kalau belum ada data. */
  umurHari: number | null;
  /** Jumlah hari yang BENAR-BENAR tercakup (gabungan rentang). */
  hariTercakup: number;
  /**
   * Lebar jendela yang diperiksa, dalam hari.
   *
   * Ini bukan hiasan. Tanpa angka ini, laporan yang cuma punya SATU rentang
   * akan berbunyi "tidak ada tanggal bolong" — vakum secara logika (tidak ada
   * celah karena tidak ada apa pun untuk dicelahi) tapi terbaca sebagai
   * jaminan bahwa 60 hari terakhir sudah bersih. Itu justru bentuk kebohongan
   * yang paling ingin dihindari sistem ini.
   */
  jendelaHari: number;
}

const HARI_MS = 86_400_000;

function ke(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}
function dari(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Hari ini menurut WIB. Seluruh sistem ini memakai WIB untuk apa pun yang
 *  dibaca manusia — memakai waktu server akan menggeser tanggal 7 jam. */
export function hariIniWIB(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Selisih hari antara dua tanggal ISO. */
export function selisihHari(a: string, b: string): number {
  return Math.round((ke(b) - ke(a)) / HARI_MS);
}

/**
 * Hitung cakupan gabungan + celah yang perlu ditindak.
 *
 * @param baris   seluruh rentang tercatat (satu bank, sudah difilter periode)
 * @param sampai  batas kanan pemeriksaan; default hari ini WIB
 */
export function hitungCakupan(baris: BarisCakupan[], sampai?: string, jendelaHari = 60): HasilCakupan {
  const kosong: HasilCakupan = {
    rentang: [], celah: [], celahTerbuktiKosong: [],
    awal: null, akhir: null, umurHari: null,
    hariTercakup: 0, jendelaHari,
  };
  const sah = (baris ?? []).filter(
    (b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.tgl_awal) && /^\d{4}-\d{2}-\d{2}$/.test(b.tgl_akhir),
  );
  if (sah.length === 0) return kosong;

  const batasKanan = sampai || hariIniWIB();
  const batasKiri = dari(ke(batasKanan) - (jendelaHari - 1) * HARI_MS);

  // Rentang DIPOTONG ke jendela sebelum apa pun dihitung.
  //
  // Tanpa pemotongan ini, satu baris tunggal berisi 85 hari dari masa lampau
  // membuat hariTercakup >= 60 dan laporan mencetak "✅ Cakupan 60 hari:
  // tidak ada tanggal bolong" — padahal 54 hari terakhir tidak pernah sekali
  // pun diperiksa. Jendelanya benar jumlahnya, cuma bukan jendela yang itu.
  const dipotong: BarisCakupan[] = [];
  for (const b of sah) {
    if (b.tgl_akhir < batasKiri || b.tgl_awal > batasKanan) continue;
    dipotong.push({
      ...b,
      tgl_awal: b.tgl_awal < batasKiri ? batasKiri : b.tgl_awal,
      tgl_akhir: b.tgl_akhir > batasKanan ? batasKanan : b.tgl_akhir,
      // Saldo batas ikut dibuang kalau ujungnya terpotong — saldo itu milik
      // tanggal aslinya, dan memakainya sebagai batas baru akan MENGARANG
      // bukti "celah terbukti kosong" yang tidak pernah ada.
      saldo_awal: b.tgl_awal < batasKiri ? null : b.saldo_awal,
      saldo_akhir: b.tgl_akhir > batasKanan ? null : b.saldo_akhir,
    });
  }
  if (dipotong.length === 0) return kosong;

  const urut = [...dipotong].sort((a, b) =>
    a.tgl_awal < b.tgl_awal ? -1 : a.tgl_awal > b.tgl_awal ? 1 : a.tgl_akhir < b.tgl_akhir ? -1 : 1,
  );

  // Gabungkan rentang yang bertindihan ATAU bersambungan (akhir + 1 hari = awal
  // berikutnya). Bersambungan wajib ikut digabung, kalau tidak setiap pergantian
  // berkas akan tampak seperti celah nol hari.
  type Gabung = { dari: string; sampai: string; saldoAwal: number | null; saldoAkhir: number | null };
  const gabung: Gabung[] = [];
  for (const b of urut) {
    const t = gabung[gabung.length - 1];
    if (t && ke(b.tgl_awal) <= ke(t.sampai) + HARI_MS) {
      if (ke(b.tgl_akhir) > ke(t.sampai)) {
        t.sampai = b.tgl_akhir;
        t.saldoAkhir = b.saldo_akhir;
      }
    } else {
      gabung.push({
        dari: b.tgl_awal, sampai: b.tgl_akhir,
        saldoAwal: b.saldo_awal, saldoAkhir: b.saldo_akhir,
      });
    }
  }

  const celah: Celah[] = [];
  const kosongTerbukti: Celah[] = [];
  for (let i = 1; i < gabung.length; i++) {
    const kiri = gabung[i - 1];
    const kanan = gabung[i];
    const mulai = ke(kiri.sampai) + HARI_MS;
    const habis = ke(kanan.dari) - HARI_MS;
    if (mulai > habis) continue;

    // Inilah penengahnya. Kalau salah satu saldo tidak diketahui (bank yang
    // tidak mencetak meta saldo), kita TIDAK boleh menyimpulkan "kosong" —
    // ketidaktahuan bukan bukti. Celahnya tetap dilaporkan.
    const bisaDinilai = kiri.saldoAkhir != null && kanan.saldoAwal != null;
    const selisih = bisaDinilai ? Math.abs(Number(kanan.saldoAwal) - Number(kiri.saldoAkhir)) : 0;
    const terbuktiKosong = bisaDinilai && selisih <= 1; // toleransi Rp1 utk pembulatan

    const c: Celah = {
      dari: dari(mulai),
      sampai: dari(habis),
      hari: Math.round((habis - mulai) / HARI_MS) + 1,
      selisih: bisaDinilai ? selisih : 0,
      terbuktiKosong,
    };
    (terbuktiKosong ? kosongTerbukti : celah).push(c);
  }

  const awal = gabung[0].dari;
  const akhir = gabung[gabung.length - 1].sampai;

  // Hanya hari DI DALAM jendela yang dihitung — rentangnya sudah dipotong
  // di atas, jadi penjumlahan ini tidak bisa lagi melampaui jendelaHari.
  const hariTercakup = gabung.reduce((s, g) => s + selisihHari(g.dari, g.sampai) + 1, 0);

  return {
    rentang: gabung.map((g) => ({ dari: g.dari, sampai: g.sampai })),
    celah,
    celahTerbuktiKosong: kosongTerbukti,
    awal,
    akhir,
    umurHari: Math.max(0, selisihHari(akhir, batasKanan)),
    hariTercakup,
    jendelaHari,
  };
}

/** Rentang export yang siap disalin ke BSINet. SELALU mundur satu hari dari
 *  titik terakhir — tumpang tindih itu disengaja: kelebihan dibuang mesin
 *  (dedup), sedangkan kekurangan tidak bisa ditambal siapa pun. */
export function saranExport(akhirTercakup: string | null, sampai?: string): { dari: string; sampai: string } {
  const batas = sampai || hariIniWIB();
  if (!akhirTercakup) {
    return { dari: dari(ke(batas) - 7 * HARI_MS), sampai: batas };
  }
  return { dari: dari(ke(akhirTercakup) - HARI_MS), sampai: batas };
}

/** Ubah YYYY-MM-DD jadi dd-MM-yyyy untuk dibaca manusia. */
export function tglID(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
