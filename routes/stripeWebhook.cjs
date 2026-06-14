// routes/stripeWebhook.cjs
console.log("🪝 stripeWebhook loaded:", __filename);

const express = require("express");
const router = express.Router();
const { notifyUser, notifyAdmin } = require("../utils/pushNotifications.cjs");

const stripe = require("../utils/stripeClient.cjs");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");


// IMPORTANT: Stripe needs the raw body to verify signature
router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const sig = req.headers["stripe-signature"];
      const secret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!secret) {
        console.error("❌ Missing STRIPE_WEBHOOK_SECRET in .env");
        return res.status(500).send("Missing webhook secret");
      }

      if (!sig) {
        console.error("❌ Missing stripe-signature header");
        return res.status(400).send("Missing stripe-signature");
      }

      let event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
      } catch (err) {
        console.error("❌ Webhook signature verification failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      console.log("✅ Webhook verified:", event.type);
      if (event.type === "identity.verification_session.verified") {
  const session = event.data.object;
  const userId = session?.metadata?.user_id;
  const email = session?.metadata?.email;

  if (userId) {
    await supabaseAdmin
      .from("profiles")
      .update({
        identity_status: "verified",
        identity_verified_at: new Date().toISOString(),
      })
      .eq("id", userId);

    await notifyUser({
      supabaseAdmin,
      userId,
      title: "Identity verified ✅",
      body: "Your GigRide identity verification is complete.",
      data: {
        type: "identity_verified",
        user_id: userId,
      },
    });

    await notifyAdmin({
      supabaseAdmin,
      title: "Identity verification completed 🪪",
      body: `${email || "A user"} completed identity verification.`,
      data: {
        type: "identity_verified",
        user_id: userId,
      },
    });

    console.log("✅ Identity verification pushes sent:", userId);
  }
}

      
  if (event.type === "checkout.session.completed") {
  const session = event.data.object;

  const bookingId =
    session?.metadata?.booking_id || session?.metadata?.bookingId;

  const kind =
    session?.metadata?.payment_type || session?.metadata?.kind;

  console.log("🧾 checkout.session.completed metadata:", session?.metadata);
  console.log("🧾 bookingId:", bookingId);
  console.log("🧾 kind:", kind);
  console.log("🧾 session.id:", session?.id);
  console.log("🧾 payment_intent:", session?.payment_intent);
  console.log("🧾 full event type hit:", event.type);

        // ---- Deposit paid handler ----
        if (kind === "deposit" && bookingId) {
          console.log("💰 Deposit webhook matched booking:", bookingId);

          const { data: beforeBooking, error: beforeError } = await supabaseAdmin
            .from("bookings")
            .select(
  "id,host_id,driver_id,status,deposit_paid,deposit_paid_at,payment_status,stripe_checkout_session_id,deposit_stripe_payment_intent_id"
)
            
            .eq("id", bookingId)
            .maybeSingle();

          console.log("🔎 BEFORE deposit update:", {
            beforeBooking,
            beforeError,
          });

          const now = new Date().toISOString();

          const { data: updatedBooking, error } = await supabaseAdmin
            .from("bookings")
            .update({
              status: "deposit_paid",
              deposit_paid: true,
              deposit_paid_at: now,
              payment_status: "unpaid",
              stripe_payment_id: session?.payment_intent || null,
              stripe_checkout_session_id: session?.id || null,
              deposit_stripe_payment_intent_id:
                session?.payment_intent || null,
            })
            .eq("id", bookingId)
            .select(
  "id,host_id,driver_id,status,deposit_paid,deposit_paid_at,payment_status,stripe_checkout_session_id,deposit_stripe_payment_intent_id"
)
            .maybeSingle();

            if (updatedBooking?.host_id) {
  try {
    console.log("🔔 SENDING DEPOSIT PAID PUSH TO HOST:", updatedBooking.host_id);

    await notifyUser({
      supabaseAdmin,
      userId: updatedBooking.host_id,
      title: "💰 Deposit Paid",
body: "The driver paid the deposit. You can prepare for pickup.",
      data: {
        type: "deposit_paid",
        bookingId: updatedBooking.id,
      },
    });

    console.log("✅ PUSH SENT");
  } catch (pushErr) {
    console.log("❌ PUSH FAILED:", pushErr);
  }
}

          console.log("🔎 AFTER deposit update:", {
  updatedBooking,
  error,
});

          if (error) {
            console.error("❌ Deposit booking update failed:", error);
            return res.json({ received: true, ok: false, error: error.message });
          }

          if (!updatedBooking) {
            console.warn("⚠️ Deposit webhook found no matching booking:", bookingId);

            const { data: existing, error: existingError } = await supabaseAdmin
              .from("bookings")
              .select("*")
              .eq("id", bookingId)
              .maybeSingle();

            console.log("🔎 Existing booking after failed deposit update:", {
              existing,
              existingError,
            });

            return res.json({ received: true, ok: true, skipped: true });
          }

          console.log("✅ Booking updated after deposit:", updatedBooking);
        }

        // ---- Rental payment handler ----

if (kind === "rental" && bookingId) {
  console.log("✅ RENTAL BLOCK ENTERED");
  console.log("✅ RENTAL bookingId:", bookingId);
  console.log("🔥 WEBHOOK KIND VALUE:", kind);
  console.log("🔥 WEBHOOK METADATA:", session?.metadata);
  console.log("💳 Rental webhook matched booking:", bookingId);

          const { data: booking, error: bookingError } = await supabaseAdmin
            .from("bookings")
            .select("*")
            .eq("id", bookingId)
            .maybeSingle();

          if (bookingError || !booking) {
            console.error("❌ Booking lookup failed:", bookingError);
            return res.json({ received: true });
          }

          const paidAt = new Date().toISOString();

          const { data: updatedBooking, error: bookingUpdateError } = await supabaseAdmin
  .from("bookings")
  .update({
    payment_status: "paid",
    paid_at: paidAt,
    rental_stripe_payment_intent_id: session?.payment_intent || null,
  })
  .eq("id", bookingId)
  .select("id, status, payment_status, paid_at, host_id, driver_id")
  .maybeSingle();

if (bookingUpdateError) throw bookingUpdateError;

console.log("✅ RENTAL UPDATED BOOKING:", updatedBooking);
console.log("✅ RENTAL HOST ID:", updatedBooking?.host_id);
              

          console.log("🔎 BOOKING UPDATE ERROR:", bookingUpdateError);
          console.log("🔎 UPDATED BOOKING RESULT:", updatedBooking);

          if (bookingUpdateError) {
            console.error("❌ Booking payment update failed:", bookingUpdateError);
            return res.json({
              received: true,
              ok: false,
              error: bookingUpdateError.message,
            });
          }

          console.log("✅ Booking updated after rental payment:", updatedBooking);

          try {
  if (updatedBooking?.host_id) {
    await notifyUser({
      supabaseAdmin,
      userId: updatedBooking.host_id,
      title: "💸 Rental Paid",
      body: "The driver completed rental payment. Trip is ready for pickup.",
      data: {
        type: "rental_paid",
        bookingId: updatedBooking.id,
      },
    });
  }

  if (updatedBooking?.driver_id) {
    await notifyUser({
      supabaseAdmin,
      userId: updatedBooking.driver_id,
      title: "✅ Rental Paid",
      body: "Your rental payment is complete. Your trip is ready for pickup.",
      data: {
        type: "rental_paid",
        bookingId: updatedBooking.id,
      },
    });
  }

  console.log("✅ RENTAL PAID PUSH SENT");
} catch (pushErr) {
  console.log("❌ RENTAL PAID PUSH FAILED:", pushErr);
}

          const payoutPayload = {
            booking_id: booking.id,
            host_id: booking.host_id,
            vehicle_id: booking.vehicle_id,
            driver_id: null,
            period_start: booking.start_at || booking.start_date || null,
            period_end: booking.end_at || booking.end_date || null,
            gross_amount_cents: booking.rental_subtotal_cents || 0,
            application_fee_cents: booking.host_fee_cents || 0,
            net_amount_cents: booking.host_payout_cents || 0,
            rental_subtotal_cents: booking.rental_subtotal_cents || 0,
            host_fee_cents: booking.host_fee_cents || 0,
            host_payout_cents: booking.host_payout_cents || 0,
            stripe_checkout_session_id: session?.id || null,
            rental_stripe_payment_intent_id:
              session?.payment_intent || null,
            payout_available_at: booking.end_at
              ? new Date(
                  new Date(booking.end_at).getTime() + 24 * 60 * 60 * 1000
                ).toISOString()
              : booking.end_date
              ? new Date(
                  new Date(booking.end_date).getTime() + 24 * 60 * 60 * 1000
                ).toISOString()
              : null,
            status: "pending",
          };

          console.log("💰 RENTAL WEBHOOK HIT");
          console.log("💰 bookingId:", bookingId);
          console.log("💰 payoutPayload:", payoutPayload);

          const { data: payoutData, error: payoutError } = await supabaseAdmin
            .from("host_payouts")
            .upsert(payoutPayload, { onConflict: "booking_id" })
            .select();

          if (payoutError) {
  console.error("❌ Host payout creation failed:", payoutError);
} else {
  console.log("✅ Host payout created:", payoutData);

  const platformFeeDollars = ((booking.host_fee_cents || 0) / 100).toFixed(2);

await notifyAdmin({
  supabaseAdmin,
  title: "GigRide fee collected 💼",
  body: `$${platformFeeDollars} platform fee collected for booking ${bookingId}.`,
  data: {
    type: "platform_fee_collected",
    bookingId,
    platformFeeCents: booking.host_fee_cents || 0,
  },
});

  console.log("✅ PLATFORM FEE ADMIN PUSH SENT");
}
        }
      }

      return res.json({ received: true });
    } catch (e) {
      console.error("💥 webhook error:", e);
      return res.status(500).send("Webhook handler error");
    }
  }
);

module.exports = router;
