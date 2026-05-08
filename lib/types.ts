// Tipe data shared antara client + server

export type Outlet = {
  id: string;
  user_id: string;
  nama: string;
  warna_hex: string;
  urutan_palette: number;
  created_at: string;
};

export type UserSettings = {
  user_id: string;
  last_input_date: string | null;
  updated_at: string;
};

/** Satu baris transaksi kredit dari PDF mutasi */
export type PdfTransaction = {
  no: number;
  page: number;
  tanggal: string;
  tanggalDate: Date;
  waktu: string;
  namaPengirim: string;
  deskripsi: string;
  kredit: number;
  bbox: {
    yBottom: number;
    height: number;
    xLeft: number;
    width: number;
  };
};

/** Satu baris input dari user */
export type UserInput = {
  id: string;
  tanggal: Date;
  outletId: string;
  nominal: number;
  match?: MatchResult;
};

export type MatchResult =
  | {
      status: "matched";
      txNo: number;
      txDate: Date;
      colorHex: string;
    }
  | {
      status: "no_candidate";
    }
  | {
      status: "all_taken";
      conflictCount: number;
      /** Tanggal kandidat (DD-MM-YYYY) yang sudah ke-claim, supaya user tau kapan-nya */
      conflictDates: string[];
    };

export type MatchSummary = {
  totalInput: number;
  matched: number;
  noCandidate: UserInput[];
  allTaken: UserInput[];
  unclaimed: PdfTransaction[];
};
