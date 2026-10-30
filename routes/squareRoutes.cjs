const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const authMiddleware = require("../middlewares/auth.cjs");
const { notifyUser } = require("../utils/pushNotifications.cjs");
const {
  SCREENING_FEE_CENTS,
  getDriverBackgroundCheck,
  needsScreeningFee,
  reserveDriverScreeningFee,
  isRentalScreeningEligible,
} = require("../services/driverBackgroundChecks.cjs");
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
        "id, host_id, driver_id, status, host_approved, total_price_cents, deposit_amount_cents, payment_status, deposit_paid"
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

    if (payment_type === "deposit" || payment_type === "rental") {
      if (booking.host_approved !== true) {
        return res.status(409).json({
          error: "Host approval is required before rental payment.",
        });
      }

      const screening = await getDriverBackgroundCheck(
        supabaseAdmin,
        driverId
      );

if (!isRentalScreeningEligible(screening)) {
  return res.status(409).json({
    error:
      "Background check must be paid and approved before rental payment.",
  });
}
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

   if (
  process.env.SQUARE_ENVIRONMENT !== "sandbox" &&
  applicationFeeCents > 0
) {
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
         idempotency_key: crypto.randomUUID(),
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
// Create a separate Square checkout for the driver's one-time
// $39.49 background-check fee including MVR, paid to GigRide.
router.post(
  "/create-background-check-payment-link",
  authMiddleware,
  async (req, res) => {
    if (process.env.CHECKR_SCREENING_CHECKOUT_ENABLED !== "true") {
      return res.status(503).json({
        error: "Background-check checkout is not enabled yet.",
      });
    }

    try {
      const driverId = req.user?.id;
      const bookingId = req.body?.booking_id;

      if (!driverId || !bookingId) {
        return res.status(400).json({
          error: "Authenticated driver and booking ID are required.",
        });
      }

      const { data: booking, error: bookingError } = await supabaseAdmin
        .from("bookings")
        .select("id, driver_id, host_approved, status")
        .eq("id", bookingId)
        .eq("driver_id", driverId)
        .maybeSingle();

      if (bookingError) throw bookingError;

      if (!booking || booking.host_approved !== true) {
        return res.status(403).json({
          error: "An approved booking is required.",
        });
      }

      const existing = await getDriverBackgroundCheck(
        supabaseAdmin,
        driverId
      );

      // Require recorded acknowledgment before creating or reusing checkout.
      const { data: acknowledgment, error: acknowledgmentError } =
        await supabaseAdmin
          .from("driver_background_checks")
          .select("screening_acknowledged_at")
          .eq("driver_id", driverId)
          .maybeSingle();

      if (acknowledgmentError) throw acknowledgmentError;

      if (!acknowledgment?.screening_acknowledged_at) {
        return res.status(403).json({
          error: "Screening acknowledgment is required before payment.",
          code: "SCREENING_ACKNOWLEDGMENT_REQUIRED",
        });
      }

      if (
        existing?.fee_payment_status === "paid" ||
        existing?.fee_payment_status === "refunded"
      ) {
        return res.status(409).json({
          error: "Screening fee has already been processed.",
        });
      }

      // Reuse the original checkout only after checking Square.
if (existing?.fee_checkout_url || existing?.fee_payment_link_id) {
  if (!existing?.fee_checkout_url || !existing?.fee_payment_link_id) {
    return res.status(409).json({
      error: "Existing screening checkout is incomplete and requires reconciliation.",
    });
  }
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;

  if (!accessToken) {
    throw new Error("GigRide Square credentials are missing");
  }

  const linkResponse = await fetch(
    `${SQUARE_BASE_URL}/v2/online-checkout/payment-links/${encodeURIComponent(
      existing.fee_payment_link_id
    )}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
      },
    }
  );

  if (!linkResponse.ok) {
    throw new Error("Unable to verify existing Square checkout");
  }

  const linkJson = await linkResponse.json();
  const squareLink = linkJson?.payment_link;

  if (
    !squareLink ||
    squareLink.id !== existing.fee_payment_link_id ||
    !squareLink.order_id
  ) {
    throw new Error("Existing Square checkout is invalid");
  }

// Retrieve the exact Square order associated with this checkout.
const orderResponse = await fetch(
  `${SQUARE_BASE_URL}/v2/orders/${encodeURIComponent(squareLink.order_id)}`,
  {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_VERSION,
    },
  }
);

if (!orderResponse.ok) {
  throw new Error("Unable to verify screening checkout order");
}

const orderJson = await orderResponse.json();
const squareOrder = orderJson?.order;

if (
  !squareOrder ||
  squareOrder.id !== squareLink.order_id ||
  squareOrder.total_money?.amount !== SCREENING_FEE_CENTS ||
  squareOrder.total_money?.currency !== "USD"
) {
  throw new Error("Existing screening checkout order is invalid");
}
// A completed Square order must never be offered for payment again.
if (squareOrder.state === "COMPLETED") {
  return res.status(409).json({
    error: "Screening checkout order has already been completed.",
  });
}
// Inspect payments recorded against this specific Square order.
const orderTenders = squareOrder.tenders || [];

for (const tender of orderTenders) {
  if (!tender.payment_id) {
    return res.status(409).json({
      error: "Screening checkout has an unresolved tender.",
    });
  }

  const paymentResponse = await fetch(
    `${SQUARE_BASE_URL}/v2/payments/${encodeURIComponent(tender.payment_id)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_VERSION,
      },
    }
  );

  if (!paymentResponse.ok) {
    throw new Error("Unable to verify screening order payment");
  }

  const paymentJson = await paymentResponse.json();
  const orderPayment = paymentJson?.payment;

  if (!orderPayment || orderPayment.order_id !== squareOrder.id) {
    throw new Error("Screening order payment verification failed");
  }

  return res.status(409).json({
    error: "Screening checkout already has a payment or payment attempt.",
  });
}
// Reuse only an open checkout with no recorded tenders.
if (
  ["OPEN", "DRAFT"].includes(squareOrder.state) &&
  orderTenders.length === 0
) {
  return res.json({
    payment_link_id: existing.fee_payment_link_id,
    checkout_url: existing.fee_checkout_url,
  });
}

// Fail closed for unknown or unresolved payment states.
return res.status(409).json({
  error: "Screening checkout payment status requires verification.",
});
}

      const reservation = await reserveDriverScreeningFee(
        supabaseAdmin,
        driverId,
        bookingId
      );

// Retrieve the reservation's original booking ID.
// A driver may retry checkout from a different approved booking.
const { data: reservedScreening, error: reservationError } =
  await supabaseAdmin
    .from("driver_background_checks")
    .select("first_booking_id")
    .eq("id", reservation.reservation_id)
    .eq("driver_id", driverId)
    .single();

if (reservationError || !reservedScreening?.first_booking_id) {
  throw new Error("Unable to verify original screening booking");
}

const screeningBookingId = reservedScreening.first_booking_id;

      if (reservation.fee_cents !== SCREENING_FEE_CENTS) {
        throw new Error("Unexpected screening fee amount");
      }

      const accessToken = process.env.SQUARE_ACCESS_TOKEN;
      const locationId = process.env.SQUARE_LOCATION_ID;

      if (!accessToken || !locationId) {
        throw new Error("GigRide Square credentials are missing");
      }

      // Stable across retries for the same driver reservation.
      const idempotencyKey = crypto
        .createHash("sha256")
        .update(`screening:${reservation.reservation_id}`)
        .digest("hex");

      const response = await fetch(
        `${SQUARE_BASE_URL}/v2/online-checkout/payment-links`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Square-Version": SQUARE_VERSION,
          },
          body: JSON.stringify({
            idempotency_key: idempotencyKey,
            order: {
              location_id: locationId,
              line_items: [
                {
                  name: "GigRide Driver Background Check",
                  quantity: "1",
                  base_price_money: {
                    amount: SCREENING_FEE_CENTS,
                    currency: "USD",
                  },
                },
              ],
              metadata: {
                payment_type: "background_check",
                booking_id: String(screeningBookingId),
                driver_id: String(driverId),
                reservation_id: String(reservation.reservation_id),
              },
            },
          }),
        }
      );

      const json = await response.json();

      if (!response.ok) {
        console.error(
          "SCREENING SQUARE CHECKOUT ERROR:",
          json?.errors?.[0]?.code || response.status
        );

        return res.status(502).json({
          error: "Unable to create background-check checkout.",
        });
      }

      const paymentLinkId = json?.payment_link?.id;
      const checkoutUrl = json?.payment_link?.url;

      if (!paymentLinkId || !checkoutUrl) {
        throw new Error("Square returned an incomplete payment link");
      }

      const { data: saved, error: saveError } = await supabaseAdmin
        .from("driver_background_checks")
        .update({
          fee_payment_link_id: paymentLinkId,
          fee_checkout_url: checkoutUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reservation.reservation_id)
        .eq("driver_id", driverId)
        .eq("fee_payment_status", "pending")
        .is("fee_payment_link_id", null)
        .select("fee_payment_link_id, fee_checkout_url")
        .maybeSingle();

      if (saveError) throw saveError;

      if (!saved) {
        // Another request may have saved the checkout first,
        // or the fee may have been paid in the meantime.
        const latest = await getDriverBackgroundCheck(
          supabaseAdmin,
          driverId
        );

        if (latest?.fee_payment_status !== "pending") {
          return res.status(409).json({
            error: "Screening payment state has changed.",
          });
        }

        if (!latest?.fee_checkout_url || !latest?.fee_payment_link_id) {
          throw new Error("Unable to confirm saved checkout");
        }

        // Require a fresh request to verify the saved link against Square.
        // Never return an unverified checkout after a concurrent save.
        return res.status(409).json({
          error: "Screening checkout was updated. Please retry to verify its payment status.",
        });
      }

      return res.json({
        payment_link_id: saved.fee_payment_link_id,
        checkout_url: saved.fee_checkout_url,
      });
    } catch (error) {
      console.error("SCREENING CHECKOUT ERROR:", error.message);

      return res.status(500).json({
        error: "Unable to prepare background-check checkout.",
      });
    }
  }
);

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

    
    const SQUARE_PLATFORM_MERCHANT_ID =
      process.env.SQUARE_MERCHANT_ID || "MLYM62K90C573";

    let squareAccessToken = process.env.SQUARE_ACCESS_TOKEN;
    let hostProfile = null;
    const eventMerchantId = String(event?.merchant_id || "").trim();

    if (!eventMerchantId) {
      console.error("SQUARE WEBHOOK ERROR: Missing merchant ID");
      return res.json({ ok: true, ignored: "Missing merchant ID" });
    }

    const isPlatformMerchant =
      eventMerchantId === SQUARE_PLATFORM_MERCHANT_ID;

    if (!isPlatformMerchant) {
      const { data: foundHostProfile, error: hostLookupError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("square_merchant_id", eventMerchantId)
        .maybeSingle();

      if (hostLookupError) {
        console.error("SQUARE WEBHOOK HOST LOOKUP ERROR:", hostLookupError.message);
        return res.status(500).json({ error: "Host lookup failed" });
      }

      hostProfile = foundHostProfile;

      if (!hostProfile?.id) {
        console.error("SQUARE WEBHOOK UNKNOWN MERCHANT:", eventMerchantId);
        return res.json({ ok: true, ignored: "Unknown Square merchant" });
      }

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
        return res.status(500).json({ error: "Host Square credentials unavailable" });
      }

      squareAccessToken = await getValidSquareHostAccessToken(
        hostProfile.id,
        credentials
      );
    }

    if (!squareAccessToken) {
      console.error("SQUARE WEBHOOK ERROR: No Square access token available");
      return res.status(500).json({ error: "Square credentials unavailable" });
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
      return res.status(500).json({ error: "Payment fetch failed" });
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
  console.error("SQUARE ORDER FETCH ERROR:", orderJson);
  return res.status(503).json({
    error: "Square order lookup failed; retry required",
  });
}
    const metadata = orderJson?.order?.metadata || {};
    const bookingId = metadata.booking_id;
    const paymentType = metadata.payment_type;

    if (!bookingId || !paymentType) {
      return res.json({ ok: true, ignored: "Missing booking metadata" });
    }
// Process GigRide's one-time driver background-check payment separately.
if (paymentType === "background_check") {
  const reservationId = metadata.reservation_id;
  const driverId = metadata.driver_id;
  const paidAmountCents = Number(payment?.amount_money?.amount);
  const paidCurrency = payment?.amount_money?.currency;

  if (!isPlatformMerchant) {
    console.error("SCREENING PAYMENT MERCHANT MISMATCH", paymentId);
    return res.json({ ok: true, ignored: "Wrong screening merchant" });
  }

  if (
    !reservationId ||
    !driverId ||
    !bookingId ||
    paidAmountCents !== SCREENING_FEE_CENTS ||
    paidCurrency !== "USD"
  ) {
    console.error("SCREENING PAYMENT DETAILS INVALID", paymentId);
    return res.json({ ok: true, ignored: "Invalid screening payment" });
  }
  // Verify the payment belongs to this driver's saved Square checkout.
  const { data: screening, error: screeningError } =
    await supabaseAdmin
      .from("driver_background_checks")
      .select("id, driver_id, first_booking_id, fee_payment_link_id")
      .eq("id", reservationId)
      .maybeSingle();

  if (screeningError) {
    console.error("SCREENING RESERVATION LOOKUP ERROR:", screeningError.message);
    return res.status(500).json({
      error: "Unable to verify screening reservation",
    });
  }

  if (
    !screening ||
    String(screening.driver_id) !== String(driverId) ||
    String(screening.first_booking_id) !== String(bookingId)
  ) {
    return res.json({
      ok: true,
      ignored: "Screening reservation mismatch",
    });
  }

  // If the checkout link has not been saved yet, retry this webhook later.
  if (!screening.fee_payment_link_id) {
    return res.status(503).json({
      error: "Screening checkout not yet recorded",
    });
  }

  const linkResponse = await fetch(
    `${SQUARE_BASE_URL}/v2/online-checkout/payment-links/${encodeURIComponent(
      screening.fee_payment_link_id
    )}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": SQUARE_VERSION,
      },
    }
  );

  if (!linkResponse.ok) {
    console.error("SCREENING PAYMENT LINK LOOKUP FAILED:", linkResponse.status);
    return res.status(503).json({
      error: "Unable to verify Square screening checkout",
    });
  }

  const linkJson = await linkResponse.json();
  const expectedOrderId = linkJson?.payment_link?.order_id;

  if (!expectedOrderId || String(expectedOrderId) !== String(orderId)) {
    console.error("SCREENING PAYMENT ORDER MISMATCH:", paymentId);
    return res.json({
      ok: true,
      ignored: "Screening payment does not match checkout order",
    });
  }
  const { data: result, error } = await supabaseAdmin.rpc(
    "apply_driver_screening_payment",
    {
      p_reservation_id: reservationId,
      p_driver_id: driverId,
      p_booking_id: bookingId,
      p_payment_id: paymentId,
      p_amount_cents: paidAmountCents,
    }
  );

  if (error) {
    console.error("SCREENING PAYMENT APPLY ERROR:", error.message);
    return res.status(500).json({ error: "Screening payment update failed" });
  }

  console.log("SCREENING PAYMENT RECORDED:", {
    reservationId,
    driverId,
    duplicate: result?.duplicate === true,
  });

  return res.json({
    ok: true,
    screening_payment_recorded: true,
    duplicate: result?.duplicate === true,
  });
}

    if (!["deposit", "rental"].includes(paymentType)) {
      console.error("SQUARE WEBHOOK INVALID PAYMENT TYPE:", paymentType);
      return res.json({ ok: true, ignored: "Invalid payment type" });
    }

    if (!eventMerchantId) {
      console.error("SQUARE WEBHOOK ERROR: Missing merchant ID");
      return res.json({ ok: true, ignored: "Missing merchant ID" });
    }

    const { data: booking, error: bookingLookupError } = await supabaseAdmin
      .from("bookings")
      .select("id, host_id, deposit_amount_cents, total_price_cents")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingLookupError) {
      console.error("SQUARE WEBHOOK BOOKING LOOKUP ERROR:", bookingLookupError.message);
      return res.status(500).json({ error: "Booking lookup failed" });
    }

    if (!booking) {
      return res.json({ ok: true, ignored: "Booking not found" });
    }

    if (paymentType === "deposit") {
      if (!isPlatformMerchant) {
        console.error("SQUARE WEBHOOK DEPOSIT MERCHANT MISMATCH:", {
          bookingId,
          eventMerchantId,
          expectedMerchantId: SQUARE_PLATFORM_MERCHANT_ID,
        });

        return res.json({
          ok: true,
          ignored: "Deposit payment did not come from platform merchant",
        });
      }
    } else {
      if (!hostProfile?.id) {
        console.error("SQUARE WEBHOOK RENTAL HOST MISSING:", {
          bookingId,
          eventMerchantId,
        });

        return res.json({
          ok: true,
          ignored: "Rental payment merchant is not a connected host",
        });
      }

      if (String(booking.host_id) !== String(hostProfile.id)) {
        console.error("SQUARE WEBHOOK HOST MISMATCH:", {
          bookingId,
          bookingHostId: booking.host_id,
          squareHostId: hostProfile.id,
          eventMerchantId,
        });

        return res.json({
          ok: true,
          ignored: "Booking host does not match Square merchant",
        });
      }
    }

    const rentalSubtotalCents = Number(booking.total_price_cents || 0);

    const expectedRentalAmountCents =
      rentalSubtotalCents +
      Math.round(rentalSubtotalCents * 0.08) +
      Math.round(rentalSubtotalCents * 0.07);

    const expectedAmountCents =
      paymentType === "deposit"
        ? Number(booking.deposit_amount_cents || 0)
        : expectedRentalAmountCents;

    const paidAmountCents = Number(payment?.amount_money?.amount || 0);
    const paidCurrency = String(payment?.amount_money?.currency || "").toUpperCase();

    if (!Number.isFinite(expectedAmountCents) || expectedAmountCents <= 0) {
      console.error("SQUARE WEBHOOK INVALID EXPECTED AMOUNT:", {
        bookingId,
        paymentType,
        expectedAmountCents,
      });
      return res.status(500).json({ error: "Invalid booking payment amount" });
    }

    if (paidCurrency !== "USD" || paidAmountCents !== expectedAmountCents) {
      console.error("SQUARE WEBHOOK PAYMENT AMOUNT MISMATCH:", {
        bookingId,
        paymentType,
        paymentId,
        expectedAmountCents,
        paidAmountCents,
        paidCurrency,
      });

      return res.json({
        ok: true,
        ignored: "Payment amount or currency mismatch",
      });
    }

    const { data: paymentResult, error: paymentApplyError } =
      await supabaseAdmin.rpc("apply_square_booking_payment", {
        p_booking_id: bookingId,
        p_payment_type: paymentType,
        p_payment_id: paymentId,
        p_amount_cents: paidAmountCents,
      });

    if (paymentApplyError) {
      console.error("SQUARE PAYMENT APPLY ERROR:", {
        bookingId,
        paymentType,
        paymentId,
        error: paymentApplyError.message,
      });

      throw paymentApplyError;
    }

    if (paymentResult?.duplicate === true) {
      console.log("SQUARE PAYMENT ALREADY APPLIED:", {
        bookingId,
        paymentType,
        paymentId,
      });

      return res.json({
        ok: true,
        duplicate: true,
      });
    }

    console.log("SQUARE PAYMENT APPLIED:", {
      bookingId,
      paymentType,
      paymentId,
      amountCents: paidAmountCents,
    });

    // 🔔 Owner-only financial notification
try {
  const ownerUserId = String(
    process.env.GIGRIDE_OWNER_USER_ID || ""
  ).trim();

  if (ownerUserId) {
    const money = (cents) =>
      (Number(cents || 0) / 100).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });

    if (paymentType === "rental") {
      const driverFeeCents = Math.round(rentalSubtotalCents * 0.08);
      const hostFeeCents = Math.round(rentalSubtotalCents * 0.08);
      const platformRevenueCents = driverFeeCents + hostFeeCents;

      await notifyUser({
        supabaseAdmin,
        userId: ownerUserId,
        title: "💰 GigRide Rental Payment Received",
        body:
          `${money(paidAmountCents)} collected • ` +
          `${money(platformRevenueCents)} GigRide fees • ` +
          `Booking ${String(bookingId).slice(0, 8)}`,
        data: {
          type: "owner_rental_payment_received",
          bookingId,
          paymentId,
          paidAmountCents,
          rentalSubtotalCents,
          driverFeeCents,
          hostFeeCents,
          platformRevenueCents,
        },
      });
    } else if (paymentType === "deposit") {
      await notifyUser({
        supabaseAdmin,
        userId: ownerUserId,
        title: "🔒 Security Deposit Received",
        body:
          `${money(paidAmountCents)} deposit collected • ` +
          `Booking ${String(bookingId).slice(0, 8)}`,
        data: {
          type: "owner_deposit_received",
          bookingId,
          paymentId,
          depositAmountCents: paidAmountCents,
        },
      });
    }
  } else {
    console.warn(
      "⚠️ GIGRIDE_OWNER_USER_ID is not configured; owner payment push skipped."
    );
  }
} catch (pushErr) {
  // A push failure must never cause Square to retry an already-applied payment.
  console.error(
    "❌ OWNER PAYMENT PUSH FAILED:",
    pushErr?.message || pushErr
  );
}

    return res.json({
      ok: true,
      duplicate: false,
    });
  } catch (e) {
    console.error("SQUARE WEBHOOK ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
});
module.exports = router;
