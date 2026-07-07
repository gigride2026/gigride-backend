const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function timed(label, promise, ms = 10000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

router.post("/delete-account", async (req, res) => {
  try {
    console.log("DELETE ACCOUNT: started");

    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const { data: userData, error: userError } = await timed(
      "verify user",
      supabaseAdmin.auth.getUser(token)
    );

    if (userError || !userData?.user?.id) {
      return res.status(401).json({ error: userError?.message || "Invalid user" });
    }

    const userId = userData.user.id;
    const deletedAt = new Date().toISOString();
    const deletedEmail = `deleted-user-${userId}@gigride.deleted`;

    console.log("DELETE ACCOUNT: anonymizing profile");

    const { error: profileError } = await timed(
      "profile update",
      supabaseAdmin
        .from("profiles")
        .update({
          full_name: null,
          phone: null,
          avatar_url: null,
          expo_push_token: null,
          email: deletedEmail,
          identity_status: "deleted",
          identity_verified: false,
          identity_updated_at: deletedAt,
          license_front_url: null,
          license_back_url: null,
          selfie_url: null,
          didit_session_id: null,
          didit_session_token: null,
          didit_verification_url: null,
          didit_last_status: null,
          didit_webhook_payload: null,
        })
        .eq("id", userId)
    );

    if (profileError) {
      console.error("Profile update error:", profileError);
      return res.status(500).json({ error: profileError.message });
    }

    console.log("DELETE ACCOUNT: disabling vehicles");

    const { error: vehicleError } = await timed(
      "vehicle update",
      supabaseAdmin
        .from("vehicles")
        .update({ is_available: false })
        .eq("host_id", userId)
    );

    if (vehicleError) {
      console.error("Vehicle update error:", vehicleError);
      return res.status(500).json({ error: vehicleError.message });
    }

    console.log("DELETE ACCOUNT: deleting auth user");

    const { error: authDeleteError } = await timed(
      "auth delete",
      supabaseAdmin.auth.admin.deleteUser(userId)
    );

    if (authDeleteError) {
      console.error("Auth delete error:", authDeleteError);
      return res.status(500).json({ error: authDeleteError.message });
    }

    console.log("DELETE ACCOUNT: complete");

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE ACCOUNT ERROR:", e);
    return res.status(500).json({
      error: e.message || "Server error",
    });
  }
});

module.exports = router;