ALTER TABLE public.driver_background_checks
  ADD COLUMN IF NOT EXISTS checkr_report_assessment text,
  ADD COLUMN IF NOT EXISTS checkr_includes_canceled boolean;
