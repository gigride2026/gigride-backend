const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

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
router.post("/", async (req, res) => {
  try {
    const {
      make,
      model,
      year,
      daily_price,
      city,
      vin,
      photos,
      insurance_required,
      status,
      is_test_vehicle,
    } = req.body || {};

    // 🔐 Authenticate host
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");

    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const hostId = user.id;

    // ✅ Required fields
    if (!make || !model || !year || daily_price == null || !city || !vin) {
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
    const weeklyRateCents = Math.round(daily * 7 * 0.85 * 100);
    const monthlyRateCents = Math.round(daily * 30 * 0.75 * 100);

    // 👤 Verify host profile is complete
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("full_name, phone, avatar_url, city, identity_status")
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

    // 🚗 Vehicle payload
    const payload = {
      host_id: hostId,
      make: String(make).trim(),
      model: String(model).trim(),
      year: String(year).trim(),

      daily_price: daily,
      daily_rate_cents: dailyRateCents,
      weekly_rate_cents: weeklyRateCents,
      monthly_rate_cents: monthlyRateCents,

      city: String(city).trim(),
      vin: String(vin).trim().toUpperCase(),
      photos: Array.isArray(photos) ? photos : [],
      insurance_required: Boolean(insurance_required),
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