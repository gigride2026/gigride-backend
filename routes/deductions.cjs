const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * =========================================
 * POST /api/payments/apply-deductions
 * =========================================
 * body:
 * {
 *   booking_id: string,
 *   damage_fee?: number,
 *   cleaning_fee?: number,
 *   other_fees?: number,
 *   notes?: string
 * }
 */
router.post("/apply-deductions", async (req, res) => {
  const {
    booking_id,
    damage_fee = 0,
    cleaning_fee = 0,
    other_fees = 0,
    notes = null,
  } = req.body;

  if (!booking_id) {
    return res.status(400).json({ error: "booking_id is required" });
  }

  const totalDeductions =
    Number(damage_fee) +
    Number(cleaning_fee) +
    Number(other_fees);

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();

  if (error || !booking) {
    return res.status(404).json({ error: "Booking not found" });
  }

  if (!booking.deposit_paid) {
    return res.status(400).json({ error: "Deposit not paid" });
  }

  if (booking.deposit_refunded) {
    return res.status(400).json({ error: "Deposit already refunded" });
  }

  await supabase
    .from("bookings")
    .update({
      damage_fee,
      cleaning_fee,
      other_fees,
      deductions_notes: notes,
    })
    .eq("id", booking_id);

  return res.json({
    success: true,
    total_deductions: totalDeductions,
  });
});

module.exports = router;
