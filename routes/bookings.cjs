// routes/bookings.cjs
console.log("🔥 BOOKINGS ROUTES FILE LOADED:", __filename);
console.log("🔥 USING BOOKINGS ROUTE FILE:", __filename);
console.log("✅ bookings routes loaded");

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { notifyUser } = require("../utils/pushNotifications.cjs");

const router = express.Router();


/* ================================
   Supabase Clients
================================ */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================================
   Helpers
================================ */

function normStatus(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\w_]+/g, "");
}

function daysBetweenInclusive(startDate, endDate) {
  if (!startDate || !endDate) return 1;

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 1;
  }

  const startCopy = new Date(start);
  const endCopy = new Date(end);

  startCopy.setHours(0, 0, 0, 0);
  endCopy.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.round(
    (endCopy.getTime() - startCopy.getTime()) / msPerDay
  );

  return Math.max(diff, 1);
}

async function getUserFromReq(req) {
  const auth = req.headers.authorization || "";

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  const token = auth.replace("Bearer ", "");

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) return null;

  return data.user;
}

function calculateLateFeeCents({
  endDate,
  dropoffTime,
  completedAt,
  dailyRateCents,
}) {
  if (!endDate || !dropoffTime || !completedAt) {
    return {
      late_fee_cents: 0,
      late_minutes: 0,
      late_label: "No late fee",
    };
  }

  const scheduledReturn = new Date(`${endDate} ${dropoffTime}`);
  const actualReturn = new Date(completedAt);

  if (Number.isNaN(scheduledReturn.getTime())) {
    return {
      late_fee_cents: 0,
      late_minutes: 0,
      late_label: "Invalid return date",
    };
  }

  const lateMinutes = Math.max(
    0,
    Math.floor(
      (actualReturn.getTime() - scheduledReturn.getTime()) / 60000
    )
  );

  if (lateMinutes <= 30) {
    return {
      late_fee_cents: 0,
      late_minutes: lateMinutes,
      late_label: "Within 30 minute grace period",
    };
  }

  let fee = 0;
  let label = "";

  if (lateMinutes <= 120) {
    fee = Math.round(dailyRateCents * 0.25);
    label = "31 minutes–2 hours late";
  } else if (lateMinutes <= 360) {
    fee = Math.round(dailyRateCents * 0.5);
    label = "2–6 hours late";
  } else if (lateMinutes <= 1440) {
    fee = dailyRateCents;
    label = "6–24 hours late";
  } else {
    const extraDays = Math.ceil(lateMinutes / 1440);
    fee = dailyRateCents * extraDays;
    label = `${extraDays} extra day${extraDays > 1 ? "s" : ""} late`;
  }

  return {
    late_fee_cents: fee,
    late_minutes: lateMinutes,
    late_label: label,
  };
}

/* ================================
   GET /api/bookings
================================ */

router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================================
   POST /api/bookings (Create)
================================ */

/* ================================
   PATCH /api/bookings/:id/host-approve
================================ */
router.patch("/:id/host-approve", async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const bookingId = req.params.id;

    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from("bookings")
      .select("id,status,host_id,driver_id")
      .eq("id", bookingId)
      .single();

    if (fetchErr || !booking) {
      return res.status(404).json({
        error: "Booking not found",
        details: fetchErr?.message || null,
      });
    }

    if (booking.host_id !== user.id) {
      return res.status(403).json({
        error: "Not host",
        host_id: booking.host_id,
        authedUser: user.id,
      });
    }

    const raw = booking.status;
    const clean = normStatus(raw);

    console.log("🔥 APPROVE HIT", {
      file: __filename,
      bookingId,
      raw,
      clean,
      allowed: ["requested"],
      host_id: booking.host_id,
      authedUser: user.id,
    });

    if (!["requested"].includes(clean)) {
      return res.status(400).json({
        error: `Invalid booking status transition from "${raw}" to "pending"`,
        debug: { raw, clean },
      });
    }

    const { data: updated, error: updErr } = await supabaseAdmin
      .from("bookings")
      .update({ status: "pending", host_approved: true })
      .eq("id", bookingId)
      .select("*")
      .single();

    if (updErr) {
      return res.status(400).json({
        error: "Update failed",
        details: updErr.message,
      });
    }

    return res.json({ ok: true, booking: updated });
  } catch (e) {
    console.error("APPROVE ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

/* ================================
   POST /api/bookings/:id/start
================================ */
router.post("/:id/confirm-pickup", async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const bookingId = req.params.id;

    const { data: booking, error: bookingError } = await supabaseAdmin
  .from("bookings")
  .select(`
    id,
    status,
    host_id,
    driver_id,
    host_pickup_photos,
    driver_pickup_photos,
    start_odometer
  `)
  .eq("id", bookingId)
  .maybeSingle();

    if (bookingError || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (String(booking.host_id) !== String(user.id)) {
      return res.status(403).json({ error: "Only host can confirm pickup" });
    }

    if (booking.status !== "deposit_paid" && booking.status !== "pending") {
      return res.status(400).json({
        error: "Booking must be paid before pickup confirmation",
      });
    }

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "pickup_confirmed",
      })
      .eq("id", bookingId)
      .select("*")
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

   



    try {
      if (booking.driver_id) {
        await notifyUser({
          supabaseAdmin,
          userId: booking.driver_id,
          title: "🚗 Pickup Confirmed",
          body: "Your vehicle has been handed off. Drive safely.",
          data: { type: "pickup_confirmed", bookingId },
        });
      }

      if (booking.host_id) {
        await notifyUser({
          supabaseAdmin,
          userId: booking.host_id,
          title: "📍 Pickup Confirmed",
          body: "Vehicle handoff completed successfully.",
          data: { type: "pickup_confirmed", bookingId },
        });
      }

      console.log("✅ PICKUP PUSH SENT");
    } catch (pushErr) {
      console.log("pickup push failed:", pushErr);
    }

    return res.json({ ok: true, booking: updatedBooking });
  } catch (e) {
    console.error("confirm pickup error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});
router.post("/:id/start", async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const bookingId = req.params.id;
    const startOdometer = Number(req.body?.start_odometer);

    if (!Number.isFinite(startOdometer) || startOdometer < 0) {
      return res.status(400).json({ error: "Invalid starting odometer" });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
      .select("id, status, host_id, driver_id, pickup_photos,host_pickup_photos,driver_pickup_photos,start_odometer")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (String(booking.host_id) !== String(user.id)) {
      return res.status(403).json({ error: "Only host can start trip" });
    }

    if (booking.status !== "pickup_confirmed") {
      return res.status(400).json({
        error: "Booking must be pickup_confirmed before starting trip",
      });
    }

    const hostPickupPhotos = Array.isArray(booking.host_pickup_photos)
  ? booking.host_pickup_photos
  : [];

const driverPickupPhotos = Array.isArray(booking.driver_pickup_photos)
  ? booking.driver_pickup_photos
  : [];
console.log("START TRIP PHOTO DEBUG:", {
  bookingId,
  hostPickupCount: hostPickupPhotos.length,
  driverPickupCount: driverPickupPhotos.length,
  hostPickupRaw: booking.host_pickup_photos,
  driverPickupRaw: booking.driver_pickup_photos,
});

console.log("START TRIP DEBUG", {
  bookingId,
  hostPickupPhotos,
  driverPickupPhotos,
  hostCount: hostPickupPhotos.length,
  driverCount: driverPickupPhotos.length,
});

if (hostPickupPhotos.length < 9 || driverPickupPhotos.length < 9) {
  return res.status(400).json({
    error: "Both host and driver pickup photos are required before starting trip",
  });
}

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "active",
        start_odometer: startOdometer,
      })
      .eq("id", bookingId)
      .select("id, status, start_odometer")
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }
    try {
  if (booking?.driver_id) {
    await notifyUser({
      supabaseAdmin,
      userId: booking.driver_id,
      title: "🚘 Trip Started",
      body: "Your rental trip is now active.",
      data: {
        type: "trip_started",
        bookingId,
      },
    });
  }

  if (booking?.host_id) {
    await notifyUser({
      supabaseAdmin,
      userId: booking.host_id,
      title: "🚘 Trip Started",
      body: "Trip has officially started.",
      data: {
        type: "trip_started",
        bookingId,
      },
    });
  }

  console.log("✅ START TRIP PUSH SENT");
} catch (pushErr) {
  console.log("trip started push failed:", pushErr);
}

    return res.json({ ok: true, booking: updatedBooking });
  } catch (e) {
    console.error("start trip error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   POST /api/bookings/:id/complete
================================ */
router.post("/:id/complete", async (req, res) => {
  try {
    console.log("🔥🔥🔥 NEW COMPLETE ROUTE HIT:", req.params.id);
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const bookingId = req.params.id;
    const endOdometer = Number(req.body?.end_odometer);

    if (!Number.isFinite(endOdometer) || endOdometer < 0) {
      return res.status(400).json({ error: "Invalid ending odometer" });
    }

    const { data: booking, error: bookingError } = await supabaseAdmin
      .from("bookings")
     .select(`
  id,
  status,
  host_id,
  driver_id,
  vehicle_id,
  start_date,
  end_date,
  included_miles,
  unlimited_miles_selected,
  overage_rate_cents,
  start_odometer,
  host_return_photos,
  driver_return_photos,
  damage_fee_cents,
  cleaning_fee_cents,
  smoking_fee_cents,
  other_fee_cents,
  deposit_amount_cents,
  total_price_cents,
  dropoff_time,
  vehicles:vehicle_id(*)
`)
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (String(booking.host_id) !== String(user.id)) {
      return res.status(403).json({ error: "Only host can complete trip" });
    }

    if (booking.status !== "active") {
      return res.status(400).json({
        error: "Booking must be active before completing trip",
      });
    }

    const hostReturnPhotos = Array.isArray(booking.host_return_photos)
  ? booking.host_return_photos
  : [];

const driverReturnPhotos = Array.isArray(booking.driver_return_photos)
  ? booking.driver_return_photos
  : [];

if (hostReturnPhotos.length < 9 || driverReturnPhotos.length < 9) {
  return res.status(400).json({
    error: `Return photos missing. Host ${hostReturnPhotos.length}/9, Driver ${driverReturnPhotos.length}/9`,
  });
}

    const startOdometer = Number(booking.start_odometer || 0);

    if (!Number.isFinite(startOdometer) || startOdometer < 0) {
      return res.status(400).json({
        error: "Starting odometer is missing or invalid",
      });
    }

    if (endOdometer < startOdometer) {
      return res.status(400).json({
        error: "Ending odometer cannot be less than starting odometer",
      });
    }

    const totalMilesDriven = endOdometer - startOdometer;

    const rentalDays = daysBetweenInclusive(
      booking.start_date,
      booking.end_date
    );

    const includedMilesPerDay =
      Number(booking.included_miles || 0) > 0
        ? Number(booking.included_miles)
        : 250;

    const unlimitedMilesSelected = !!booking.unlimited_miles_selected;

    const allowedMiles = unlimitedMilesSelected
      ? 0
      : includedMilesPerDay * rentalDays;

    const mileageOverageMiles = unlimitedMilesSelected
      ? 0
      : Math.max(totalMilesDriven - allowedMiles, 0);

    const overageRateCents =
      Number(booking.overage_rate_cents || 0) > 0
        ? Number(booking.overage_rate_cents)
        : 0;

    const mileageOverageCents = mileageOverageMiles * overageRateCents;

    
   

    const depositAmountCents = Number(booking.deposit_amount_cents || 0);
    const depositRefundAmountCents = Math.max(
      depositAmountCents - totalExtraFeesCents,
      0
    );

    const grossAmountCents = Number(booking.total_price_cents || 0);
    const applicationFeeCents = Math.round(grossAmountCents * 0.08);
    const netAmountCents = Math.max(
      grossAmountCents - applicationFeeCents,
      0
    );
    const dailyRateCents =
  Number(booking?.vehicles?.daily_rate_cents || 0) ||
  Math.round(Number(booking?.vehicles?.daily_price || 0) * 100) ||
  Number(booking?.total_price_cents || 0);

// force future completion time for late fee testing
const completedAtDate = new Date();

const completedAt = completedAtDate.toISOString();

const payoutAvailableAt = new Date(
  completedAtDate.getTime() + 48 * 60 * 60 * 1000
).toISOString();

const depositHoldUntil = payoutAvailableAt;

const late = calculateLateFeeCents({
  endDate: booking.end_date,
  dropoffTime: booking.dropoff_time,
  completedAt,
  dailyRateCents,
});
const totalExtraFeesCents =
  Number(booking.damage_fee_cents || 0) +
  Number(booking.cleaning_fee_cents || 0) +
  Number(booking.smoking_fee_cents || 0) +
  Number(booking.other_fee_cents || 0) +
  Number(mileageOverageCents || 0) +
  Number(late.late_fee_cents || 0);
console.log("🧾 LATE FEE DEBUG:", {
  bookingId,
  end_date: booking.end_date,
  dropoff_time: booking.dropoff_time,
  completedAt,
  dailyRateCents,
  late,
});

    const { data: updatedBooking, error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "completed",
        end_odometer: endOdometer,
        total_miles_driven: totalMilesDriven,
        mileage_overage_miles: mileageOverageMiles,
        mileage_overage_cents: mileageOverageCents,
        deposit_hold_until: depositHoldUntil,
        deposit_refund_amount_cents: depositRefundAmountCents,
        dispute_status: "none",
        completed_at: completedAt,
late_fee_cents: late.late_fee_cents,
late_minutes: late.late_minutes,
late_fee_label: late.late_label,
      })
      .eq("id", bookingId)
.select(
  "id, status, start_odometer, end_odometer, total_miles_driven, mileage_overage_miles, mileage_overage_cents, deposit_hold_until, deposit_refund_amount_cents, host_return_photos, driver_return_photos, dispute_status"
)
.maybeSingle();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    try {
  if (booking?.driver_id) {
    await notifyUser({
      supabaseAdmin,
      userId: booking.driver_id,
      title: "✅ Trip Completed",
      body: "Your trip is complete. Deposit settlement has started.",
      data: {
        type: "trip_completed",
        bookingId,
      },
    });
  }

  if (booking?.host_id) {
    await notifyUser({
      supabaseAdmin,
      userId: booking.host_id,
      title: "✅ Trip Completed",
      body: "The trip is complete. Your payout and settlement are being processed.",
      data: {
        type: "trip_completed",
        bookingId,
      },
    });
  }
} catch (pushErr) {
  console.log("Trip completed push failed:", pushErr);
}

    const { data: existingPayout, error: existingPayoutError } =
      await supabaseAdmin
        .from("host_payouts")
        .select("id, status")
        .eq("booking_id", bookingId)
        .maybeSingle();

    if (existingPayoutError) {
      console.error("❌ payout lookup failed:", existingPayoutError);
      return res.status(500).json({ error: existingPayoutError.message });
    }

    if (!existingPayout) {
      const { error: payoutInsertError } = await supabaseAdmin
        .from("host_payouts")
        .insert({
          host_id: booking.host_id,
          vehicle_id: booking.vehicle_id,
          booking_id: bookingId,
          gross_amount_cents: grossAmountCents,
          application_fee_cents: applicationFeeCents,
          net_amount_cents: netAmountCents,
          status: "pending",
          payout_available_at: payoutAvailableAt,
          period_start: completedAt,
          period_end: completedAt,
        });

      if (payoutInsertError) {
        console.error("❌ payout insert failed:", payoutInsertError);
        return res.status(500).json({ error: payoutInsertError.message });
      }
    }

    return res.json({
      ok: true,
      booking: updatedBooking,
      mileage: {
        total_miles_driven: totalMilesDriven,
        mileage_overage_miles: mileageOverageMiles,
        mileage_overage_cents: mileageOverageCents,
      },
      settlement: {
        total_extra_fees_cents: totalExtraFeesCents,
        deposit_amount_cents: depositAmountCents,
        deposit_refund_amount_cents: depositRefundAmountCents,
        payout_available_at: payoutAvailableAt,
      },
      payout: {
        gross_amount_cents: grossAmountCents,
        application_fee_cents: applicationFeeCents,
        net_amount_cents: netAmountCents,
      },
    });
  } catch (e) {
    console.error("complete trip error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   POST /api/bookings/:id/damage-report
================================ */
router.post("/:id/damage-report", async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const bookingId = String(req.params.id || "").trim();

    const {
      damage_fee_cents = 0,
      cleaning_fee_cents = 0,
      smoking_fee_cents = 0,
      other_fee_cents = 0,
      damage_notes = "",
    } = req.body || {};

    const { data: booking, error: fetchErr } = await supabaseAdmin
      .from("bookings")
      .select("id, host_id, status, deposit_amount_cents")
      .eq("id", bookingId)
      .single();

    if (fetchErr || !booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (String(booking.host_id) !== String(user.id)) {
      return res.status(403).json({ error: "Only host can report damage" });
    }

    const status = normStatus(booking.status);

    if (!["active", "completed"].includes(status)) {
      return res.status(400).json({
        error: "Damage can only be reported after trip starts or completes",
      });
    }

    const totalFees =
      Number(damage_fee_cents) +
      Number(cleaning_fee_cents) +
      Number(smoking_fee_cents) +
      Number(other_fee_cents);

    if (totalFees > Number(booking.deposit_amount_cents || 0)) {
      return res.status(400).json({
        error: "Fees cannot exceed deposit amount",
      });
    }

    const updatePayload = {
      damage_fee_cents,
      cleaning_fee_cents,
      smoking_fee_cents,
      other_fee_cents,
      damage_notes,
      damage_reported_at: new Date().toISOString(),
      damage_reported_by: user.id,
      deposit_refund_amount_cents: Math.max(
        Number(booking.deposit_amount_cents || 0) - totalFees,
        0
      ),
    };

    if (status === "completed") {
      updatePayload.dispute_status = "hold";
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("bookings")
      .update(updatePayload)
      .eq("id", bookingId)
      .select("*")
      .single();

    if (updateErr) {
      return res.status(400).json({ error: updateErr.message });
    }

  

    return res.json({ ok: true, booking: updated });
  } catch (e) {
    console.error("DAMAGE REPORT ERROR:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;







