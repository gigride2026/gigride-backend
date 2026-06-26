const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

const SQUARE_BASE_URL =
  process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

const SQUARE_VERSION = "2025-04-16";

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
    updatedBooking.total_price_cents ||
      updatedBooking.rental_subtotal_cents ||
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

router.post("/test-create-payout/:bookingId", async (req, res) => {
  try {
    const bookingId = String(req.params.bookingId || "").trim();

    if (!bookingId) {
      return res.status(400).json({ error: "booking id required" });
    }

    const { data: updatedBooking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) throw bookingError;

    if (!updatedBooking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const grossCents = Number(
      updatedBooking.total_price_cents ||
        updatedBooking.rental_subtotal_cents ||
        0
    );

    const platformFeeCents = Math.round(grossCents * 0.08);
    const hostPayoutCents = Math.max(0, grossCents - platformFeeCents);

    const payoutAvailableAt = updatedBooking.end_date
      ? new Date(
          new Date(updatedBooking.end_date).getTime() + 24 * 60 * 60 * 1000
        ).toISOString()
      : null;

    const { data: payout, error: payoutError } = await supabaseAdmin
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
      )
      .select("*")
      .maybeSingle();

    if (payoutError) throw payoutError;

    return res.json({
      ok: true,
      booking_id: bookingId,
      gross_cents: grossCents,
      platform_fee_cents: platformFeeCents,
      host_payout_cents: hostPayoutCents,
      payout,
    });
  } catch (e) {
    console.error("TEST CREATE PAYOUT ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;