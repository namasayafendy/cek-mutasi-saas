-- Referral codes — owner/superadmin can create codes that grant rewards
-- (extend trial, future: discount %). Tracked per redemption for audit.

CREATE TABLE public.referral_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  description text,
  reward_type text NOT NULL CHECK (
    reward_type IN ('extend_trial_days', 'discount_pct', 'discount_rp', 'months_free')
  ),
  reward_value integer NOT NULL CHECK (reward_value > 0),
  max_uses integer,
  uses_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX referral_codes_code_unique
  ON public.referral_codes (lower(code))
  WHERE deleted_at IS NULL;

CREATE INDEX referral_codes_active_idx
  ON public.referral_codes (is_active)
  WHERE deleted_at IS NULL AND is_active = true;

CREATE TABLE public.referral_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES public.referral_codes(id),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  reward_type text NOT NULL,
  reward_value integer NOT NULL,
  applied_action jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

CREATE INDEX referral_redemptions_code_idx
  ON public.referral_redemptions (code_id);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "redemptions_select_own"
  ON public.referral_redemptions
  FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT account_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.referral_increment_uses_fn()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.referral_codes
    SET uses_count = uses_count + 1
    WHERE id = NEW.code_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_referral_increment_uses
  AFTER INSERT ON public.referral_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.referral_increment_uses_fn();
