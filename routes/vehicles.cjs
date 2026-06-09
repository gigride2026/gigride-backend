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
      host_id,
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

    if (!host_id) return res.status(400).json({ error: "Missing host_id" });

    if (!make || !model || !year || !daily_price || !city || !vin) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const payload = {
      host_id,
      make: String(make).trim(),
      model: String(model).trim(),
      year: String(year).trim(),
      daily_price: Number(daily_price),
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

    if (error) return res.status(400).json({ error: error.message });

    return res.json({ vehicle: data });
  } catch (e) {
    console.error("POST /api/vehicles error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;