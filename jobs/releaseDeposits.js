import Stripe from "stripe";
import dotenv from "dotenv";
import supabaseAdmin from "../utils/supabaseClient.cjs";

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

const RELEASE_DAYS = Number(process.env.DEPOSIT_RELEASE_DAYS || 3);

export default async function releaseDeposits() {
  console.log("🕒 Running deposit release job");

  const releaseBefore = new Date();
  releaseBefore.setDate(releaseBefore.getDate() - RELEASE_DAYS);

  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select(`
      id,
      deposit_amount_cents,
      damage_fee_cents,
      cleaning_fee_cents,
      other_fee_cents,
      mileage_overage_cents,
      stripe_payment_intent_id
    `)
    .eq("deposit_paid", true)
    .eq("refund_status", "pending")
    .lte("completed_at", releaseBefore.toISOString());

  if (error) {
    console.error("❌ Failed to fetch bookings:", error);
    return;
  }

  for (const booking of bookings || []) {
    const depositAmount = Number(booking.deposit_amount_cents || 0);
    const damageFees = Number(booking.damage_fee_cents || 0);
    const cleaningFees = Number(booking.cleaning_fee_cents || 0);
    const otherFees = Number(booking.other_fee_cents || 0);
    const mileageFees = Number(booking.mileage_overage_cents || 0);

    const deductions =
  (booking.damage_fee_cents || 0) +
  (booking.cleaning_fee_cents || 0) +
  (booking.smoking_fee_cents || 0) +
  (booking.other_fee_cents || 0) +
  (booking.mileage_overage_cents || 0);

    const refundAmount = Math.max(depositAmount - deductions, 0);

    if (!booking.stripe_payment_intent_id) {
      console.log("⚠️ Missing payment_intent:", booking.id);
      continue;
    }

    try {
      if (refundAmount === 0) {
        await supabaseAdmin
          .from("bookings")
          .update({
            refund_status: "no_refund_due",
            refund_amount_cents: 0,
            total_deductions_cents: deductions,
            refunded_at: new Date().toISOString(),
          })
          .eq("id", booking.id);

        console.log("⚠️ No refundable amount:", booking.id);
        continue;
      }

      const refund = await stripe.refunds.create({
        payment_intent: booking.stripe_payment_intent_id,
        amount: refundAmount,
      });

      await supabaseAdmin
        .from("bookings")
        .update({
          refund_status: "refunded",
          refund_amount_cents: refundAmount,
          total_deductions_cents: deductions,
          refunded_at: new Date().toISOString(),
          stripe_refund_id: refund.id,
        })
        .eq("id", booking.id);

      console.log("✅ Deposit refunded:", booking.id, refundAmount);
    } catch (err) {
      console.error("❌ Refund failed:", booking.id, err.message);
    }
  }
}
