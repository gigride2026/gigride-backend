// routes/bookingsCancel.cjs
const express = require("express");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Cancellation rules:
 * - Same-day (< 24h before start): refund 0%
 * - Host policy:
 *   flexible: >= 1 day => 50% refund
 *   moderate: >= 3 days => 75% refund
 *   strict:   >= 7 days => 100% refund
 *   same_day: always 0% refund
 * - Active trip cancellation: no refund (0%) (still cancel + mark status)
 */
function getRefundPercent(hoursBeforeStart, policy) {
  if (hoursBeforeStart < 24) return 0;

  switch (policy) {
    case "flexible":
      return 0.5; // >= 1 day
    case "moderate":
      return hoursBeforeStart >= 72 ? 0.75 : 0; // >= 3 days
    case "strict":
      return hoursBeforeStart >= 168 ? 1.0 : 0; // >= 7 days
    case "same_day":
    default:
      return 0;
  }
}

/**
 * Reads the Supabase user from bearer token.
 * (If you already have auth middleware, you can replace this.)
 */
async function getSupabaseUserFromRequest(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { user: null, token: null };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return { user: null, token };

  return { user: data.user, token };
}

/**
 * POST /api/bookings/:id/cancel
 * Body: { reason?: string }
 */
router.post("/api/bookings/:id/cancel", async (req, res) => {
  try {
    const bookingId = req.params.id;
    const reason = (req.body?.reason || "").toString().slice(0, 500);

    const { user } = await getSupabaseUserFromRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // 1) Load booking
    const { data: booking, error: bErr } = await supabaseAdmin
      .from("bookings")
      .select(
        "id,status,driver_id,host_id,vehicle_id,start_date,payment_intent_id,amount_paid_cents,total_amount_cents"
      )
      .eq("id", bookingId)
      .single();

    if (bErr || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // 2) Authorization: driver or host can cancel their own booking.
    const isDriver = booking.driver_id === user.id;
    const isHost = booking.host_id === user.id;
    if (!isDriver && !isHost) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const cancelledBy = isDriver ? "driver" : "host";

    // 3) Idempotency / terminal states
    if (["completed", "cancelled", "disputed"].includes(booking.status)) {
      return res.status(200).json({
        ok: true,
        booking_id: booking.id,
        status: booking.status,
        message: "No changes (terminal status).",
      });
    }

    // 4) Determine host policy (stored on vehicle)
    let policy = "moderate";
    if (booking.vehicle_id) {
      const { data: vehicle } = await supabaseAdmin
        .from("vehicles")
        .select("id,cancellation_policy")
        .eq("id", booking.vehicle_id)
        .single();

      if (vehicle?.cancellation_policy) policy = vehicle.cancellation_policy;
    }

    // 5) Compute hours before start
    const now = new Date();
    const start = booking.start_date ? new Date(booking.start_date) : null;

    const hoursBeforeStartRaw =
  start && !isNaN(start.getTime())
    ? (start.getTime() - now.getTime()) / (1000 * 60 * 60)
    : 0;

const hoursBeforeStart = Math.max(0, hoursBeforeStartRaw);


    // 6) Determine paid amount
    const paidCents =
      Number.isFinite(booking.amount_paid_cents) && booking.amount_paid_cents !== null
        ? Number(booking.amount_paid_cents)
        : Number.isFinite(booking.total_amount_cents) && booking.total_amount_cents !== null
        ? Number(booking.total_amount_cents)
        : 0;

    // 7) Refund percent rules
    let refundPercent = getRefundPercent(hoursBeforeStart, policy);
    if (booking.status === "active") refundPercent = 0; // active trip = no refund

    const refundCents = Math.max(0, Math.floor(paidCents * refundPercent));
    const feeCents = Math.max(0, paidCents - refundCents);

    // 8) Issue Stripe refund (if any)
    let refundResult = null;
    if (refundCents > 0 && booking.payment_intent_id) {
      refundResult = await stripe.refunds.create({
        payment_intent: booking.payment_intent_id,
        amount: refundCents,
        reason: "requested_by_customer",
        metadata: {
          booking_id: booking.id,
          cancelled_by: cancelledBy,
          policy,
        },
      });
    }

    // 9) Update booking status + cancellation details
    const { data: updated, error: uErr } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: now.toISOString(),
        cancelled_by: cancelledBy,
        cancellation_fee_cents: feeCents,
        refund_cents: refundCents,
        cancellation_reason: reason || null, // remove if you don't have this column
      })
      .eq("id", booking.id)
      .select("id,status,cancelled_at,cancelled_by,refund_cents,cancellation_fee_cents")
      .single();

    if (uErr) {
      return res.status(500).json({
        error: "Booking update failed",
        details: uErr.message,
        stripe_refund_id: refundResult?.id || null,
      });
    }

    // ✅ 10) Write audit event (NOW in the correct spot)
    // Non-blocking: if booking_events table/columns aren't ready, it won't break cancellation.
    try {
      await supabaseAdmin.from("booking_events").insert({
        booking_id: booking.id,
        event_type: "booking_cancelled",
        actor_role: cancelledBy, // "driver" or "host"
        actor_id: user.id,
        message: `Booking cancelled by ${cancelledBy}.`,
        metadata: {
          policy,
          hours_before_start: hoursBeforeStart,
          paid_cents: paidCents,
          refund_cents: refundCents,
          fee_cents: feeCents,
          stripe_refund_id: refundResult?.id || null,
          reason: reason || null,
          previous_status: booking.status,
        },
      });
    } catch (e) {
      console.log("booking_events insert failed:", e.message);
    }

    return res.json({
      ok: true,
      booking: updated,
      policy,
      hours_before_start: hoursBeforeStart,
      stripe_refund_id: refundResult?.id || null,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error", details: err.message });
  }
});

module.exports = router;


