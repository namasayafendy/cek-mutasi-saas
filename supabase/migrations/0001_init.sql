-- ============================================================
-- Cek Mutasi SaaS — Initial Commercial Schema
-- 12 tables, multi-tenant via account_id with RLS
-- ============================================================

-- 1. accounts (tenant)
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan text NOT NULL DEFAULT 'starter',
  status text NOT NULL DEFAULT 'trial',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  brand_name text,
  support_email text,
  support_wa text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('trial','active','suspended','cancelled'))
);

-- 2. team_members
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff',
  invited_at timestamptz,
  joined_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_role CHECK (role IN ('owner','staff')),
  UNIQUE(account_id, user_id)
);

CREATE INDEX team_members_user_idx ON public.team_members(user_id);
CREATE INDEX team_members_account_idx ON public.team_members(account_id);

-- Helper functions for RLS (current_role is reserved in Postgres, use current_team_role)
CREATE OR REPLACE FUNCTION public.current_account_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id FROM public.team_members WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_team_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.team_members WHERE user_id = auth.uid() LIMIT 1
$$;

-- 3. banks
CREATE TABLE public.banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  kode text NOT NULL,
  label text,
  parser_id text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  urutan int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX banks_account_idx ON public.banks(account_id);

-- 4. outlets
CREATE TABLE public.outlets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  nama text NOT NULL,
  warna_hex text NOT NULL,
  urutan_palette int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outlets_account_idx ON public.outlets(account_id);

-- 5. account_settings
CREATE TABLE public.account_settings (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  lookback_days_kredit int NOT NULL DEFAULT 3,
  forward_window_days_kredit int NOT NULL DEFAULT 0,
  match_mode_kredit text NOT NULL DEFAULT 'exact',
  match_tolerance_rp_kredit int NOT NULL DEFAULT 0,
  match_tolerance_pct_kredit numeric(5,2) NOT NULL DEFAULT 0,
  last_input_date_kredit date,
  lookback_days_debet int NOT NULL DEFAULT 3,
  forward_window_days_debet int NOT NULL DEFAULT 0,
  match_mode_debet text NOT NULL DEFAULT 'exact',
  match_tolerance_rp_debet int NOT NULL DEFAULT 0,
  match_tolerance_pct_debet numeric(5,2) NOT NULL DEFAULT 0,
  last_input_date_debet date,
  debet_highlight_same_color boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_match_mode_kredit CHECK (match_mode_kredit IN ('exact','tol_rp','tol_pct')),
  CONSTRAINT valid_match_mode_debet CHECK (match_mode_debet IN ('exact','tol_rp','tol_pct'))
);

-- 6. cek_sessions
CREATE TABLE public.cek_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  jenis text NOT NULL,
  period_mutasi_start date,
  period_mutasi_end date,
  total_input int DEFAULT 0,
  total_matched int DEFAULT 0,
  total_unmatched int DEFAULT 0,
  total_conflict int DEFAULT 0,
  total_nominal_input bigint DEFAULT 0,
  total_nominal_matched bigint DEFAULT 0,
  carry_over_used boolean DEFAULT false,
  multi_bank_used boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT valid_jenis CHECK (jenis IN ('kredit','debet'))
);

CREATE INDEX cek_sessions_account_idx ON public.cek_sessions(account_id, created_at DESC);
CREATE INDEX cek_sessions_user_idx ON public.cek_sessions(account_id, user_id, created_at DESC);

-- 7. pdf_uploads
CREATE TABLE public.pdf_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.cek_sessions(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE RESTRICT,
  file_name text,
  page_count int,
  transaction_count int,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pdf_uploads_session_idx ON public.pdf_uploads(session_id);

-- 8. parsed_transactions
CREATE TABLE public.parsed_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  no_ref text,
  tanggal date NOT NULL,
  jam text,
  nominal_kredit bigint DEFAULT 0,
  nominal_debet bigint DEFAULT 0,
  nama_pengirim text,
  nama_penerima text,
  deskripsi text,
  saldo bigint,
  page int,
  bbox_y_bottom numeric,
  bbox_height numeric,
  fingerprint text,
  claimed_by_input_id uuid,
  claimed_at timestamptz,
  manual_claim_reason text,
  first_seen_session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX parsed_tx_uniq_noref ON public.parsed_transactions(account_id, bank_id, no_ref) WHERE no_ref IS NOT NULL;
CREATE UNIQUE INDEX parsed_tx_uniq_fingerprint ON public.parsed_transactions(account_id, bank_id, fingerprint) WHERE no_ref IS NULL AND fingerprint IS NOT NULL;
CREATE INDEX parsed_tx_account_bank_tanggal ON public.parsed_transactions(account_id, bank_id, tanggal);
CREATE INDEX parsed_tx_account_unclaimed ON public.parsed_transactions(account_id, claimed_by_input_id) WHERE claimed_by_input_id IS NULL;

-- 9. cek_inputs
CREATE TABLE public.cek_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.cek_sessions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  tanggal_input date NOT NULL,
  outlet_id uuid REFERENCES public.outlets(id) ON DELETE SET NULL,
  bank_id uuid REFERENCES public.banks(id) ON DELETE SET NULL,
  nominal bigint NOT NULL,
  jenis text NOT NULL,
  match_status text,
  matched_tx_id uuid REFERENCES public.parsed_transactions(id) ON DELETE SET NULL,
  conflict_count int,
  conflict_dates jsonb,
  manual_claim_reason text,
  manual_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_jenis_input CHECK (jenis IN ('kredit','debet')),
  CONSTRAINT valid_match_status CHECK (match_status IN ('matched','no_candidate','all_taken','manual_claimed') OR match_status IS NULL)
);

CREATE INDEX cek_inputs_session_idx ON public.cek_inputs(session_id);
CREATE INDEX cek_inputs_account_idx ON public.cek_inputs(account_id, created_at DESC);

ALTER TABLE public.parsed_transactions
  ADD CONSTRAINT parsed_tx_claimed_by_fk FOREIGN KEY (claimed_by_input_id)
  REFERENCES public.cek_inputs(id) ON DELETE SET NULL;

ALTER TABLE public.parsed_transactions
  ADD CONSTRAINT parsed_tx_first_seen_fk FOREIGN KEY (first_seen_session_id)
  REFERENCES public.cek_sessions(id) ON DELETE SET NULL;

-- 10. audit_logs
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_account_idx ON public.audit_logs(account_id, created_at DESC);

-- 11. subscription_invoices
CREATE TABLE public.subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  midtrans_order_id text,
  midtrans_transaction_id text,
  paid_at timestamptz,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_inv_status CHECK (status IN ('pending','paid','failed','refunded'))
);

CREATE INDEX subscription_invoices_account_idx ON public.subscription_invoices(account_id, period_start DESC);

-- ========== Auto-create account on owner signup ==========
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_account_id uuid;
  existing_count int;
BEGIN
  SELECT COUNT(*) INTO existing_count FROM public.team_members WHERE user_id = NEW.id;
  IF existing_count > 0 THEN
    UPDATE public.team_members SET joined_at = COALESCE(joined_at, now()) WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  INSERT INTO public.accounts (owner_user_id, status, trial_ends_at)
  VALUES (NEW.id, 'trial', now() + interval '7 days')
  RETURNING id INTO new_account_id;

  INSERT INTO public.team_members (account_id, user_id, role, joined_at)
  VALUES (new_account_id, NEW.id, 'owner', now());

  INSERT INTO public.account_settings (account_id) VALUES (new_account_id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ========== RLS ==========
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cek_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parsed_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cek_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;

-- accounts
CREATE POLICY "accounts_select_own" ON public.accounts FOR SELECT
  USING (id = public.current_account_id());
CREATE POLICY "accounts_update_owner" ON public.accounts FOR UPDATE
  USING (id = public.current_account_id() AND public.current_team_role() = 'owner')
  WITH CHECK (id = public.current_account_id());

-- team_members
CREATE POLICY "team_members_select_own" ON public.team_members FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "team_members_owner_manage" ON public.team_members FOR ALL
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner')
  WITH CHECK (account_id = public.current_account_id());

-- banks
CREATE POLICY "banks_select_own" ON public.banks FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "banks_owner_manage" ON public.banks FOR ALL
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner')
  WITH CHECK (account_id = public.current_account_id());

-- outlets
CREATE POLICY "outlets_select_own" ON public.outlets FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "outlets_owner_manage" ON public.outlets FOR ALL
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner')
  WITH CHECK (account_id = public.current_account_id());

-- account_settings
CREATE POLICY "account_settings_select_own" ON public.account_settings FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "account_settings_owner_manage" ON public.account_settings FOR ALL
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner')
  WITH CHECK (account_id = public.current_account_id());

-- cek_sessions
CREATE POLICY "cek_sessions_select_own" ON public.cek_sessions FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "cek_sessions_insert_own" ON public.cek_sessions FOR INSERT
  WITH CHECK (account_id = public.current_account_id() AND user_id = auth.uid());
CREATE POLICY "cek_sessions_update_own" ON public.cek_sessions FOR UPDATE
  USING (account_id = public.current_account_id() AND user_id = auth.uid())
  WITH CHECK (account_id = public.current_account_id());
CREATE POLICY "cek_sessions_delete_owner" ON public.cek_sessions FOR DELETE
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner');

-- pdf_uploads
CREATE POLICY "pdf_uploads_select_own" ON public.pdf_uploads FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.cek_sessions s WHERE s.id = session_id AND s.account_id = public.current_account_id()));
CREATE POLICY "pdf_uploads_insert_own" ON public.pdf_uploads FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.cek_sessions s WHERE s.id = session_id AND s.account_id = public.current_account_id()));

-- parsed_transactions
CREATE POLICY "parsed_tx_select_own" ON public.parsed_transactions FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "parsed_tx_insert_own" ON public.parsed_transactions FOR INSERT
  WITH CHECK (account_id = public.current_account_id());
CREATE POLICY "parsed_tx_update_own" ON public.parsed_transactions FOR UPDATE
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());
CREATE POLICY "parsed_tx_delete_owner" ON public.parsed_transactions FOR DELETE
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner');

-- cek_inputs
CREATE POLICY "cek_inputs_select_own" ON public.cek_inputs FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "cek_inputs_insert_own" ON public.cek_inputs FOR INSERT
  WITH CHECK (account_id = public.current_account_id());
CREATE POLICY "cek_inputs_update_own" ON public.cek_inputs FOR UPDATE
  USING (account_id = public.current_account_id())
  WITH CHECK (account_id = public.current_account_id());
CREATE POLICY "cek_inputs_delete_own" ON public.cek_inputs FOR DELETE
  USING (account_id = public.current_account_id());

-- audit_logs
CREATE POLICY "audit_logs_select_own" ON public.audit_logs FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "audit_logs_insert_own" ON public.audit_logs FOR INSERT
  WITH CHECK (account_id = public.current_account_id());

-- subscription_invoices (owner only)
CREATE POLICY "subscription_invoices_select_owner" ON public.subscription_invoices FOR SELECT
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner');
