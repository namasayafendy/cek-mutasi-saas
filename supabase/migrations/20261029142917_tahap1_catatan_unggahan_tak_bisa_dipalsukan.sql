-- TAHAP 1 (lanjutan 2): catatan unggahan TIDAK bisa dipalsukan anggota tim,
-- dan satu rekening hanya boleh punya SATU unggahan yang sedang diproses.
-- Diterapkan lewat MCP apply_migration 29 Okt 2026 (versi 20261029142917).
-- Kode yang sedang tayang tidak pernah menyentuh mutasi_unggahan /
-- parsed_transactions.unggah_id / batalkan_unggahan, jadi tidak terdampak.

alter table public.mutasi_unggahan add column if not exists selesai_at timestamptz;

-- 1) Hak akses: anggota tim hanya MEMBACA; menulis hanya kolom yang memang
--    diisi pipeline. Titik saldo sebelum/sesudah, waktu, dan status batal
--    diisi DATABASE sendiri (pemicu di bawah), bukan peramban.
revoke all on public.mutasi_unggahan from public, anon, authenticated;
grant select on public.mutasi_unggahan to authenticated;
grant insert (account_id, bank_id, job_id, sumber, file_name, nomor_rekening_pdf,
              periode_awal, periode_akhir, tgl_baris_awal, tgl_baris_akhir, baris_terbaca)
  on public.mutasi_unggahan to authenticated;
grant update (baris_baru, selesai_at) on public.mutasi_unggahan to authenticated;
grant all on public.mutasi_unggahan to service_role;

drop policy if exists mutasi_unggahan_update_own on public.mutasi_unggahan;
create policy mutasi_unggahan_update_own on public.mutasi_unggahan
  for update using (
    account_id = current_account_id()
    and dibuat_oleh = auth.uid()
    and dibatalkan_at is null
    and selesai_at is null
  )
  with check (account_id = current_account_id());

-- 2) Saat dicatat: waktu, pembuat, titik saldo SEBELUM diambil dari banks
--    (bukan dari halaman yang mungkin sudah basi), dan unggahan lain rekening
--    yang sama yang masih berjalan → ditolak (urutan baris = urutan catatan).
create or replace function public.mutasi_unggahan_sebelum_sisip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  new.created_at := now();
  new.dibuat_oleh := coalesce(auth.uid(), new.dibuat_oleh);
  new.dibatalkan_at := null;
  new.dibatalkan_oleh := null;
  new.catatan_batal := null;
  new.selesai_at := null;
  new.baris_baru := 0;

  select id, recon_last_saldo, recon_last_date into b
    from public.banks
   where id = new.bank_id and account_id = new.account_id
   for update;
  if not found then
    raise exception 'Rekening tidak ditemukan di akun ini.' using errcode = 'P0001';
  end if;

  perform 1 from public.mutasi_unggahan
   where account_id = new.account_id and bank_id = new.bank_id
     and dibatalkan_at is null and selesai_at is null
     and created_at > now() - interval '15 minutes';
  if found then
    raise exception 'UNGGAHAN_BERJALAN: unggahan lain untuk rekening ini masih diproses. Tunggu sampai selesai (paling lama 15 menit), lalu ulangi.'
      using errcode = 'P0001';
  end if;

  new.recon_sebelum_saldo := b.recon_last_saldo;
  new.recon_sebelum_tgl := b.recon_last_date;
  new.recon_sesudah_saldo := b.recon_last_saldo;
  new.recon_sesudah_tgl := b.recon_last_date;
  return new;
end;
$$;

drop trigger if exists trg_mutasi_unggahan_sebelum_sisip on public.mutasi_unggahan;
create trigger trg_mutasi_unggahan_sebelum_sisip
  before insert on public.mutasi_unggahan
  for each row execute function public.mutasi_unggahan_sebelum_sisip();

-- 3) Saat ditandai selesai: titik saldo SESUDAH dibaca dari banks (unggahan
--    lain rekening ini tidak mungkin berjalan di antaranya — lihat 2).
--    Identitas catatan tidak pernah boleh berubah.
create or replace function public.mutasi_unggahan_sebelum_ubah()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  if new.account_id is distinct from old.account_id
     or new.bank_id is distinct from old.bank_id
     or new.created_at is distinct from old.created_at
     or new.dibuat_oleh is distinct from old.dibuat_oleh
     or new.recon_sebelum_saldo is distinct from old.recon_sebelum_saldo
     or new.recon_sebelum_tgl is distinct from old.recon_sebelum_tgl then
    raise exception 'Identitas catatan unggahan tidak boleh diubah.' using errcode = 'P0001';
  end if;
  if old.selesai_at is null and new.selesai_at is not null then
    new.selesai_at := now();
    select recon_last_saldo, recon_last_date into b
      from public.banks
     where id = new.bank_id and account_id = new.account_id;
    new.recon_sesudah_saldo := b.recon_last_saldo;
    new.recon_sesudah_tgl := b.recon_last_date;
  elsif new.selesai_at is distinct from old.selesai_at then
    raise exception 'Tanda selesai unggahan hanya boleh diisi sekali.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mutasi_unggahan_sebelum_ubah on public.mutasi_unggahan;
create trigger trg_mutasi_unggahan_sebelum_ubah
  before update on public.mutasi_unggahan
  for each row execute function public.mutasi_unggahan_sebelum_ubah();

-- 4) Pemilik baris (unggah_id) ditulis SEKALI saat baris lahir. Mengubahnya
--    sesudah itu akan membuat "Batalkan unggahan" menghapus baris milik
--    unggahan lain. X → NULL tetap boleh (FK on delete set null).
create or replace function public.jaga_unggah_id_baris()
returns trigger
language plpgsql
as $$
begin
  if new.unggah_id is distinct from old.unggah_id and new.unggah_id is not null then
    raise exception 'unggah_id baris mutasi tidak boleh diubah.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jaga_unggah_id_baris on public.parsed_transactions;
create trigger trg_jaga_unggah_id_baris
  before update of unggah_id on public.parsed_transactions
  for each row execute function public.jaga_unggah_id_baris();

-- 5) Batalkan unggahan: dibatasi ke rekening unggahan itu sendiri, dan
--    unggahan yang masih berjalan tidak bisa dibatalkan (kecuali sudah basi
--    > 15 menit = prosesnya mati di tengah).
create or replace function public.batalkan_unggahan(p_unggah_id uuid, p_account_id uuid, p_oleh uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.mutasi_unggahan%rowtype;
  v_terbaru uuid;
  v_terpakai integer;
  v_hapus integer;
  v_cakupan integer;
  b public.banks%rowtype;
  v_recon text := 'tidak_diubah';
begin
  select * into u from public.mutasi_unggahan
   where id = p_unggah_id and account_id = p_account_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Unggahan tidak ditemukan.');
  end if;
  if u.dibatalkan_at is not null then
    return jsonb_build_object('ok', false, 'error', 'Unggahan ini sudah dibatalkan.');
  end if;
  if u.selesai_at is null and u.created_at > now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'error',
      'Unggahan ini masih diproses. Tunggu sampai selesai, lalu muat ulang halaman.');
  end if;

  select id into v_terbaru from public.mutasi_unggahan
   where account_id = p_account_id and bank_id = u.bank_id and dibatalkan_at is null
   order by created_at desc, id desc
   limit 1;
  if v_terbaru is distinct from u.id then
    return jsonb_build_object('ok', false, 'error',
      'Hanya unggahan TERAKHIR rekening ini yang bisa dibatalkan.');
  end if;

  perform 1 from public.parsed_transactions
   where unggah_id = u.id and account_id = p_account_id and bank_id = u.bank_id
   for update;

  select count(*) into v_terpakai
    from public.parsed_transactions p
   where p.unggah_id = u.id and p.account_id = p_account_id and p.bank_id = u.bank_id
     and (p.claimed_by_input_id is not null
          or p.manual_claim_reason is not null
          or exists (select 1 from public.cek_inputs ci where ci.matched_tx_id = p.id));
  if v_terpakai > 0 then
    return jsonb_build_object('ok', false, 'terpakai', v_terpakai, 'error',
      v_terpakai || ' baris dari unggahan ini sudah dipakai pencocokan, jadi tidak bisa dibatalkan otomatis.');
  end if;

  delete from public.parsed_transactions
   where unggah_id = u.id and account_id = p_account_id and bank_id = u.bank_id;
  get diagnostics v_hapus = row_count;

  delete from public.mutasi_coverage
   where unggah_id = u.id and account_id = p_account_id and bank_id = u.bank_id;
  get diagnostics v_cakupan = row_count;

  if u.recon_sesudah_tgl is distinct from u.recon_sebelum_tgl
     or u.recon_sesudah_saldo is distinct from u.recon_sebelum_saldo then
    select * into b from public.banks where id = u.bank_id and account_id = p_account_id for update;
    if b.recon_last_saldo is not distinct from u.recon_sesudah_saldo
       and b.recon_last_date is not distinct from u.recon_sesudah_tgl then
      update public.banks
         set recon_last_saldo = u.recon_sebelum_saldo, recon_last_date = u.recon_sebelum_tgl
       where id = u.bank_id and account_id = p_account_id;
      v_recon := 'dikembalikan';
    else
      v_recon := 'sudah_berubah_lagi';
    end if;
  end if;

  update public.mutasi_unggahan
     set dibatalkan_at = now(),
         dibatalkan_oleh = p_oleh,
         catatan_batal = jsonb_build_object('baris_dihapus', v_hapus, 'cakupan_dihapus', v_cakupan, 'recon', v_recon)
   where id = u.id;

  return jsonb_build_object('ok', true, 'baris_dihapus', v_hapus, 'cakupan_dihapus', v_cakupan, 'recon', v_recon);
end;
$$;

revoke all on function public.batalkan_unggahan(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.batalkan_unggahan(uuid, uuid, uuid) to service_role;
revoke all on function public.mutasi_unggahan_sebelum_sisip() from public, anon, authenticated;
revoke all on function public.mutasi_unggahan_sebelum_ubah() from public, anon, authenticated;
