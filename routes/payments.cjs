// routes/payments.cjs
console.log("💳 payments routes loaded:", __filename);
console.log(
  "STRIPE KEY PREFIX:",
  String(process.env.STRIPE_SECRET_KEY || "").slice(0, 12)
);

const express = require("express");
const router = express.Router();

const stripe = require("../utils/stripeClient.cjs");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { calculateRentalTax } = require("../utils/tax.cjs");

// ================================
// Helpers
// ================================
function cleanEnv(v) {
  return String(v || "").trim().replace(/^"+|"+$/g, "");
}

function cleanUrl(u) {
  return String(u || "").trim().replace(/\/$/, "");
}

function daysBetweenInclusive(startDate, endDate) {
  if (!startDate || !endDate) return 1;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1;

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.round((end.getTime() - start.getTime()) / msPerDay);

  return Math.max(diff, 1);
}

function calculateDepositCents(startDate, endDate) {
  const tripDays = daysBetweenInclusive(startDate, endDate);

  if (tripDays >= 30) return 50000; // $500
  if (tripDays >= 15) return 40000; // $400
  if (tripDays >= 8) return 30000;  // $300
  if (tripDays >= 4) return 25000;  // $250
  return 20000; // $200
}
function pickBookingId(req) {
  return (
    req.body?.booking_id ||
    req.body?.bookingId ||
    req.query?.booking_id ||
    req.query?.bookingId ||
    null
  );
}

async function getUserFromReq(req) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) return null;

    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return null;

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error) {
      console.error("❌ getUserFromReq auth error:", error.message);
      return null;
    }

    return data?.user || null;
  } catch (e) {
    console.error("❌ getUserFromReq crashed:", e);
    return null;
  }
}

// ================================
// Deposit Checkout Session
// ================================
router.post("/deposit/checkout-session", async (req, res) => {
  try {
    const bookingId = req.body?.booking_id;
    const successUrl = req.body?.success_url;
    const cancelUrl = req.body?.cancel_url;

    if (!bookingId) {
      return res.status(400).json({ error: "booking_id is required" });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({ error: "Missing bearer token" });
    }

    const { data: userData, error: userErr } =
      await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user?.id) {
      return res.status(401).json({ error: "Invalid user" });
    }

    const userId = userData.user.id;

    const { data: booking, error: bookingErr } = await supabaseAdmin
      .from("bookings")
      .select("id, driver_id, start_date, end_date, deposit_amount_cents, status")
      .eq("id", bookingId)
      .single();

    if (bookingErr || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (String(booking.driver_id) !== String(userId)) {
      return res.status(403).json({ error: "Not your booking" });
    }

    const depositAmountCents = calculateDepositCents(
      booking.start_date,
      booking.end_date
    );

    const { error: updateErr } = await supabaseAdmin
      .from("bookings")
      .update({
        deposit_amount_cents: depositAmountCents,
      })
      .eq("id", bookingId);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: {
              name: "Refundable security deposit",
              description: `Booking ${bookingId}`,
            },
            unit_amount: 100,
          },
        },
      ],
      metadata: {
        booking_id: bookingId,
        payment_type: "deposit",
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    const { error: sessionUpdateErr } = await supabaseAdmin
      .from("bookings")
      .update({
        stripe_checkout_session_id: session.id,
      })
      .eq("id", bookingId);

    if (sessionUpdateErr) {
      return res.status(500).json({ error: sessionUpdateErr.message });
    }

    return res.json({
      checkout_url: session.url,
      deposit_amount_cents: depositAmountCents,
    });
  } catch (err) {
    console.error("DEPOSIT CHECKOUT ERROR:", err);
    return res.status(500).json({
      error: err?.message || "Failed to create deposit checkout session",
    });
  }
});

// ================================
// Rental Checkout Session
// ================================
router.post("/rental/checkout-session", async (req, res) => {
  console.log("🔥 RENTAL CHECKOUT HIT");
console.log("RENTAL BODY:", req.body);

  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const bookingId = pickBookingId(req);
    console.log("🧾 RENTAL bookingId:", bookingId);
    if (!bookingId) {
      return res.status(400).json({ error: "booking_id required" });
    }

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    console.log("🧾 RENTAL BOOKING:", booking);
    const { data: hostProfile, error: hostProfileError } =
  await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", booking.host_id)
    .maybeSingle();

if (hostProfileError) {
  return res.status(500).json({ error: hostProfileError.message });
}

if (!hostProfile?.stripe_account_id) {
  return res.status(400).json({
    error: "Host has not completed Stripe payout setup.",
  });
}
    console.log("HOST ID:", booking.host_id);
console.log("VEHICLE ID:", booking.vehicle_id);

    const rentalSubtotalCents = Number(
  booking.rental_subtotal_cents || 0
);

const driverFeeCents = Number(
  booking.driver_fee_cents || 0
);

const protectionFeeCents = Number(
  booking.insurance_total_cents || 0
);
    console.log("🧾 RENTAL subtotal:", rentalSubtotalCents);
console.log("🧾 DRIVER fee:", driverFeeCents);

    if (!Number.isFinite(rentalSubtotalCents) || rentalSubtotalCents <= 0) {
      return res.status(400).json({
        error: "Rental subtotal invalid (must be > 0)",
      });
    }

    // Fetch vehicle for location-based tax
    const { data: vehicle, error: vehicleError } = await supabaseAdmin
  .from("vehicles")
  .select("city")
  .eq("id", booking.vehicle_id)
  .maybeSingle();

    if (vehicleError) {
      return res.status(500).json({ error: vehicleError.message });
    }
    console.log("🧾 VEHICLE for tax:", vehicle);

    // Calculate tax from pickup location
    const tax = calculateRentalTax({
  subtotalCents: rentalSubtotalCents,
  city: vehicle?.city,
  county: "Fulton",
  state: "GA",
});

    console.log("💰 TAX CALCULATION:", tax);

    const totalPriceCents =
  rentalSubtotalCents +
  driverFeeCents +
  protectionFeeCents;
  const platformFeeCents = Math.round(rentalSubtotalCents * 0.08);
const hostPayoutCents = rentalSubtotalCents - platformFeeCents;

// Stripe transfers total minus application fee to the host.
// This keeps taxes/protection/driver fees + GigRide's 8% with GigRide.
const applicationFeeAmountCents = totalPriceCents - hostPayoutCents;

    const successUrl =
      cleanUrl(req.body?.success_url) ||
      `${cleanEnv(process.env.APP_SUCCESS_URL)}?booking_id=${encodeURIComponent(
        bookingId
      )}`;

    const cancelUrl =
      cleanUrl(req.body?.cancel_url) ||
      `${cleanEnv(process.env.APP_CANCEL_URL)}?booking_id=${encodeURIComponent(
        bookingId
      )}`;

    console.log("🧾 Creating rental checkout session...");
      const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      automatic_tax: { enabled: true },
billing_address_collection: "required",
      
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 100,
            product_data: { name: "GigRide rental subtotal" },
          },
          quantity: 1,
        },

        ...(driverFeeCents > 0
          ? [
              {
                price_data: {
                  currency: "usd",
                  unit_amount: driverFeeCents,
                  product_data: { name: "GigRide driver fee" },
                },
                quantity: 1,
              },
            ]
          : []),
          ...(protectionFeeCents > 0
  ? [
      {
        price_data: {
          currency: "usd",
          unit_amount: protectionFeeCents,
          product_data: {
            name: "GigRide Protection Fee",
          },
        },
        quantity: 1,
      },
    ]
  : []),

      ],
      metadata: {
  booking_id: bookingId,
  payment_type: "rental",
  jurisdiction: String(tax.jurisdiction),
  sales_tax_cents: String(tax.salesTaxCents),
  rental_tax_cents: String(tax.rentalTaxCents),
  total_tax_cents: String(tax.totalTaxCents),
  total_amount_cents: String(totalPriceCents),
},
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    console.log("✅ RENTAL SESSION CREATED:", session.id);

    return res.json({
      ok: true,
      checkout_url: session.url,
      checkout_session_id: session.id,
      subtotal_cents: rentalSubtotalCents,
      driver_fee_cents: driverFeeCents,
      sales_tax_cents: tax.salesTaxCents,
      rental_tax_cents: tax.rentalTaxCents,
      total_tax_cents: tax.totalTaxCents,
      total_amount_cents: totalPriceCents,
      jurisdiction: tax.jurisdiction,
    });
  } catch (e) {
    console.error("💥 rental error:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router; 

