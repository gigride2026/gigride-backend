const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * =========================================
 * GET /api/driver/deposit-breakdown/:bookingId
 * =========================================
 * Driver-facing, read-only
 */
router.get("/deposit-breakdown/:bookingId", async (req, res) => {
  const { bookingId } = req.params;

  const { data: booking, error } = await supabase
    .from("bookings")
    .select(`
      id,
      deposit_amount,
      damage_fee,
      cleaning_fee,
      other_fees,
      deposit_refund_amount,
      deposit_refunded,
      deposit_refunded_at,
      deductions_notes
    `)
    .eq("id", bookingId)
    .single();

  if (error || !booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  const depositAmount = booking.deposit_amount || 0;
  const damageFee = booking.damage_fee || 0;
  const cleaningFee = booking.cleaning_fee || 0;
  const otherFees = booking.other_fees || 0;

  const totalDeductions =
    damageFee + cleaningFee + otherFees;

  const refundedAmount =
    booking.deposit_refund_amount ?? 0;

  return res.json({
    booking_id: booking.id,

    deposit: {
      paid: depositAmount,
      refunded: refundedAmount,
      refunded_at: booking.deposit_refunded_at,
      status: booking.deposit_refunded
        ? "refunded"
        : "pending",
    },

    deductions: {
      damage_fee: damageFee,
      cleaning_fee: cleaningFee,
      other_fees: otherFees,
      total_deductions: totalDeductions,
      notes: booking.deductions_notes,
    },

    summary: {
      deposit_amount: depositAmount,
      total_deductions: totalDeductions,
      refund_amount: refundedAmount,
    },
  });
});

module.exports = router;