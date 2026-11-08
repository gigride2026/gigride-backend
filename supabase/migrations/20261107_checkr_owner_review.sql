CREATE OR REPLACE FUNCTION public.review_driver_screening(p_screening_id uuid, p_reviewer_id uuid, p_decision text, p_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_screening public.driver_background_checks%ROWTYPE;
  v_event_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_reviewer_id
      AND staff_role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Owner authorization required';
  END IF;

  IF p_decision IS NULL
     OR p_decision NOT IN ('approved', 'adverse_action_pending') THEN
    RAISE EXCEPTION 'Invalid review decision';
  END IF;

  IF p_notes IS NULL OR length(btrim(p_notes)) = 0 THEN
    RAISE EXCEPTION 'Review notes are required';
  END IF;

  SELECT *
  INTO v_screening
  FROM public.driver_background_checks
  WHERE id = p_screening_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Screening not found';
  END IF;

  IF v_screening.fee_payment_status IS DISTINCT FROM 'paid'
     OR v_screening.status IS DISTINCT FROM 'review_required'
     OR v_screening.checkr_report_status IS DISTINCT FROM 'complete'
     OR v_screening.checkr_includes_canceled IS DISTINCT FROM false
     OR v_screening.report_conflict_hold IS DISTINCT FROM false
     OR NULLIF(btrim(v_screening.checkr_report_id), '') IS NULL
     OR NOT (
       v_screening.checkr_report_assessment = 'review'
       OR (
         v_screening.checkr_report_assessment IS NULL
         AND v_screening.checkr_report_result = 'consider'
       )
     ) THEN
    RAISE EXCEPTION 'Screening is not eligible for owner review';
  END IF;

  IF v_screening.review_decision IS NOT NULL THEN
    RAISE EXCEPTION 'Screening already has a review decision';
  END IF;

  UPDATE public.driver_background_checks
  SET
    review_decision = p_decision,
    reviewed_by = p_reviewer_id,
    reviewed_at = pg_catalog.now(),
    review_notes = btrim(p_notes)
  WHERE id = p_screening_id;

  INSERT INTO public.driver_screening_review_events (
    screening_id,
    reviewed_by,
    decision,
    notes
  )
  VALUES (
    p_screening_id,
    p_reviewer_id,
    p_decision,
    btrim(p_notes)
  )
  RETURNING id INTO v_event_id;

  RETURN pg_catalog.jsonb_build_object(
    'screening_id', p_screening_id,
    'decision', p_decision,
    'audit_event_id', v_event_id
  );
END;
$function$;
