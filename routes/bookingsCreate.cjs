const express = require("express");
const router = express.Router();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { getMileageSnapshot } = require("../utils/mileage.cjs");
function tripDays(startDate, endDate) {
  if (!startDate || !endDate) return 1;

  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 1;
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.ceil((end.getTime() - start.getTime()) / msPerDay);

  return Math.max(1, diff);
}

function calculateRentalPriceCents(vehicle, days) {
  const dailyRateCents =
    Number(vehicle.daily_rate_cents) ||
    Math.round(Number(vehicle.daily_price || 0) * 100);

  const weeklyRateCents =
    Number(vehicle.weekly_rate_cents) ||
    Math.round(dailyRateCents * 7 * 0.85);

  const monthlyRateCents =
    Number(vehicle.monthly_rate_cents) ||
    Math.round(dailyRateCents * 30 * 0.75);

  if (!Number.isFinite(dailyRateCents) || dailyRateCents <= 0) {
    throw new Error("Vehicle has an invalid daily rate.");
  }

  let remainingDays = days;
  let total = 0;

  const months = Math.floor(remainingDays / 30);
  total += months * monthlyRateCents;
  remainingDays -= months * 30;

  const weeks = Math.floor(remainingDays / 7);
  total += weeks * weeklyRateCents;
  remainingDays -= weeks * 7;

  total += remainingDays * dailyRateCents;

  return {
    total,
    dailyRateCents,
    weeklyRateCents,
    monthlyRateCents,
    months,
    weeks,
    days: remainingDays,
  };
}

router.post("/", async (req, res) => {
  try {
    const {
  vehicle_id,
  rental_type,
  start_date,
  end_date,
  unlimited_miles_selected,
  pickup_time,
  dropoff_time,
} = req.body;

// 🔐 Authenticate driver before any booking database work
const authHeader = req.headers.authorization || "";

if (!authHeader.startsWith("Bearer ")) {
  return res.status(401).json({
    error: "Unauthorized",
  });
}

const token = authHeader.slice(7);

const {
  data: { user },
  error: authError,
} = await supabaseAdmin.auth.getUser(token);

if (authError || !user) {
  return res.status(401).json({
    error: "Unauthorized",
  });
}

const driverId = user.id;

    // 🔍 fetch vehicle mileage settings
    const { data: vehicle, error: vehicleErr } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", vehicle_id)
      .single();

    if (vehicleErr || !vehicle) {
      return res.status(404).json({ error: "Vehicle not found" });
    }

    if (vehicle.is_test_vehicle) {
  return res.status(403).json({
    error: "This vehicle is not available for public booking.",
  });
}

if (!start_date || !end_date) {
  return res.status(400).json({
    error: "Start date and end date are required.",
  });
}

const start = new Date(`${start_date}T12:00:00`);
const end = new Date(`${end_date}T12:00:00`);

if (
  Number.isNaN(start.getTime()) ||
  Number.isNaN(end.getTime()) ||
  end <= start
) {
  return res.status(400).json({
    error: "Invalid booking dates.",
  });
}

const rentalDays = tripDays(start_date, end_date);

const serverRentalType =
  rentalDays >= 30
    ? "monthly"
    : rentalDays >= 7



    ? "weekly"
    : "daily";

// 📊 mileage snapshot
const mileage = getMileageSnapshot({
  rentalType: serverRentalType,
  vehicle,
  unlimitedSelected: unlimited_miles_selected,
});

    const rentalPricing = calculateRentalPriceCents(
  vehicle,
  rentalDays
);

const baseRentalTotalCents = rentalPricing.total;

    const protectionFeeDailyCents = Number(
  vehicle.insurance_enabled
    ? vehicle.insurance_protection_fee_cents || 399
    : 0
);

const insuranceTotalCents =
  protectionFeeDailyCents * rentalDays;

const finalTotal =
  baseRentalTotalCents +
  Number(mileage.unlimited_miles_fee_cents || 0) +
  insuranceTotalCents;

   const { data: bookingConflicts, error: bookingConflictError } = await supabaseAdmin
  .from("bookings")
  .select("id,start_date,end_date,status")
  .eq("vehicle_id", vehicle_id)
  .in("status", [
  "requested",
  "pending",
  "approved",
  "deposit_paid",
  "pickup_confirmed",
  "active",
])
  .lte("start_date", end_date)
  .gte("end_date", start_date);

if (bookingConflictError) {
  return res.status(500).json({
    error: bookingConflictError.message,
  });
}

if (bookingConflicts?.length) {
  return res.status(400).json({
    error: "Vehicle is unavailable for selected dates.",
  });
}

const { data: blockedDates, error: blockedDatesError } = await supabaseAdmin
  .from("vehicle_unavailable_dates")
  .select("id,start_date,end_date")
  .eq("vehicle_id", vehicle_id)
  .lte("start_date", end_date)
  .gte("end_date", start_date);

if (blockedDatesError) {
  return res.status(500).json({
    error: blockedDatesError.message,
  });
}

if (blockedDates?.length) {
  return res.status(400).json({
    error: "Vehicle is blocked by the host for selected dates.",
  });
}

if (vehicle.host_id === driverId) {
  return res.status(400).json({
    error: "You cannot book your own vehicle.",
  });
}

      // 💾 insert booking
    const { data, error } = await supabaseAdmin
      .from("bookings")
      .insert({
        vehicle_id,
        host_id: vehicle.host_id,
        driver_id: driverId,
        rental_type: serverRentalType,
        start_date,
        end_date,
        total_price_cents: finalTotal,
        insurance_provider: vehicle.insurance_enabled
  ? vehicle.insurance_provider || "abi"
  : null,

insurance_protection_fee_cents: protectionFeeDailyCents,

insurance_total_cents: insuranceTotalCents,
        status: "requested",
        metadata: {
  is_test: false,
  pricing: {
    rental_days: rentalDays,
    daily_rate_cents: rentalPricing.dailyRateCents,
    weekly_rate_cents: rentalPricing.weeklyRateCents,
    monthly_rate_cents: rentalPricing.monthlyRateCents,
    months_charged: rentalPricing.months,
    weeks_charged: rentalPricing.weeks,
    remaining_days_charged: rentalPricing.days,
    base_rental_total_cents: baseRentalTotalCents,
  },
},
        pickup_time,
        dropoff_time,

        ...mileage,
      })
      .select("*")
      .single();

    
         if (error) {
      return res.status(400).json({ error: error.message });
    }

    // 💬 create conversation for host/driver messaging
    const { error: conversationError } = await supabaseAdmin
      .from("conversations")
      .upsert(
        {
          booking_id: data.id,
          driver_id: data.driver_id,
          host_id: data.host_id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "booking_id" }
      );

    if (conversationError) {
      console.log("CREATE CONVERSATION ERROR:", conversationError.message);
    }

        return res.json({ ok: true, booking: data });
  } catch (e) {
    console.log("CREATE BOOKING ERROR:", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;