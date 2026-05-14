const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyUser } = require("../utils/pushNotifications.cjs");

async function getUserFromReq(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;

  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data?.user) return null;
  return data.user;
}

router.post("/signup", async (req, res) => {
  try {
    const user = await getUserFromReq(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const { role = "unknown" } = req.body || {};

    const adminUserId = process.env.ADMIN_USER_ID;

    if (!adminUserId) {
      return res.status(500).json({ error: "ADMIN_USER_ID missing" });
    }

    await notifyUser({
      supabaseAdmin,
      userId: adminUserId,
      title: "🚨 New GigRide Signup",
      body: `${user.email || "New user"} signed up as ${role}.`,
      data: {
        type: "new_signup",
        userId: user.id,
        email: user.email,
        role,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("SIGNUP ALERT ERROR:", e);
    return res.status(500).json({ error: e.message || "Server error" });
  }
});

module.exports = router;