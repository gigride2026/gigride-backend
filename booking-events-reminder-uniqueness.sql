-- Prevent the same booking event type from being recorded more than once
-- for a single booking. This makes scheduled reminder stages idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS
  booking_events_booking_id_event_type_uidx
ON public.booking_events (booking_id, event_type);
