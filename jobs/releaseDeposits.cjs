const Stripe = require("stripe");
require("dotenv").config();

const supabaseAdmin = require("../utils/supabaseClient.cjs");

/**
 * ===============================
 * INIT STRIPE
 * ===============================
 */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

/**
 * ===============================
 * CONFIG
 * ===============================
 */
const RELEASE_DAYS = Number(process.env.DEPOSIT_RELEASE_DAYS || 3);

/**
 * ===============================
 * RELEASE DEPOSITS JOB
 * ===============================
 */
async function releaseDeposits() {
  console.log("🚀 releaseDeposits() FUNCTION STARTED");
  console.log("🔄 Running automatic deposit release job");

  // Calculate cutoff date
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RELEASE_DAYS);

  /**
   * ===============================
   * FIND ELIGIBLE BOOKINGS
   * ===============================
   */
  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select(`
      id,
      deposit_amount,
      damage_fee_cents,
      cleaning_fee_cents,
      other_fee_cents,
      stripe_payment_intent_id,
      refund_status,
      completed_at
    `)
    .eq("deposit_paid", true)
    .neq("refund_status", "refunded")
    .lte("completed_at", cutoff.toISOString());

  if (error) {
    console.error("❌ Failed to fetch bookings:", error);
    return;
  }

  console.log(`📦 Found ${bookings.length} bookings to refund`);

  /**
   * ===============================
   * PROCESS EACH BOOKING
   * ===============================
   */
  for (const booking of bookings) {
    try {
      if (!booking.stripe_payment_intent_id) {
        console.error("❌ Missing payment_intent:", booking.id);
        continue;
      }

      const damage = booking.damage_fee_cents || 0;
      const cleaning = booking.cleaning_fee_cents || 0;
      const other = booking.other_fee_cents || 0;

      const totalDeductions = damage + cleaning + other;
      const refundAmount = booking.deposit_amount - totalDeductions;

      if (refundAmount <= 0) {
        console.log("⚠️ No refundable amount:", booking.id);
        continue;
      }

      /**
       * ===============================
       * CREATE STRIPE REFUND
       * ===============================
       */
      const refund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        amount: refundAmount,
      });

      console.log(
        "💳 Stripe refund created:",
        refund.id,
        "Amount:",
        refundAmount
      );

      /**
       * ===============================
       * UPDATE BOOKING (WEBHOOK FINALIZES)
       * ===============================
       */
      const { error: updateError } = await supabaseAdmin
        .from("bookings")
        .update({
          refund_status: "pending",
          refund_amount_cents: refundAmount,
          total_deductions_cents: totalDeductions,
        })
        .eq("id", booking.id);

      if (updateError) {
        console.error(
          "❌ Failed to mark booking pending refund:",
          booking.id,
          updateError
        );
      }
    } catch (err) {
      // Handle already-refunded Stripe charges safely
      if (
        err?.message &&
        err.message.includes("has already been refunded")
      ) {
        console.warn(
          "⚠️ Already refunded in Stripe, syncing DB:",
          booking.id
        );

        await supabaseAdmin
          .from("bookings")
          .update({
            refund_status: "refunded",
            refunded_at: new Date().toISOString(),
          })
          .eq("id", booking.id);
      } else {
        console.error("❌ Refund failed:", booking.id, err.message);
      }
    }
  }

  console.log("✅ Deposit release job finished");
}

module.exports = releaseDeposits;

