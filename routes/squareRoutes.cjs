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


async function getValidSquareHostAccessToken(hostId, credentials) {
  if (!credentials?.access_token) {
    throw new Error("Square host access token is missing");
  }

  const expiresAt = credentials.token_expires_at
    ? new Date(credentials.token_expires_at).getTime()
    : null;

  // Refresh when expired or within 5 minutes of expiration.
  const shouldRefresh =
    expiresAt !== null &&
    Number.isFinite(expiresAt) &&
    expiresAt <= Date.now() + 5 * 60 * 1000;

  if (!shouldRefresh) {
    return credentials.access_token;
  }

  if (!credentials.refresh_token) {
    throw new Error("Square host refresh token is missing");
  }

  const response = await fetch(`${SQUARE_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION,
    },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APPLICATION_ID,
      client_secret: process.env.SQUARE_APPLICATION_SECRET,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
    }),
  });

  const json = await response.json();

  if (!response.ok || !json?.access_token) {
    console.error(
      "SQUARE TOKEN REFRESH ERROR:",
      json?.errors?.[0]?.code || "refresh_failed"
    );
    throw new Error("Square host authorization needs to be renewed");
  }

  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("square_host_credentials")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token || credentials.refresh_token,
      token_expires_at: json.expires_at || null,
      updated_at: now,
    })
    .eq("host_id", hostId);

  if (error) {
    console.error("SQUARE TOKEN REFRESH SAVE ERROR:", error.message);
    throw new Error("Unable to save refreshed Square authorization");
  }

  return json.access_token;
}



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


router.get("/connection-status", authMiddleware, async (req, res) => {
  try {
    const hostId = req.user.id;

    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "square_connection_status, square_connected_at, square_merchant_id, square_location_id"
      )
      .eq("id", hostId)
      .single();

    if (error) {
      console.error("SQUARE CONNECTION STATUS ERROR:", error.message);
      return res.status(500).json({
        error: "Unable to check Square connection.",
      });
    }

    const connected =
      profile?.square_connection_status === "connected" &&
      !!profile?.square_merchant_id &&
      !!profile?.square_location_id;

    return res.json({
      connected,
      status: profile?.square_connection_status || "not_connected",
      connected_at: profile?.square_connected_at || null,
    });
  } catch (error) {
    console.error("SQUARE CONNECTION STATUS ERROR:", error.message);
    return res.status(500).json({
      error: "Unable to check Square connection.",
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

router.post("/create-payment-link", authMiddleware, async (req, res) => {
  try {
    const { booking_id, payment_type } = req.body || {};
    const driverId = req.user?.id;

    if (!booking_id || !["deposit", "rental"].includes(payment_type)) {
      return res.status(400).json({
        error: "booking_id and valid payment_type are required",
      });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select(
        "id, host_id, driver_id, status, total_price_cents, deposit_amount_cents, payment_status, deposit_paid"
      )
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError) {
      console.error("SQUARE BOOKING LOOKUP ERROR:", bookingError.message);
      return res.status(500).json({ error: "Unable to load booking." });
    }

    if (!booking) {
      return res.status(404).json({ error: "Booking not found." });
    }

    if (String(booking.driver_id) !== String(driverId)) {
      return res.status(403).json({
        error: "Only the booking driver can make this payment.",
      });
    }

    if (payment_type === "deposit" && booking.deposit_paid === true) {
      return res.status(409).json({ error: "Security deposit is already paid." });
    }

    if (
      payment_type === "rental" &&
      String(booking.payment_status || "").toLowerCase() === "paid"
    ) {
      return res.status(409).json({ error: "Rental payment is already paid." });
    }

    let squareAccessToken = process.env.SQUARE_ACCESS_TOKEN;
    let squareLocationId = process.env.SQUARE_LOCATION_ID;

    if (payment_type === "rental") {
      const { data: hostProfile, error: hostProfileError } = await supabaseAdmin
        .from("profiles")
        .select(
          "square_connection_status, square_merchant_id, square_location_id"
        )
        .eq("id", booking.host_id)
        .maybeSingle();

      if (hostProfileError) {
        console.error(
          "SQUARE HOST PROFILE LOOKUP ERROR:",
          hostProfileError.message
        );
        return res.status(500).json({
          error: "Unable to verify host payment account.",
        });
      }

      if (
        !hostProfile ||
        hostProfile.square_connection_status !== "connected" ||
        !hostProfile.square_merchant_id ||
        !hostProfile.square_location_id
      ) {
        return res.status(409).json({
          error: "Host has not connected Square yet.",
        });
      }

      const { data: credentials, error: credentialError } = await supabaseAdmin
        .from("square_host_credentials")
        .select("access_token, refresh_token, token_expires_at")
        .eq("host_id", booking.host_id)
        .maybeSingle();

      if (credentialError) {
        console.error(
          "SQUARE HOST CREDENTIAL LOOKUP ERROR:",
          credentialError.message
        );
        return res.status(500).json({
          error: "Unable to load host payment account.",
        });
      }

      if (!credentials?.access_token) {
        return res.status(409).json({
          error: "Host Square authorization is unavailable.",
        });
      }

      squareAccessToken = await getValidSquareHostAccessToken(
        booking.host_id,
        credentials
      );
      squareLocationId = hostProfile.square_location_id;
    }

    if (!squareAccessToken || !squareLocationId) {
      return res.status(500).json({
        error: "Square payment configuration is unavailable.",
      });
    }

    const depositAmountCents = Number(booking.deposit_amount_cents || 0);
    const rentalSubtotalCents = Number(booking.total_price_cents || 0);
    const driverFeeCents =
      payment_type === "rental"
        ? Math.round(rentalSubtotalCents * 0.08)
        : 0;

    const taxCents =
      payment_type === "rental"
        ? Math.round(rentalSubtotalCents * 0.07)
        : 0;

    const amountCents =
      payment_type === "deposit"
        ? depositAmountCents
        : rentalSubtotalCents + driverFeeCents + taxCents;

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({
        error: "Booking payment amount is invalid.",
      });
    }

    const hostFeeCents =
      payment_type === "rental"
        ? Math.round(rentalSubtotalCents * 0.08)
        : 0;

    const applicationFeeCents =
      payment_type === "rental"
        ? hostFeeCents + driverFeeCents
        : 0;

    const lineItems =
      payment_type === "deposit"
        ? [
            {
              name: "Security Deposit",
              quantity: "1",
              base_price_money: {
                amount: depositAmountCents,
                currency: "USD",
              },
            },
          ]
        : [
            {
              name: "Rental Charge",
              quantity: "1",
              base_price_money: {
                amount: rentalSubtotalCents,
                currency: "USD",
              },
            },
            ...(driverFeeCents > 0
              ? [
                  {
                    name: "GigRide Service Fee",
                    quantity: "1",
                    base_price_money: {
                      amount: driverFeeCents,
                      currency: "USD",
                    },
                  },
                ]
              : []),
            ...(taxCents > 0
              ? [
                  {
                    name: "Taxes",
                    quantity: "1",
                    base_price_money: {
                      amount: taxCents,
                      currency: "USD",
                    },
                  },
                ]
              : []),
          ];

    const checkoutOptions = {
      redirect_url:
        process.env.APP_DEEP_LINK || "gigride://square-success",
    };

    if (applicationFeeCents > 0) {
      checkoutOptions.app_fee_money = {
        amount: applicationFeeCents,
        currency: "USD",
      };
    }

    const response = await fetch(
      `${SQUARE_BASE_URL}/v2/online-checkout/payment-links`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${squareAccessToken}`,
          "Content-Type": "application/json",
          "Square-Version": SQUARE_VERSION,
        },
        body: JSON.stringify({
          idempotency_key: crypto.createHash("sha256").update(`${booking.id}:${payment_type}`).digest("hex"),
          order: {
            location_id: squareLocationId,
            line_items: lineItems,
            metadata: {
              booking_id: String(booking.id),
              payment_type: String(payment_type),
            },
          },
          checkout_options: checkoutOptions,
        }),
      }
    );

    const text = await response.text();

    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }

    if (!response.ok) {
      console.error(
        "SQUARE CONNECTED SELLER PAYMENT LINK ERROR:",
        json?.errors?.[0]?.code || response.status
      );

      return res.status(response.status).json({
        error:
          json?.errors?.[0]?.detail ||
          "Failed to create Square payment link",
      });
    }

    return res.json({
      payment_link_id: json?.payment_link?.id,
      checkout_url: json?.payment_link?.url,
    });
  } catch (e) {
    console.error("SQUARE CREATE PAYMENT LINK ERROR:", e.message);
    return res.status(500).json({
      error: "Unable to create Square payment link.",
    });
  }
});

router.post("/webhook", async (req, res) => {
  try {
    // Verify this webhook actually came from Square.
    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    const notificationUrl = process.env.SQUARE_WEBHOOK_URL;
    const squareSignature = req.get("x-square-hmacsha256-signature");
    const rawBody = req.rawBody;

    if (!signatureKey || !notificationUrl) {
      console.error("SQUARE WEBHOOK SIGNATURE CONFIG MISSING");
      return res.status(500).json({ error: "Webhook signature config missing" });
    }

    if (!squareSignature || !rawBody) {
      console.warn("SQUARE WEBHOOK SIGNATURE OR RAW BODY MISSING");
      return res.status(403).json({ error: "Invalid Square webhook signature" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", signatureKey)
      .update(notificationUrl + rawBody.toString("utf8"))
      .digest("base64");

    const receivedBuffer = Buffer.from(squareSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    const validSignature =
      receivedBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

    if (!validSignature) {
      console.warn("INVALID SQUARE WEBHOOK SIGNATURE");
      return res.status(403).json({ error: "Invalid Square webhook signature" });
    }

    console.log("VALID SQUARE WEBHOOK SIGNATURE");

    const event = req.body;

    console.log("SQUARE WEBHOOK EVENT:", event?.type);

    const paymentId = event?.data?.object?.payment?.id;

    if (!paymentId) {
      return res.json({ ok: true, ignored: "No payment ID" });
    }

    
    let squareAccessToken = process.env.SQUARE_ACCESS_TOKEN;
    const eventMerchantId = String(event?.merchant_id || "").trim();

    if (eventMerchantId) {
      const { data: hostProfile, error: hostLookupError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("square_merchant_id", eventMerchantId)
        .maybeSingle();

      if (hostLookupError) {
        console.error("SQUARE WEBHOOK HOST LOOKUP ERROR:", hostLookupError.message);
        return res.json({ ok: true, ignored: "Host lookup failed" });
      }

      if (hostProfile?.id) {
        const { data: credentials, error: credentialError } = await supabaseAdmin
          .from("square_host_credentials")
          .select("access_token, refresh_token, token_expires_at")
          .eq("host_id", hostProfile.id)
          .maybeSingle();

        if (credentialError || !credentials?.access_token) {
          console.error(
            "SQUARE WEBHOOK HOST CREDENTIAL ERROR:",
            credentialError?.message || "Missing host Square access token"
          );
          return res.json({ ok: true, ignored: "Host Square credentials unavailable" });
        }

        squareAccessToken = await getValidSquareHostAccessToken(
          hostProfile.id,
          credentials
        );
      }
    }

    if (!squareAccessToken) {
      console.error("SQUARE WEBHOOK ERROR: No Square access token available");
      return res.json({ ok: true, ignored: "Square credentials unavailable" });
    }

const paymentRes = await fetch(`${SQUARE_BASE_URL}/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${squareAccessToken}`,
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
        Authorization: `Bearer ${squareAccessToken}`,
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