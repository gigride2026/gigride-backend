require("dotenv").config();
const Stripe = require("stripe");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyUser } = require("../services/notify.cjs");

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-11-17.clover",
});

async function releaseDepositRefunds() {
  try {
    const nowIso = new Date().toISOString();

    console.log("💸 releaseDepositRefunds job started at:", nowIso);

    const { data: bookings, error: fetchError } = await supabaseAdmin
      .from("bookings")
      .select(
  `
  id,
  driver_id,
  status,
  deposit_paid,
  deposit_refunded,
  deposit_hold_until,
  dispute_status,
  deposit_refund_amount_cents,
  deposit_stripe_payment_intent_id
`
)
      .eq("status", "completed")
      .eq("deposit_paid", true)
      .eq("deposit_refunded", false)
      .lte("deposit_hold_until", nowIso)
      .order("deposit_hold_until", { ascending: true });

    if (fetchError) {
      console.error("❌ Failed to fetch refundable deposits:", fetchError);
      return {
        ok: false,
        error: fetchError.message,
      };
    }

    const rows = Array.isArray(bookings) ? bookings : [];

    console.log(`🔎 Found ${rows.length} booking(s) eligible for deposit refund`);

    if (rows.length === 0) {
      return {
        ok: true,
        refunded: 0,
        failed: 0,
        skipped: 0,
      };
    }

    let refunded = 0;
    let failed = 0;
    let skipped = 0;

    for (const booking of rows) {
      const bookingId = String(booking.id || "").trim();

      if (!bookingId) {
        failed += 1;
        continue;
      }

      if (String(booking.dispute_status || "none").toLowerCase() !== "none") {
        skipped += 1;
        console.log(`⏸️ Skipping booking ${bookingId} because it is on hold/disputed`);
        continue;
      }

      const refundAmountCents = Number(booking.deposit_refund_amount_cents || 0);
      if (!Number.isFinite(refundAmountCents) || refundAmountCents <= 0) {
        skipped += 1;
        console.log(`⏸️ Skipping booking ${bookingId} because refundable amount is 0`);
        continue;
      }

      if (!booking.deposit_stripe_payment_intent_id) {
        failed += 1;
        console.error(`❌ Missing deposit payment intent for booking ${bookingId}`);
        continue;
      }

      try {
        const refund = await stripe.refunds.create({
          payment_intent: booking.deposit_stripe_payment_intent_id,
          amount: refundAmountCents,
        });

        const refundedAt = new Date().toISOString();

        const { data: updated, error: updateError } = await supabaseAdmin
          .from("bookings")
          .update({
            deposit_refunded: true,
            deposit_refunded_at: refundedAt,
            deposit_refund_amount_cents: refundAmountCents,
          })
          .eq("id", bookingId)
          .eq("deposit_refunded", false)
          .select("id, deposit_refunded, deposit_refunded_at, deposit_refund_amount_cents")
          .maybeSingle();

        if (updateError || !updated) {
          failed += 1;
          console.error(`❌ Failed to mark deposit refunded for booking ${bookingId}:`, updateError);
          continue;
        }

        refunded += 1;
console.log(`✅ Deposit refunded for booking ${bookingId}:`, {
  refundId: refund.id,
  amount: refund.amount,
});

const { data: profile } = await supabaseAdmin
  .from("profiles")
  .select("expo_push_token")
  .eq("id", booking.driver_id)
  .maybeSingle();

await notifyUser(
  profile?.expo_push_token,
  "Deposit refunded",
  `Your deposit refund of $${(refundAmountCents / 100).toFixed(2)} was sent.`,
  {
    bookingId,
    type: "deposit_refunded",
  }
);
      } catch (err) {
        failed += 1;
        console.error(`❌ Stripe refund failed for booking ${bookingId}:`, err);
      }
    }

    console.log("🏁 releaseDepositRefunds job finished", {
      refunded,
      failed,
      skipped,
    });

    return {
      ok: true,
      refunded,
      failed,
      skipped,
    };
  } catch (e) {
    console.error("💥 releaseDepositRefunds job crashed:", e);
    return {
      ok: false,
      error: e.message || "Unknown error",
    };
  }
}

module.exports = { releaseDepositRefunds };