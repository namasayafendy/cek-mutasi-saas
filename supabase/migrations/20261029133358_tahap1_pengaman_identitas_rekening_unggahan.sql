-- TAHAP 1 "Dua Rekening + Gerbang Token" — pengaman cektransfer.
-- Diterapkan lewat MCP apply_migration 29 Okt 2026 (versi 20261029133358).
-- SEMUANYA ADITIF: kode yang sedang tayang tidak membaca kolom/tabel baru dan
-- indeks unik lama (parsed_tx_uniq_noref) SENGAJA belum dibuang — ia baru
-- dibuang di migrasi terpisah SESUDAH kode yang memakai indeks baru tayang.

-- 1) Identitas rekening. Nomor rekening = satu-satunya identitas di PDF BSINet.
alter table public.banks
  add column if not exists nomor_rekening text,
  add column if not exists peran text,
  add column if not exists mulai_tgl date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'banks_peran_valid') then
    alter table public.banks
      add constraint banks_peran_valid check (peran is null or peran in ('MASUK', 'KELUAR'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'banks_nomor_rekening_digit') then
    alter table public.banks
      add constraint banks_nomor_rekening_digit check (nomor_rekening is null or nomor_rekening ~ '^[0-9]{6,20}$');
  end if;
end $$;

create unique index if not exists banks_nomor_rekening_unik
  on public.banks (account_id, nomor_rekening) where nomor_rekening is not null;

-- 2) Penyaring baris kembar IKUT ARAH. Debet dan kredit yang berbagi nomor
--    referensi (retur BI-FAST) dulu saling membuang lewat indeks
--    (account_id, bank_id, no_ref) — debet Rp 8.287.500 hilang begitu.
alter table public.parsed_transactions
  add column if not exists arah char(1)
  generated always as (case when coalesce(nominal_debet, 0) > 0 then 'D' else 'K' end) stored;

create unique index if not exists parsed_tx_uniq_noref_arah
  on public.parsed_transactions (account_id, bank_id, no_ref, arah);

-- 3) Catatan per unggahan — dasar tombol "Batalkan unggahan".
create table if not exists public.mutasi_unggahan (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  job_id uuid null references public.mutasi_jobs(id) on delete set null,
  sumber text not null check (sumber in ('telegram', 'manual')),
  file_name text,
  nomor_rekening_pdf text,
  periode_awal date,
  periode_akhir date,
  tgl_baris_awal date,
  tgl_baris_akhir date,
  baris_terbaca integer not null default 0,
  baris_baru integer not null default 0,
  recon_sebelum_saldo numeric,
  recon_sebelum_tgl date,
  recon_sesudah_saldo numeric,
  recon_sesudah_tgl date,
  dibuat_oleh uuid default auth.uid(),
  created_at timestamptz not null default now(),
  dibatalkan_at timestamptz,
  dibatalkan_oleh uuid,
  catatan_batal jsonb
);

create index if not exists mutasi_unggahan_bank_urut
  on public.mutasi_unggahan (account_id, bank_id, created_at desc);

alter table public.mutasi_unggahan enable row level security;

drop policy if exists mutasi_unggahan_select_own on public.mutasi_unggahan;
create policy mutasi_unggahan_select_own on public.mutasi_unggahan
  for select using (account_id = current_account_id());

drop policy if exists mutasi_unggahan_insert_own on public.mutasi_unggahan;
create policy mutasi_unggahan_insert_own on public.mutasi_unggahan
  for insert with check (account_id = current_account_id());

drop policy if exists mutasi_unggahan_update_own on public.mutasi_unggahan;
create policy mutasi_unggahan_update_own on public.mutasi_unggahan
  for update using (account_id = current_account_id())
  with check (account_id = current_account_id());

revoke all on public.mutasi_unggahan from anon;

alter table public.parsed_transactions
  add column if not exists unggah_id uuid references public.mutasi_unggahan(id) on delete set null;
create index if not exists parsed_tx_unggah_idx
  on public.parsed_transactions (unggah_id) where unggah_id is not null;

alter table public.mutasi_coverage
  add column if not exists unggah_id uuid references public.mutasi_unggahan(id) on delete set null;

-- 4) Dua tabel cadangan mutasi (Juni) terbuka untuk anon key. Kunci:
--    RLS tanpa policy = hanya service_role.
alter table if exists public.parsed_tx_bak_bsi_20260619 enable row level security;
alter table if exists public.parsed_tx_bak_bsi_20260619b enable row level security;
