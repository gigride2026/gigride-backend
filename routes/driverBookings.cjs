const express = require("express");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SERVICE ROLE KEY exists:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// 🔑 middleware: extract JWT from Authorization header
function getSupabaseClient(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }

  const token = authHeader.replace("Bearer ", "");

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

router.get("/driver/bookings", async (req, res) => {
  try {
    const supabase = getSupabaseClient(req);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return res.status(401).json({ error: "Invalid user" });
    }

    const { data: bookings, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("driver_id", user.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({
      driver_id: user.id,
      bookings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;


