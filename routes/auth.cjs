// routes/auth.cjs
const express = require("express");
const { createClient } = require("@supabase/supabase-js");

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

module.exports = router;

