const express = require("express");
const router = express.Router();

const stripe = require("../utils/stripeClient.cjs");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

function normStatus(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w_]+/g, "");
}

async function getUserFromReq(req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.replace("Bearer ", "");

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) return null;

  return data.user;
}

router.post("/:bookingId/settle", async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const bookingId = String(req.params.bookingId || "").trim();
    if (!bookingId) {
      return res.status(400).json({ error: "booking id required" });
    }

    const {
      settlement_type,
      deduction_amount_cents = 0,
      reason = "",
      notes = "",
    } = req.body || {};

    const settlementType = String(settlement_type || "").trim();

    if (!["full_release", "partial_deduction", "full_forfeit"].includes(settlementType)) {
      return res.status(400).json({ error: "Invalid settlement_type" });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      return res.status(500).json({ error: bookingError.message });
    }

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (String(booking.host_id || "") !== String(user.id || "")) {
      return res.status(403).json({ error: "Only host can settle deposit" });
    }

    if (normStatus(booking.status) !== "completed") {
      return res.status(400).json({ error: "Deposit can only be settled after trip completion" });
    }

    if (!booking.deposit_paid) {
      return res.status(400).json({ error: "Deposit was not paid" });
    }

    if (booking.deposit_settled) {
      return res.status(400).json({ error: "Deposit already settled" });
    }

    const depositAmountCents = Number(booking.deposit_amount_cents || 0);
    if (depositAmountCents <= 0) {
      return res.status(400).json({ error: "Invalid deposit amount" });
    }

    const requestedDeduction = Math.max(0, Number(deduction_amount_cents || 0));

    let deductionAmountCents = 0;
    let refundAmountCents = 0;

    if (settlementType === "full_release") {
      deductionAmountCents = 0;
      refundAmountCents = depositAmountCents;
    } else if (settlementType === "partial_deduction") {
      if (requestedDeduction <= 0) {
        return res.status(400).json({ error: "Deduction amount required for partial_deduction" });
      }

      if (requestedDeduction >= depositAmountCents) {
        return res.status(400).json({
          error: "Deduction amount must be less than full deposit for partial_deduction",
        });
      }

      deductionAmountCents = requestedDeduction;
      refundAmountCents = depositAmountCents - deductionAmountCents;
    } else if (settlementType === "full_forfeit") {
      deductionAmountCents = depositAmountCents;
      refundAmountCents = 0;
    }

    const paymentIntentId =
      booking.stripe_payment_intent_id ||
      booking.stripe_payment_id ||
      null;

    if (!paymentIntentId) {
      return res.status(400).json({ error: "No Stripe payment intent found for deposit" });
    }

    let stripeRefund = null;

    if (refundAmountCents > 0) {
      stripeRefund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: refundAmountCents,
        metadata: {
          bookingId: booking.id,
          kind: "deposit_refund",
          settlementType,
          deductionAmountCents: String(deductionAmountCents),
        },
      });
    }

    const settledAt = new Date().toISOString();

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        deposit_refunded: refundAmountCents > 0,
        deposit_refunded_at: refundAmountCents > 0 ? settledAt : null,
        deposit_settled: true,
        deposit_settled_at: settledAt,
        deposit_deduction_amount_cents: deductionAmountCents,
        deposit_refund_amount_cents: refundAmountCents,
        deposit_settlement_type: settlementType,
        deposit_settlement_notes: notes || null,
      })
      .eq("id", booking.id)
      .select("*")
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    const adjustmentPayload = {
      booking_id: booking.id,
      host_id: booking.host_id,
      deposit_amount_cents: depositAmountCents,
      deduction_amount_cents: deductionAmountCents,
      refund_amount_cents: refundAmountCents,
      settlement_type: settlementType,
      reason: reason || null,
      notes: notes || null,
      stripe_refund_id: stripeRefund?.id || null,
    };

    const { data: adjustment, error: adjustmentError } = await supabaseAdmin
      .from("deposit_adjustments")
      .insert(adjustmentPayload)
      .select("*")
      .maybeSingle();

    if (adjustmentError) {
      return res.status(500).json({ error: adjustmentError.message });
    }

    return res.json({
      ok: true,
      booking: updatedBooking,
      adjustment,
      stripe_refund_id: stripeRefund?.id || null,
    });
  } catch (e) {
    console.error("💥 deposit settle route error:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

module.exports = router;