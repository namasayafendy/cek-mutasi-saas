-- Phase 9.1: Named Match Rules preset
-- Tiap account punya unlimited preset rules (mis. "QRIS", "EDC Settle", "Manual Transfer")
-- Tiap input di cek_inputs link ke 1 preset → matching pakai aturan preset itu

CREATE TABLE public.match_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  jenis text NOT NULL DEFAULT 'both', -- 'kredit' | 'debet' | 'both'
  lookback_days int NOT NULL DEFAULT 3,
  forward_window_days int NOT NULL DEFAULT 0,
  match_mode text NOT NULL DEFAULT 'exact', -- 'exact' | 'tol_rp' | 'tol_pct'
  tolerance_rp int NOT NULL DEFAULT 0,
  tolerance_pct numeric(5,2) NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_jenis CHECK (jenis IN ('kredit', 'debet', 'both')),
  CONSTRAINT valid_match_mode CHECK (match_mode IN ('exact', 'tol_rp', 'tol_pct')),
  CONSTRAINT valid_lookback CHECK (lookback_days >= 0 AND lookback_days <= 90),
  CONSTRAINT valid_forward CHECK (forward_window_days >= 0 AND forward_window_days <= 90),
  CONSTRAINT valid_tol_rp CHECK (tolerance_rp >= 0),
  CONSTRAINT valid_tol_pct CHECK (tolerance_pct >= 0 AND tolerance_pct <= 100),
  CONSTRAINT unique_active_name UNIQUE NULLS NOT DISTINCT (account_id, name, deleted_at)
);

CREATE INDEX match_rules_account_idx ON public.match_rules(account_id) WHERE deleted_at IS NULL;

ALTER TABLE public.match_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "match_rules_select_own" ON public.match_rules FOR SELECT
  USING (account_id = public.current_account_id());
CREATE POLICY "match_rules_owner_manage" ON public.match_rules FOR ALL
  USING (account_id = public.current_account_id() AND public.current_team_role() = 'owner')
  WITH CHECK (account_id = public.current_account_id() AND public.current_team_role() = 'owner');

ALTER TABLE public.cek_inputs
  ADD COLUMN IF NOT EXISTS match_rule_id uuid REFERENCES public.match_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cek_inputs_match_rule_idx ON public.cek_inputs(match_rule_id) WHERE match_rule_id IS NOT NULL;

-- Auto-migrate existing accounts: bikin Default Kredit + Default Debet dari account_settings
INSERT INTO public.match_rules (account_id, name, jenis, lookback_days, forward_window_days, match_mode, tolerance_rp, tolerance_pct, is_default)
SELECT
  account_id,
  'Default Kredit',
  'kredit',
  COALESCE(lookback_days_kredit, 3),
  COALESCE(forward_window_days_kredit, 0),
  COALESCE(match_mode_kredit, 'exact'),
  COALESCE(match_tolerance_rp_kredit, 0),
  COALESCE(match_tolerance_pct_kredit, 0),
  true
FROM public.account_settings
ON CONFLICT DO NOTHING;

INSERT INTO public.match_rules (account_id, name, jenis, lookback_days, forward_window_days, match_mode, tolerance_rp, tolerance_pct, is_default)
SELECT
  account_id,
  'Default Debet',
  'debet',
  COALESCE(lookback_days_debet, 3),
  COALESCE(forward_window_days_debet, 0),
  COALESCE(match_mode_debet, 'exact'),
  COALESCE(match_tolerance_rp_debet, 0),
  COALESCE(match_tolerance_pct_debet, 0),
  true
FROM public.account_settings
ON CONFLICT DO NOTHING;

-- Update signup trigger supaya auto-create 2 default preset untuk new account
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_account_id uuid;
  existing_count int;
  invited_account uuid;
BEGIN
  SELECT COUNT(*) INTO existing_count FROM public.team_members WHERE user_id = NEW.id;
  IF existing_count > 0 THEN
    UPDATE public.team_members SET joined_at = COALESCE(joined_at, now()) WHERE user_id = NEW.id;
    RETURN NEW;
  END IF;

  invited_account := NULLIF(NEW.raw_user_meta_data->>'invited_to_account_id', '')::uuid;

  IF invited_account IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.accounts WHERE id = invited_account) THEN
      INSERT INTO public.team_members (account_id, user_id, role, invited_at, joined_at)
      VALUES (invited_account, NEW.id, 'staff', now(), NULL);
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.accounts (owner_user_id, status, trial_ends_at)
  VALUES (NEW.id, 'trial', now() + interval '7 days')
  RETURNING id INTO new_account_id;

  INSERT INTO public.team_members (account_id, user_id, role, joined_at)
  VALUES (new_account_id, NEW.id, 'owner', now());

  INSERT INTO public.account_settings (account_id) VALUES (new_account_id);

  INSERT INTO public.match_rules (account_id, name, jenis, is_default) VALUES
    (new_account_id, 'Default Kredit', 'kredit', true),
    (new_account_id, 'Default Debet', 'debet', true);

  RETURN NEW;
END;
$$;
