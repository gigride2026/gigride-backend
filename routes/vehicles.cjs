const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const authMiddleware = require("../middlewares/auth.cjs");

// GET /api/vehicles?status=available&city=Atlanta&q=jeep
router.get("/", async (req, res) => {
  try {
    const { status, city, q } = req.query;

    let query = supabaseAdmin
  .from("vehicles")
  .select("*")
  .eq("is_test_vehicle", false)
  .order("created_at", { ascending: false });

    if (status) query = query.eq("status", String(status));
    if (city) query = query.ilike("city", `%${String(city)}%`);

    if (q) {
      const term = `%${String(q)}%`;
      query = query.or(
        `make.ilike.${term},model.ilike.${term},vin.ilike.${term}`
      );
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    return res.json({ vehicles: data || [] });
  } catch (e) {
    console.error("GET /api/vehicles error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/vehicles
router.post("/", authMiddleware, async (req, res) => {
  try {
    const {
  make,
  model,
  trim,
  year,
  daily_price,
  weekly_rate_cents,
  monthly_rate_cents,
  city,
  vin,
  license_plate,
  plate_state,
  verification_status,
  vin_decoded,
  vin_decode_source,
  photos,
  image_url,

  insurance_required,
  insurance_enabled,

  daily_miles_included,
  overage_rate_cents,
  allows_unlimited_miles,
  unlimited_miles_price_cents,

  status,
  is_test_vehicle,
} = req.body || {};

    // 🔐 Authenticated by authMiddleware
    const hostId = req.user.id;

    // ✅ Required fields
   if (!make || !model || !year || daily_price == null || !city) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    // 💵 Server-side pricing validation
    const daily = Number(daily_price);

    if (!Number.isFinite(daily) || daily < 35 || daily > 200) {
      return res.status(400).json({
        error: "Daily rate must be between $35 and $200.",
      });
    }

    const dailyRateCents = Math.round(daily * 100);

    const requestedWeeklyRateCents = Number(weekly_rate_cents);
    const requestedMonthlyRateCents = Number(monthly_rate_cents);

    const weeklyRateCents =
      Number.isFinite(requestedWeeklyRateCents) && requestedWeeklyRateCents > 0
        ? Math.round(requestedWeeklyRateCents)
        : Math.round(daily * 7 * 0.85 * 100);

    const monthlyRateCents =
      Number.isFinite(requestedMonthlyRateCents) && requestedMonthlyRateCents > 0
        ? Math.round(requestedMonthlyRateCents)
        : Math.round(daily * 30 * 0.75 * 100);

    const includedMiles = Number(daily_miles_included ?? 250);
const overageRateCents = Number(overage_rate_cents ?? 25);
const unlimitedMilesPriceCents = Number(unlimited_miles_price_cents ?? 0);

if (
  !Number.isFinite(includedMiles) ||
  includedMiles < 0 ||
  includedMiles > 1000
) {
  return res.status(400).json({
    error: "Daily included mileage must be between 0 and 1000 miles.",
  });
}

if (
  !Number.isFinite(overageRateCents) ||
  overageRateCents < 0 ||
  overageRateCents > 500
) {
  return res.status(400).json({
    error: "Mileage overage rate must be between $0.00 and $5.00 per mile.",
  });
}

if (
  !Number.isFinite(unlimitedMilesPriceCents) ||
  unlimitedMilesPriceCents < 0 ||
  unlimitedMilesPriceCents > 20000
) {
  return res.status(400).json({
    error: "Unlimited mileage price must be between $0 and $200 per day.",
  });
}

    // 👤 Verify host profile is complete
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone, avatar_url, city, identity_status, identity_verified")
      .eq("id", hostId)
      .single();

    if (profileErr) {
      return res.status(400).json({
        error: profileErr.message,
      });
    }

    if (
      !profile?.full_name ||
      !profile?.phone ||
      !profile?.avatar_url ||
      !profile?.city
    ) {
      return res.status(403).json({
        error:
          "Complete your host profile before listing a vehicle. Full name, phone, profile photo, and city are required.",
      });
    }

    const isIdentityApproved =
  profile.identity_verified === true ||
  profile.identity_status === "verified";

if (!isIdentityApproved) {
  return res.status(403).json({
    error: "Identity verification is required before listing a vehicle.",
  });
}

    // 🚗 Vehicle payload
    const payload = {
  host_id: hostId,

  make: String(make).trim(),
  model: String(model).trim(),
  trim: trim ? String(trim).trim() : null,
  year: Number(year),

  daily_price: daily,
  daily_rate_cents: dailyRateCents,
  weekly_rate_cents: weeklyRateCents,
  monthly_rate_cents: monthlyRateCents,

  city: String(city).trim(),

  vin: vin ? String(vin).trim().toUpperCase() : null,
  license_plate: license_plate
    ? String(license_plate).trim().toUpperCase()
    : null,
  plate_state: plate_state
    ? String(plate_state).trim().toUpperCase()
    : "GA",

  verification_status: verification_status
    ? String(verification_status)
    : "not_submitted",

  vin_decoded: Boolean(vin_decoded),
  vin_decode_source: vin_decode_source
    ? String(vin_decode_source)
    : null,

  photos: Array.isArray(photos) ? photos : [],
  image_url: image_url ? String(image_url) : null,

  insurance_required: Boolean(insurance_required),
insurance_enabled: Boolean(insurance_enabled),
insurance_provider: insurance_enabled
  ? "abi"
  : null,
insurance_protection_fee_cents: insurance_enabled
  ? 399
  : 0,

  daily_miles_included: includedMiles,
overage_rate_cents: overageRateCents,
allows_unlimited_miles: Boolean(allows_unlimited_miles),
unlimited_miles_price_cents: allows_unlimited_miles
  ? unlimitedMilesPriceCents
  : 0,



  status: status ? String(status) : "available",
  is_test_vehicle: Boolean(is_test_vehicle),
};

    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .insert([payload])
      .select("*")
      .single();

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    return res.json({
      vehicle: data,
    });
  } catch (e) {
    console.error("POST /api/vehicles error:", e);

    return res.status(500).json({
      error: "Server error",
    });
  }
});

module.exports = router;
