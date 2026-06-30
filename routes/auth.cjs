// routes/auth.cjs
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const { sendWelcomeEmail } = require("../utils/email.cjs");
const { notifyAdmin } = require("../utils/pushNotifications.cjs");
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const router = express.Router();


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

router.post("/login", async (req, res) => {
  try {
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    const password = (req.body?.password || "").toString();
   

    console.log("AUTH using SUPABASE_URL =", process.env.SUPABASE_URL);
console.log("AUTH anon key starts  =", (process.env.SUPABASE_ANON_KEY || "").slice(0, 12));

    
    console.log("LOGIN BODY:", req.body);
    console.log("EMAIL:", email, "PASS_LEN:", password.length);


    if (!email || !password) {
      return res.status(400).json({ error: "email and password required" });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: error.message });

    return res.json({ ok: true, user: data.user, session: data.session });
  } catch (e) {
    return res.status(500).json({ error: "Server error", details: e.message });
  }
});
router.post("/admin-signup-alert", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = String(req.body?.role || "user").trim().toLowerCase();
    const userId = String(req.body?.user_id || req.body?.id || "").trim();

    if (!email) {
      return res.status(400).json({ error: "email is required" });
    }

    if (userId) {
      const isDriver = role === "driver";
      const isHost = role === "host";

      const { error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert(
          {
            id: userId,
            email,
            is_driver: isDriver,
            is_host: isHost,
            joined_at: new Date().toISOString(),
            identity_status: "not_started",
            identity_verified: false,
          },
          { onConflict: "id" }
        );

      if (profileError) {
        console.error("❌ Profile upsert failed:", profileError);
      } else {
        console.log("✅ Profile upserted for signup:", email);
      }
    } else {
      console.warn("⚠️ No user_id provided for signup alert:", email);
    }

    await notifyAdmin({
      supabaseAdmin,
      title: "New GigRide signup 🚗",
      body: `${email || "A new user"} signed up as ${role}.`,
      data: {
        type: "new_signup",
        email,
        role,
        user_id: userId,
      },
    });

    try {
      await sendWelcomeEmail({ to: email });
      console.log("✅ Welcome email sent:", email);
    } catch (emailErr) {
      console.error("❌ Welcome email failed:", emailErr.message);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("admin-signup-alert error:", e);
    return res.status(500).json({ error: "Server error" });
  }
});
module.exports = router;

