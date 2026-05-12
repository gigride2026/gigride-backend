// routes/webhooks.js (CommonJS)
// Mount example in index.cjs:
// app.use("/webhooks", require("./routes/webhooks.js"));

console.log("🪝 webhooks.js loaded:", __filename);

const express = require("express");
const router = express.Router();

const stripe = require("../utils/stripeClient.cjs");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

/**
 * Stripe webhook MUST receive RAW body.
 * IMPORTANT: If you have app.use(express.json()) globally,
 * it can break Stripe signature verification unless you SKIP it for this route.
 */
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

      // ---- Idempotency check ----
      // If you have a table: stripe_webhook_events (id text primary key, event_type text, created_at timestamptz default now())
      const { data: already, error: alreadyErr } = await supabaseAdmin
        .from("stripe_webhook_events")
        .select("id")
        .eq("id", event.id)
        .maybeSingle();

      if (alreadyErr) {
        console.error("⚠️ Idempotency check error:", alreadyErr.message);
        // continue anyway (don’t block Stripe)
      }

      if (already?.id) {
        console.log("🔁 Webhook already processed:", event.id);
        return res.json({ received: true, duplicate: true });
      }

      console.log("📩 Event received:", event.type, event.id);

      // ---- Handle deposit success ----
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const bookingId =
          session?.metadata?.bookingId ||
          session?.metadata?.booking_id ||
          null;

        const kind = session?.metadata?.kind || null;

        console.log("🧾 checkout.session.completed:", {
          bookingId,
          kind,
          sessionId: session?.id,
          paymentStatus: session?.payment_status,
          mode: session?.mode,
          paymentIntent: session?.payment_intent,
          metadata: session?.metadata || null,
        });

        if (kind === "deposit" && bookingId) {
          // ✅ Only update allowed columns (avoid “Financial fields are server-managed” triggers)
          const { data: upd, error: updErr } = await supabaseAdmin
            .from("bookings")
            .update({
              deposit_paid: true,
              deposit_paid_at: new Date().toISOString(),
            })
            .eq("id", bookingId)
            .select("id, deposit_paid, deposit_paid_at")
            .maybeSingle();

          if (updErr) {
            console.error("❌ Supabase update failed:", updErr.message);
            // Return 200 so Stripe doesn’t keep retrying forever while you adjust DB rules
            return res.json({ received: true, ok: false, error: updErr.message });
          }

          console.log("✅ Booking deposit marked paid:", upd);
        }
      }

      // ---- Record event for idempotency (best-effort) ----
      const { error: insErr } = await supabaseAdmin
        .from("stripe_webhook_events")
        .insert({ id: event.id, event_type: event.type });

      if (insErr) {
        // If this fails because it already exists, it’s fine.
        console.log("⚠️ Could not insert stripe_webhook_events:", insErr.message);
      }

      return res.json({ received: true });
    } catch (e) {
      console.error("💥 webhook error:", e);
      return res.status(500).send("Webhook handler error");
    }
  }
);

module.exports = router;


