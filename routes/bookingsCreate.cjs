const express = require("express");
const router = express.Router();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { getMileageSnapshot } = require("../utils/mileage.cjs");
const { DateTime } = require("luxon");
function parseBookingDateTime(dateValue, timeValue, timezone) {
  if (!dateValue || !timeValue || !timezone) return null;

  const normalizedTime = String(timeValue)
    .trim()
    .replace(/[\u00A0\u202F]/g, " ")
    .replace(/\s+/g, " ");

  const input = `${String(dateValue).trim()} ${normalizedTime}`;

  const formats = [
    "yyyy-MM-dd h:mm a",
    "yyyy-MM-dd hh:mm a",
    "yyyy-MM-dd H:mm",
    "yyyy-MM-dd HH:mm",
  ];

  for (const format of formats) {
    const result = DateTime.fromFormat(input, format, {
      zone: timezone,
      locale: "en-US",
      setZone: true,
    });

    const requestedWallTime = DateTime.fromFormat(input, format, {
      zone: "UTC",
      locale: "en-US",
      setZone: true,
    });

    if (!result.isValid || !requestedWallTime.isValid) {
      continue;
    }

    const sameWallTime =
      result.year === requestedWallTime.year &&
      result.month === requestedWallTime.month &&
      result.day === requestedWallTime.day &&
      result.hour === requestedWallTime.hour &&
      result.minute === requestedWallTime.minute;

    // Reject nonexistent local times during the spring DST transition.
    if (!sameWallTime) {
      continue;
    }

    // Reject ambiguous local times during the fall DST transition.
    if (
      typeof result.getPossibleOffsets === "function" &&
      result.getPossibleOffsets().length !== 1
    ) {
      continue;
    }

    return result;
  }

  return null;
}

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

if (!pickup_time || !dropoff_time) {
  return res.status(400).json({
    error: "Pickup time and drop-off time are required.",
  });
}

const vehicleTimezone = String(vehicle.timezone || "").trim();

if (!vehicleTimezone || !DateTime.local().setZone(vehicleTimezone).isValid) {
  console.error("Invalid vehicle timezone:", {
    vehicle_id,
    timezone: vehicle.timezone,
  });

  return res.status(500).json({
    error: "Vehicle timezone is not configured correctly.",
  });
}

const pickupAt = parseBookingDateTime(
  start_date,
  pickup_time,
  vehicleTimezone
);

const dropoffAt = parseBookingDateTime(
  end_date,
  dropoff_time,
  vehicleTimezone
);

if (!pickupAt || !dropoffAt) {
  return res.status(400).json({
    error: "Invalid pickup or drop-off time.",
  });
}

if (dropoffAt.toMillis() <= pickupAt.toMillis()) {
  return res.status(400).json({
    error: "Drop-off must be after pickup.",
  });
}

const advanceNoticeMinutes = Number(
  vehicle.minimum_advance_notice_minutes || 0
);

const earliestPickupAt = DateTime.now()
  .setZone(vehicleTimezone)
  .plus({ minutes: advanceNoticeMinutes });

if (pickupAt.toMillis() < earliestPickupAt.toMillis()) {
  return res.status(400).json({
    error: `This vehicle requires at least ${advanceNoticeMinutes} minutes of advance notice.`,
  });
}

const rentalDays = tripDays(start_date, end_date);

const depositAmountCents =
  rentalDays >= 30
    ? 50000
    : rentalDays >= 15
    ? 40000
    : rentalDays >= 8
    ? 30000
    : rentalDays >= 4
    ? 25000
    : 20000;

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

   const turnaroundMinutes = Number(
  vehicle.turnaround_minutes || 0
);

const bookingConflictsQuery = supabaseAdmin
    .from("bookings")
    .select("id,start_date,end_date,pickup_time,dropoff_time,status")
    .eq("vehicle_id", vehicle_id)
    .in("status", [
      "requested",
      "pending",
      "approved",
      "deposit_paid",
      "pickup_confirmed",
      "active",
      "completed",
    ]);

const turnaroundDays = Math.ceil(turnaroundMinutes / (24 * 60));

const candidateStartDate = pickupAt
  .minus({ days: turnaroundDays })
  .toISODate();

const candidateEndDate = dropoffAt
  .plus({ days: turnaroundDays })
  .toISODate();

const { data: bookingConflicts, error: bookingConflictError } =
  await bookingConflictsQuery
    .lte("start_date", candidateEndDate)
    .gte("end_date", candidateStartDate);

if (bookingConflictError) {
  return res.status(500).json({
    error: bookingConflictError.message,
  });
}

for (const existingBooking of bookingConflicts || []) {
  const existingPickupAt = parseBookingDateTime(
    existingBooking.start_date,
    existingBooking.pickup_time,
    vehicleTimezone
  );

  const existingDropoffAt = parseBookingDateTime(
    existingBooking.end_date,
    existingBooking.dropoff_time,
    vehicleTimezone
  );

  if (!existingPickupAt || !existingDropoffAt) {
    console.error("Existing booking has invalid date/time:", {
      booking_id: existingBooking.id,
    });

    return res.status(500).json({
      error: "Vehicle availability could not be verified.",
    });
  }

  const existingAvailableAgainAt = existingDropoffAt.plus({
    minutes: turnaroundMinutes,
  });

  const newAvailableAgainAt = dropoffAt.plus({
    minutes: turnaroundMinutes,
  });

  const conflicts =
    pickupAt.toMillis() < existingAvailableAgainAt.toMillis() &&
    newAvailableAgainAt.toMillis() > existingPickupAt.toMillis();

  if (conflicts) {
    return res.status(400).json({
      error: "Vehicle is unavailable for the selected pickup and drop-off times.",
    });
  }
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
        pickup_time,
        dropoff_time,
        total_price_cents: finalTotal,
        deposit_amount_cents: depositAmountCents,
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