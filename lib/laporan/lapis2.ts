// ============================================================
// CEKTRANSFER - Penyusun laporan LAPIS 2
// File: lib/laporan/lapis2.ts
//
// LAPIS 2 menjawab SATU pertanyaan: apakah resi yang lolos Lapis 1 benar-benar
// ADA di mutasi rekening?
//
// Ia TIDAK menilai ulang apakah angka kontrak sama dengan angka slip — itu
// sudah selesai di Lapis 1. Menjaga dua pertanyaan ini terpisah adalah
// keputusan pemilik 27 Juli 2026, dan justru pemisahan itu yang membuat
// keduanya berarti: sebuah kontrak bisa LULUS Lapis 1 (slipnya ada, angkanya
// pas) lalu GAGAL Lapis 2 (uangnya tidak pernah masuk rekening).
//
// REKAP PER TANGGAL ADALAH ALAT ANTI-BOCOR, BUKAN HIASAN.
// Pemilik membaca laporan Lapis 1 setiap hari. Kalau jumlah resi tanggal X di
// sini tidak sama dengan yang dinyatakan cocok di Lapis 1 tanggal X, ada resi
// yang lolos di antara dua lapisan. Tanpa rekap ini, kebocoran semacam itu
// tidak punya satu tempat pun untuk terlihat.
//
// DUA ARAH, BUKAN SATU. Selain "resi tanpa uang", laporan ini juga menyebut
// "uang tanpa resi" — termasuk uang KELUAR yang tidak diminta siapa pun.
// Arah itu tidak pernah dilaporkan sistem ini sebelumnya.
// ============================================================

const rp = (n: number) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

const BULAN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];

/** Tanggal kalender diperlakukan sebagai tanggal polos — diurai UTC, dibaca
 *  UTC. Menguraikannya sebagai tengah malam WIB lalu membaca komponen UTC
 *  membuatnya mundur sehari (pelajaran dari laporan Lapis 1 #1, 28 Jul 2026). */
function tgl(iso: string): string {
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`;
}

export interface KepalaLapis2 {
  nomor: number | null;
  sebelumNomor: number | null;
  sebelumKapan: string | null;
}

export interface IsiLapis2 {
  bankLabel: string;
  namaFile: string;
  /** Rentang tanggal yang ADA DI BERKAS. */
  berkasDari: string | null;
  berkasSampai: string | null;
  /** Rentang yang BENAR-BENAR direkonsiliasi (ada resi diuji di dalamnya). */
  nilaiDari: string | null;
  nilaiSampai: string | null;
  utuh: boolean | null;
  rantaiPutus: number;
  nyambung: boolean | null;
  selisihSambungan: number;
  /** Per tanggal, MASUK dan KELUAR dipisah.
   *  Digabung, angkanya tidak bisa disandingkan dengan Lapis 1 — di sana
   *  keduanya memang dilaporkan terpisah. */
  perTanggal: {
    tgl: string; jml: number; rp: number;
    masukJml?: number; masukRp?: number; keluarJml?: number; keluarRp?: number;
  }[];
  nDiuji: number;
  rpDiuji: number;
  nCocok: number;
  /** BAGIAN DARI nDiuji/nCocok — resi yang diketik OWNER sendiri di Lapis 1,
   *  bukan bacaan AI dari foto. Dipisah atas keputusan pemilik 29 Juli 2026:
   *  "berapa yang normal, berapa yang hasil penanganan manual". Menyatukannya
   *  membuat baris yang paling perlu diawasi jadi tidak bisa dikenali. */
  nManual?: number;
  nManualCocok?: number;
  /** Yang DITAHAN gerbang Lapis 1 dan memang tidak diuji di sini.
   *  null/undefined = sisi gadai tidak mengabarkannya (versi lama) —
   *  "tidak diketahui", BUKAN nol. */
  tertahanGerbang?: {
    jml: number; rp: number;
    perSebab: { sebab: string; teks: string; n: number; rp: number }[];
    gerbangError: string | null;
  } | null;
  tidakKetemu: { no_faktur: string; outlet: string; tgl: string; nominal: number; sebab: string }[];
  ditahanLuarPeriode: number;
  ditahanKonflik: number;
  kreditNganggur: { tgl: string; jam: string; nominal: number; pihak: string; ket: string }[];
  rpKreditNganggur: number;
  /** Sisa yang belum pernah dilaporkan tapi tidak muat di daftar ini. */
  sisaKreditNganggur?: number;
  debetNganggur: { tgl: string; jam: string; nominal: number; pihak: string; ket: string }[];
  rpDebetNganggur: number;
  sisaDebetNganggur?: number;
  /** Tanggal terakhir yang benar-benar diuji untuk "tanpa pemilik". Terisi =
   *  ada ekor tanggal yang SENGAJA dilewati karena klaim gadai untuk hari itu
   *  belum lahir (cron malam belum menyapunya). */
  nganggurBatas?: string | null;
  /** false = pemeriksaan "tanpa pemilik" TIDAK jalan. Nol baris bukan "bersih". */
  nganggurDiperiksa?: boolean;
  /** Resi yang sudah lama tidak ketemu dan belum dibereskan (dari sisi gadai). */
  tunggakan: {
    no_faktur: string; outlet: string; tgl: string; nominal: number; umur: number;
    /** Hasil penelusuran ulang ke mutasi yang BARU diunggah:
     *  jumlah baris bernominal sama yang masih BEBAS. null = tidak ditelusuri. */
    calonBebas?: number | null;
  }[];
  gagal: string[];
}

export function susunLapis2(isi: IsiLapis2, kepala: KepalaLapis2): string {
  const L: string[] = [];
  const nGagal = isi.tidakKetemu.length;
  const nTunggak = isi.tunggakan.length;

  // ── Kepala: vonis lebih dulu, sebelum angka apa pun ──
  const periode = isi.berkasDari && isi.berkasSampai
    ? `${tgl(isi.berkasDari)}–${tgl(isi.berkasSampai)}`
    : "periode tidak terbaca";
  L.push(`🟢 LAPIS 2 · cek mutasi ${periode}` + (kepala.nomor ? ` · Laporan #${kepala.nomor}` : ""));
  L.push(`resi ↔ mutasi rekening · ${isi.bankLabel}`);
  if (kepala.sebelumNomor && kepala.sebelumKapan) {
    const t = new Date(kepala.sebelumKapan);
    const jam = t.toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
    const lompat = (kepala.nomor ?? 0) - kepala.sebelumNomor - 1;
    L.push(`sebelumnya #${kepala.sebelumNomor} · ${jam}` +
           (lompat > 0 ? `  ⚠️ ${lompat} laporan tidak terkirim` : ""));
  }
  L.push("");

  if (isi.gagal.length) {
    L.push(`🚨 VONIS: PEMERIKSAAN TIDAK TUNTAS`);
    isi.gagal.forEach((g) => L.push(`• ${g}`));
    L.push(`Jangan anggap periode ini bersih.`);
    L.push("");
  } else if (nGagal === 0 && nTunggak === 0) {
    L.push(`✅ VONIS: BERSIH — semua resi ditemukan di rekening.`);
    L.push("");
  } else {
    const bagian = [
      nGagal > 0 ? `${nGagal} resi tidak ditemukan` : "",
      nTunggak > 0 ? `${nTunggak} tunggakan lama` : "",
    ].filter(Boolean).join(" + ");
    L.push(`⚠️ VONIS: ${bagian}`);
    L.push("");
  }

  // ── Rekap per tanggal: alat sanding-menyanding dengan Lapis 1 ──
  const totMasuk = isi.perTanggal.reduce((s, x) => s + Number(x.masukRp ?? 0), 0);
  const totKeluar = isi.perTanggal.reduce((s, x) => s + Number(x.keluarRp ?? 0), 0);
  const nMasuk = isi.perTanggal.reduce((s, x) => s + Number(x.masukJml ?? 0), 0);
  const nKeluar = isi.perTanggal.reduce((s, x) => s + Number(x.keluarJml ?? 0), 0);

  L.push(`RESI YANG DIUJI  ${isi.nDiuji} · ${rp(isi.rpDiuji)}`);
  // Diam BUKAN jawaban. Sebelum ini, "semua ketemu" hanya bisa disimpulkan
  // dari TIDAK ADANYA blok "tidak ditemukan" — pembaca harus menebak dari
  // sesuatu yang tidak tertulis. Sekarang keduanya selalu disebut, termasuk
  // saat nol, supaya "lengkap" jadi pernyataan dan bukan dugaan.
  L.push(`   ✅ ketemu di rekening  ${isi.nDiuji - nGagal}`);
  L.push(`   ${nGagal > 0 ? '⛔' : '✅'} tidak ketemu          ${nGagal}`);
  L.push(`   MASUK  ${String(nMasuk).padStart(3)} resi · ${rp(totMasuk)}`);
  L.push(`   KELUAR ${String(nKeluar).padStart(3)} resi · ${rp(totKeluar)}`);

  // ── NORMAL vs HASIL PENANGANAN MANUAL ──
  //
  // Resi yang diketik OWNER sendiri dibaca mesin dengan cara yang sama persis,
  // jadi tanpa baris ini ia tidak bisa dibedakan dari resi yang dibaca AI dari
  // foto. Bedanya penting: yang satu punya foto sebagai lawan, yang satu hanya
  // punya ingatan orang. Yang diketik tangan LALU tidak ketemu di rekening
  // adalah kombinasi yang paling perlu dilihat, dan ia tak akan pernah menonjol
  // kalau angkanya berbaur.
  const nMan = Number(isi.nManual ?? 0);
  if (nMan > 0) {
    const manCocok = Number(isi.nManualCocok ?? 0);
    L.push(`   ── dari jumlah di atas ──`);
    L.push(`   normal              ${isi.nDiuji - nMan} · ketemu ${isi.nCocok - manCocok}`);
    L.push(`   penanganan manual   ${nMan} · ketemu ${manCocok}` +
           (nMan - manCocok > 0 ? `  ⚠️ ${nMan - manCocok} TIDAK ketemu` : ''));
    L.push(`   (manual = resi yang diketik sendiri di Lapis 1, bukan bacaan foto)`);
  }

  // ── APA YANG TIDAK SAMPAI KE SINI ──
  //
  // Gerbang Lapis 1 menahan sebagian resi, dan yang tertahan tidak akan pernah
  // muncul di laporan ini. Kalau itu tidak dikatakan, "RESI YANG DIUJI" terbaca
  // sebagai "seluruh resi hari itu" — dan selisihnya dengan Lapis 1 akan
  // terlihat seperti uang hilang, persis salah baca yang blok per-tanggal ini
  // dibuat untuk menghentikannya.
  const tg = isi.tertahanGerbang;
  if (tg?.gerbangError) {
    L.push(`   🚨 GERBANG LAPIS 1 TIDAK BISA MENILAI — semua resi dilepas apa adanya.`);
    L.push(`      Jangan anggap yang diuji di sini sudah lulus Lapis 1.`);
  } else if (tg && tg.jml > 0) {
    L.push(`   🚧 ${tg.jml} resi · ${rp(tg.rp)} DITAHAN Lapis 1 — sengaja tidak diuji di sini`);
    tg.perSebab.slice(0, 6).forEach((s) => L.push(`      • ${s.teks} — ${s.n} · ${rp(s.rp)}`));
    L.push(`      rinciannya di laporan LAPIS 1 (blok TERTAHAN DI GERBANG).`);
  } else if (tg == null) {
    L.push(`   ➖ jumlah yang ditahan Lapis 1 tidak dikabarkan — tidak bisa dipastikan`);
    L.push(`      bahwa seluruh resi hari itu sudah sampai ke sini.`);
  }
  if (isi.perTanggal.length) {
    L.push("");
    isi.perTanggal.slice(0, 40).forEach((x) => {
      // Satu tanggal = dua baris, bukan satu angka gabungan. Pemilik memeriksa
      // Lapis 1 masuk dan keluar SECARA TERPISAH, jadi rekap ini harus bisa
      // dibaca dengan cara yang sama tanpa hitung-hitungan di kepala.
      L.push(`   ${tgl(x.tgl)}`);
      L.push(`      masuk  ${String(x.masukJml ?? 0).padStart(3)} resi · ${rp(Number(x.masukRp ?? 0))}`);
      L.push(`      keluar ${String(x.keluarJml ?? 0).padStart(3)} resi · ${rp(Number(x.keluarRp ?? 0))}`);
    });
    L.push("");
    L.push(`   ↳ sandingkan dengan baris "dilepas ke Lapis 2" pada blok TOTAL RESI`);
    L.push(`     HARI INI di LAPIS 1 tanggal itu — BUKAN dengan totalnya, karena`);
    L.push(`     yang tertahan gerbang memang tidak pernah sampai kemari.`);
    L.push(`     Angkanya harus SAMA PERSIS. Kalau beda, ada resi yang lolos`);
    L.push(`     di antara dua lapisan.`);
    L.push(`     (JANGAN disandingkan dengan "Cocok dgn slip" — itu nilai KONTRAK,`);
    L.push(`      bukan nilai resi; keduanya memang berbeda.)`);
  }
  L.push("");

  // ── Yang tidak ketemu: nomor kontrak + outlet, bukan cacah ──
  if (nGagal > 0) {
    L.push(`⛔ TIDAK DITEMUKAN DI REKENING (${nGagal})`);
    isi.tidakKetemu.slice(0, 20).forEach((x, i) => {
      L.push(`${i + 1}. ${x.no_faktur} · ${x.outlet}`);
      L.push(`    ${tgl(x.tgl)} · ${rp(x.nominal)} · ${x.sebab}`);
    });
    if (nGagal > 20) L.push(`   …dan ${nGagal - 20} lagi`);
    L.push("");
  }

  if (nTunggak > 0) {
    L.push(`🔁 BELUM BERES DARI SEBELUMNYA (${nTunggak})`);
    L.push(`   ditelusuri ULANG ke mutasi yang baru diunggah:`);
    isi.tunggakan.slice(0, 15).forEach((x) => {
      L.push(`• ${x.no_faktur} · ${x.outlet} · ${tgl(x.tgl)} · ${rp(x.nominal)} · ${x.umur} hari`);
      // Menyebut daftar tunggakan tanpa menelusurinya ulang berarti menyuruh
      // pemilik membuka /belum-cocok satu per satu hanya untuk tahu apakah ada
      // yang berubah. Kabari hasilnya di sini.
      const c = x.calonBebas;
      if (c == null) L.push(`   ↳ belum ditelusuri`);
      else if (c > 0) L.push(`   ↳ ADA ${c} baris mutasi bernominal sama yang masih bebas — buka /belum-cocok`);
      else L.push(`   ↳ masih TIDAK ADA di mutasi. Tetap dibawa ke besok sampai ditutup.`);
    });
    if (nTunggak > 15) L.push(`   …dan ${nTunggak - 15} lagi`);
    L.push("");
  }

  // ── ARAH SEBALIKNYA: uang yang tidak diklaim siapa pun ──
  //
  // Dua blok ini menjawab pertanyaan yang tidak pernah ditanyakan sistem ini
  // sebelumnya. Arah debet khususnya: uang KELUAR dari rekening yang tidak
  // diminta permintaan transfer mana pun. Selama ini laporan berbunyi "semua
  // transfer keluar ketemu di mutasi" — kalimat yang hanya menguji arah
  // sebaliknya dan tidak pernah arah ini.
  // ── (0) TIDAK BOLEH BERBUNYI SEPERTI "BERSIH" KALAU MEMANG BELUM DIPERIKSA ──
  //
  // Sampai 30 Juli 2026 dua blok di bawah dibangun dari kueri yang dijalankan
  // SEBELUM pemilik barisnya tertulis, sehingga 26 dari 41 barisnya adalah
  // baris yang justru baru saja dicocokkan. Sesudah dibetulkan, kueri itu bisa
  // GAGAL atau TIDAK DIJALANKAN — dan kalau itu terjadi, "(0)" adalah bunyi
  // paling berbahaya di seluruh laporan ini karena ia terbaca sebagai kabar
  // baik. Jadi keadaannya dikatakan lebih dulu.
  if (isi.nganggurDiperiksa === false) {
    L.push(`🚨 UANG TANPA PEMILIK: BELUM DIPERIKSA pada kiriman ini.`);
    L.push(`   Angka (0) di dua baris berikut BUKAN berarti bersih.`);
  } else if (isi.nganggurBatas) {
    L.push(`ℹ️ Uang tanpa pemilik diperiksa sampai ${tgl(isi.nganggurBatas)} saja —`);
    L.push(`   sesudah itu klaimnya belum lahir (cron malam gadai belum menyapunya),`);
    L.push(`   jadi belum bisa dinilai. Akan ikut pada kiriman berikutnya.`);
  }

  L.push(`💰 KREDIT TANPA KONTRAK (${isi.kreditNganggur.length})` +
         (isi.kreditNganggur.length ? ` · ${rp(isi.rpKreditNganggur)}` : ""));
  if (isi.kreditNganggur.length) {
    L.push(`   uang MASUK yang tidak diklaim transaksi mana pun`);
    // SEMUA ditampilkan, tidak dipotong.
    //
    // Versi pertama menampilkan 10 lalu menulis "… N lagi tidak ditampilkan" —
    // padahal N baris itu SUDAH distempel "pernah dilaporkan" di pipeline, jadi
    // mereka tidak akan pernah muncul lagi. Dipotong DAN dianggap sudah
    // diberitahukan adalah cara paling rapi menghilangkan sesuatu tanpa
    // seorang pun menyadarinya. Yang ditampilkan harus SAMA PERSIS dengan yang
    // distempel; batas 25 per arah sudah dijaga di pipeline.
    isi.kreditNganggur.forEach((x) => {
      L.push(`   • ${tgl(x.tgl)} ${x.jam} · ${rp(x.nominal)}${x.pihak ? ` · ${x.pihak}` : ""}`);
    });
    // Sisa yang belum pernah dilaporkan SAMA SEKALI harus disebut, bukan
    // didiamkan sampai kiriman berikutnya. Daftar yang dipotong diam-diam
    // berbunyi persis seperti daftar yang lengkap.
    if (Number(isi.sisaKreditNganggur ?? 0) > 0) {
      L.push(`   ↳ masih ada ${isi.sisaKreditNganggur} baris lagi yang belum pernah`);
      L.push(`     dilaporkan — akan disebut pada kiriman mutasi berikutnya.`);
    }
  }

  L.push(`💸 DEBET TANPA PERMINTAAN (${isi.debetNganggur.length})` +
         (isi.debetNganggur.length ? ` · ${rp(isi.rpDebetNganggur)}` : ""));
  if (isi.debetNganggur.length) {
    L.push(`   ⚠️ uang KELUAR yang tidak diminta permintaan transfer mana pun`);
    isi.debetNganggur.forEach((x) => {
      L.push(`   • ${tgl(x.tgl)} ${x.jam} · ${rp(x.nominal)}${x.pihak ? ` · ${x.pihak}` : ""}`);
    });
    if (Number(isi.sisaDebetNganggur ?? 0) > 0) {
      L.push(`   ↳ masih ada ${isi.sisaDebetNganggur} baris lagi yang belum pernah`);
      L.push(`     dilaporkan — akan disebut pada kiriman mutasi berikutnya.`);
    }
  }
  L.push("");

  // ── Cakupan: DUA rentang, dan bedanya disebut ──
  //
  // Rentang berkas dan rentang yang benar-benar direkonsiliasi TIDAK SAMA
  // kalau ada hari yang nol transfer. Menyebut satu angka saja membuat hari
  // yang tidak pernah diuji terhitung "sudah diperiksa" — kesenyapan yang
  // berbunyi seperti kabar baik.
  L.push(`CAKUPAN`);
  L.push(`   Berkas          ${periode}`);
  const dinilai = isi.nilaiDari && isi.nilaiSampai
    ? `${tgl(isi.nilaiDari)}–${tgl(isi.nilaiSampai)}`
    : "tidak ada resi yang bisa dinilai";
  L.push(`   Direkonsiliasi  ${dinilai}`);
  if (isi.berkasDari && isi.nilaiDari &&
      (isi.berkasDari !== isi.nilaiDari || isi.berkasSampai !== isi.nilaiSampai)) {
    L.push(`   ⚠️ selisihnya BUKAN "sudah diperiksa" — hari tanpa resi memang tak diuji`);
  }
  if (isi.ditahanLuarPeriode > 0) {
    L.push(`   ${isi.ditahanLuarPeriode} resi di luar jangkauan berkas ini — menunggu mutasi lain`);
  }
  if (isi.ditahanKonflik > 0) {
    L.push(`   ⚠️ ${isi.ditahanKonflik} resi berebut baris mutasi yang sama — perlu diputuskan`);
  }

  const keutuhan =
    isi.utuh === true ? "✅ utuh" : isi.utuh === false ? "⛔ TIDAK UTUH" : "➖ tak bisa dibuktikan";
  const sambung =
    isi.nyambung === true ? "✅ nyambung"
    : isi.nyambung === false ? `⛔ TIDAK NYAMBUNG (selisih ${rp(isi.selisihSambungan)})`
    : "➖ belum ada titik banding";
  L.push(`   Keutuhan  ${keutuhan} · ${sambung}` +
         (isi.rantaiPutus > 0 ? ` · ⛔ rantai putus ${isi.rantaiPutus} tempat` : ""));

  return L.join("\n");
}
