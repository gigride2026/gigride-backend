const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const authMiddleware = require("../middlewares/auth.cjs");

const SQUARE_BASE_URL =
  process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

const SQUARE_VERSION = "2025-04-16";


router.get("/connect", authMiddleware, async (req, res) => {
  try {
    const hostId = req.user.id;

    if (!process.env.SQUARE_APPLICATION_ID) {
      return res.status(500).json({
        error: "Square OAuth is not configured.",
      });
    }

    const state = crypto.randomBytes(32).toString("hex");
    const stateHash = crypto
      .createHash("sha256")
      .update(state)
      .digest("hex");

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: stateError } = await supabaseAdmin
      .from("square_oauth_states")
      .insert({
        state_hash: stateHash,
        host_id: hostId,
        expires_at: expiresAt,
      });

    if (stateError) {
      console.error("SQUARE OAUTH STATE ERROR:", stateError.message);
      return res.status(500).json({
        error: "Unable to start Square connection.",
      });
    }

    const params = new URLSearchParams({
      client_id: process.env.SQUARE_APPLICATION_ID,
      scope: [
        "MERCHANT_PROFILE_READ",
        "ORDERS_READ",
        "ORDERS_WRITE",
        "PAYMENTS_READ",
        "PAYMENTS_WRITE",
        "PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS",
      ].join(" "),
      session: "false",
      state,
    });

    return res.json({
      authorization_url: `${SQUARE_BASE_URL}/oauth2/authorize?${params.toString()}`,
    });
  } catch (error) {
    console.error("SQUARE OAUTH CONNECT ERROR:", error.message);
    return res.status(500).json({
      error: "Unable to start Square connection.",
    });
  }
});


router.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error("SQUARE OAUTH DENIED:", error, error_description || "");
      return res.status(400).send("Square connection was cancelled or denied.");
    }

    if (!code || !state) {
      return res.status(400).send("Missing Square authorization information.");
    }

    if (
      !process.env.SQUARE_APPLICATION_ID ||
      !process.env.SQUARE_APPLICATION_SECRET
    ) {
      return res.status(500).send("Square OAuth is not configured.");
    }

    const stateHash = crypto
      .createHash("sha256")
      .update(String(state))
      .digest("hex");

    const { data: oauthState, error: stateLookupError } = await supabaseAdmin
      .from("square_oauth_states")
      .select("host_id, expires_at")
      .eq("state_hash", stateHash)
      .maybeSingle();

    if (stateLookupError) {
      console.error("SQUARE OAUTH STATE LOOKUP ERROR:", stateLookupError.message);
      return res.status(500).send("Unable to verify Square connection.");
    }

    if (!oauthState) {
      return res.status(400).send("Invalid or already-used Square connection.");
    }

    if (new Date(oauthState.expires_at).getTime() <= Date.now()) {
      await supabaseAdmin
        .from("square_oauth_states")
        .delete()
        .eq("state_hash", stateHash);

      return res.status(400).send("Square connection expired. Please try again.");
    }

    const { error: consumeStateError } = await supabaseAdmin
      .from("square_oauth_states")
      .delete()
      .eq("state_hash", stateHash);

    if (consumeStateError) {
      console.error(
        "SQUARE OAUTH STATE CONSUME ERROR:",
        consumeStateError.message
      );
      return res.status(500).send("Unable to verify Square connection.");
    }

    const tokenResponse = await fetch(`${SQUARE_BASE_URL}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Square-Version": SQUARE_VERSION,
      },
      body: JSON.stringify({
        client_id: process.env.SQUARE_APPLICATION_ID,
        client_secret: process.env.SQUARE_APPLICATION_SECRET,
        code: String(code),
        grant_type: "authorization_code",
      }),
    });

    const tokenJson = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenJson?.access_token) {
      console.error(
        "SQUARE OAUTH TOKEN ERROR:",
        tokenJson?.errors?.[0]?.code || "token_exchange_failed"
      );
      return res.status(400).send("Square authorization could not be completed.");
    }

    const locationResponse = await fetch(
      `${SQUARE_BASE_URL}/v2/locations/main`,
      {
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          "Square-Version": SQUARE_VERSION,
          "Content-Type": "application/json",
        },
      }
    );

    const locationJson = await locationResponse.json();

    if (!locationResponse.ok || !locationJson?.location?.id) {
      console.error(
        "SQUARE LOCATION ERROR:",
        locationJson?.errors?.[0]?.code || "location_lookup_failed"
      );
      return res.status(400).send(
        "Square connected, but the seller location could not be verified."
      );
    }

    const hostId = oauthState.host_id;
    const now = new Date().toISOString();

    const { error: credentialError } = await supabaseAdmin
      .from("square_host_credentials")
      .upsert(
        {
          host_id: hostId,
          access_token: tokenJson.access_token,
          refresh_token: tokenJson.refresh_token || null,
          token_expires_at: tokenJson.expires_at || null,
          updated_at: now,
        },
        { onConflict: "host_id" }
      );

    if (credentialError) {
      console.error(
        "SQUARE CREDENTIAL SAVE ERROR:",
        credentialError.message
      );
      return res.status(500).send("Unable to save Square connection.");
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        square_merchant_id: tokenJson.merchant_id || null,
        square_location_id: locationJson.location.id,
        square_connected_at: now,
        square_connection_status: "connected",
      })
      .eq("id", hostId);

    if (profileError) {
      console.error("SQUARE PROFILE UPDATE ERROR:", profileError.message);
      return res.status(500).send("Unable to finish Square connection.");
    }

    return res.redirect("gigride://square-success");
  } catch (error) {
    console.error("SQUARE OAUTH CALLBACK ERROR:", error.message);
    return res.status(500).send("Unable to complete Square connection.");
  }
});

router.post("/create-payment-link", async (req, res) => {
  try {
    const { booking_id, payment_type, amount_cents } = req.body;

    if (!booking_id || !payment_type || !amount_cents) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const idempotencyKey = crypto.randomUUID();

    const lineItems =
      payment_type === "deposit"
        ? [
            {
              name: "Security Deposit",
              quantity: "1",
              base_price_money: {
                amount: Number(amount_cents),
                currency: "USD",
              },
            },
          ]
        : [
            {
              name: "Rental Charge",
              quantity: "1",
              base_price_money: {
                amount: Number(req.body.rental_cents || amount_cents),
                currency: "USD",
              },
            },
            ...(Number(req.body.bonzah_fee_cents || 0) > 0
              ? [
                  {
                    name: "Rental Protection",
                    quantity: "1",
                    base_price_money: {
                      amount: Number(req.body.bonzah_fee_cents),
                      currency: "USD",
                    },
                  },
                ]
              : []),
            ...(Number(req.body.gigride_protection_fee_cents || 0) > 0
              ? [
                  {
                    name: "GigRide Protection Fee",
                    quantity: "1",
                    base_price_money: {
                      amount: Number(req.body.gigride_protection_fee_cents),
                      currency: "USD",
                    },
                  },
                ]
              : []),
            ...(Number(req.body.tax_cents || 0) > 0
              ? [
                  {
                    name: "Taxes",
                    quantity: "1",
                    base_price_money: {
                      amount: Number(req.body.tax_cents),
                      currency: "USD",
                    },
                  },
                ]
              : []),
          ];

    const response = await fetch(
      `${SQUARE_BASE_URL}/v2/online-checkout/payment-links`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "Square-Version": SQUARE_VERSION,
        },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          order: {
            location_id: process.env.SQUARE_LOCATION_ID,
            line_items: lineItems,
            metadata: {
              booking_id: String(booking_id),
              payment_type: String(payment_type),
            },
          },
          checkout_options: {
            redirect_url:
              process.env.APP_DEEP_LINK || "gigride://square-success",
          },
        }),
      }
    );

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          json?.errors?.[0]?.detail ||
          "Failed to create Square payment link",
        square: json,
      });
    }

    return res.json({
      payment_link_id: json?.payment_link?.id,
      checkout_url: json?.payment_link?.url,
    });
  } catch (e) {
    console.error("SQUARE CREATE PAYMENT LINK ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const event = req.body;

    console.log("SQUARE WEBHOOK EVENT:", event?.type);

    const paymentId = event?.data?.object?.payment?.id;

    if (!paymentId) {
      return res.json({ ok: true, ignored: "No payment ID" });
    }

    const paymentRes = await fetch(`${SQUARE_BASE_URL}/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": SQUARE_VERSION,
      },
    });

    const paymentJson = await paymentRes.json();

    if (!paymentRes.ok) {
      console.log("SQUARE PAYMENT FETCH ERROR:", paymentJson);
      return res.json({ ok: true, ignored: "Payment fetch failed" });
    }

    const payment = paymentJson?.payment;

    if (payment?.status !== "COMPLETED") {
      return res.json({ ok: true, ignored: `Payment status ${payment?.status}` });
    }

    const orderId = payment?.order_id;

    if (!orderId) {
      return res.json({ ok: true, ignored: "No order ID" });
    }

    const orderRes = await fetch(`${SQUARE_BASE_URL}/v2/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": SQUARE_VERSION,
      },
    });

    const orderJson = await orderRes.json();

    if (!orderRes.ok) {
      console.log("SQUARE ORDER FETCH ERROR:", orderJson);
      return res.json({ ok: true, ignored: "Order fetch failed" });
    }

    const metadata = orderJson?.order?.metadata || {};
    const bookingId = metadata.booking_id;
    const paymentType = metadata.payment_type;

    if (!bookingId || !paymentType) {
      return res.json({ ok: true, ignored: "Missing booking metadata" });
    }

    const update =
  paymentType === "deposit"
    ? {
        status: "deposit_paid",
        deposit_paid: true,
        deposit_paid_at: new Date().toISOString(),
      }
    : {
        payment_status: "paid",
        paid_at: new Date().toISOString(),
      };

const { data: updatedBooking, error } = await supabaseAdmin
  .from("bookings")
  .update(update)
  .eq("id", bookingId)
  .select("*")
  .maybeSingle();

if (error) throw error;

if (paymentType === "rental" && updatedBooking) {
  const grossCents = Number(
    updatedBooking.rental_subtotal_cents ||
      updatedBooking.total_price_cents ||
      0
  );

  const platformFeeCents = Math.round(grossCents * 0.08);
  const hostPayoutCents = Math.max(0, grossCents - platformFeeCents);

  const payoutAvailableAt = updatedBooking.end_date
    ? new Date(
        new Date(updatedBooking.end_date).getTime() + 24 * 60 * 60 * 1000
      ).toISOString()
    : null;

  const { error: payoutError } = await supabaseAdmin
    .from("host_payouts")
    .upsert(
      {
        booking_id: updatedBooking.id,
        host_id: updatedBooking.host_id,
        vehicle_id: updatedBooking.vehicle_id,
        period_start: updatedBooking.start_date || null,
        period_end: updatedBooking.end_date || null,
        gross_amount_cents: grossCents,
        application_fee_cents: platformFeeCents,
        net_amount_cents: hostPayoutCents,
        rental_subtotal_cents: grossCents,
        host_fee_cents: platformFeeCents,
        host_payout_cents: hostPayoutCents,
        payout_available_at: payoutAvailableAt,
        status: "pending",
      },
      { onConflict: "booking_id" }
    );

  if (payoutError) {
    console.error("HOST PAYOUT UPSERT ERROR:", payoutError);
  }
}

console.log("SQUARE PAYMENT APPLIED:", {
  bookingId,
  paymentType,
  paymentId,
});

return res.json({ ok: true });
  } catch (e) {
    console.error("SQUARE WEBHOOK ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
});
module.exports = router;