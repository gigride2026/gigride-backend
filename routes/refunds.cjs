const express = require("express");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post("/refund-deposit", async (req, res) => {
  try {
    const { booking_id, amount } = req.body || {};

    if (!booking_id) {
      return res.status(400).json({ error: "booking_id is required" });
    }

    const { data: booking, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();

    if (error || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (String(booking.status || "").toLowerCase() !== "completed") {
      return res.status(400).json({ error: "Booking must be completed" });
    }

    if (!booking.deposit_paid) {
      return res.status(400).json({ error: "Deposit not paid" });
    }

    if (booking.deposit_refunded) {
      return res.status(400).json({ error: "Deposit already refunded" });
    }

    if (String(booking.dispute_status || "none").toLowerCase() !== "none") {
      return res.status(400).json({
        error: "Deposit is currently on hold/disputed",
      });
    }

    if (booking.deposit_hold_until) {
      const holdUntil = new Date(booking.deposit_hold_until).getTime();
      if (!Number.isNaN(holdUntil) && holdUntil > Date.now()) {
        return res.status(400).json({
          error: "Deposit hold window has not expired",
        });
      }
    }

    if (!booking.deposit_stripe_payment_intent_id) {
      return res.status(400).json({
        error: "No deposit Stripe payment intent found",
      });
    }

    const refundAmountCents =
      Number.isFinite(Number(amount)) && Number(amount) > 0
        ? Number(amount)
        : Math.max(Number(booking.deposit_refund_amount_cents || 0), 0);

    if (!refundAmountCents) {
      return res.status(400).json({
        error: "No refundable deposit amount available",
      });
    }

    const refund = await stripe.refunds.create({
      payment_intent: booking.deposit_stripe_payment_intent_id,
      amount: refundAmountCents,
    });

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        deposit_refunded: true,
        deposit_refunded_at: new Date().toISOString(),
        deposit_refund_amount_cents: refundAmountCents,
      })
      .eq("id", booking_id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.json({
      ok: true,
      refund_id: refund.id,
      amount_refunded_cents: refund.amount,
    });
  } catch (err) {
    console.error("❌ Refund failed:", err);
    return res.status(500).json({ error: err.message || "Refund failed" });
  }
});

module.exports = router;
