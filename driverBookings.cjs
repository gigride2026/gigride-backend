const express = require("express");
const supabaseAdmin = require("./utils/supabaseAdminClient.cjs");



const router = express.Router();

router.get("/driver/bookings", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");

    // 🔑 Validate user using SERVICE ROLE client
    const {
      data: { user },
      error: userError,
    } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({ error: "Invalid user" });
    }

    // ✅ User is valid, now fetch bookings
    const { data: bookings, error } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("driver_id", user.id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

