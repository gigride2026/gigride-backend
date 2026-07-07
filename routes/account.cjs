const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function withTimeout(promise, label, ms = 8000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    ),
  ]);
}

router.post("/delete-account", async (req, res) => {
  try {
    console.log("STEP 1 - Route started");

    const userId = String(req.body?.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const deletedAt = new Date().toISOString();
    const deletedEmail = `deleted-user-${userId}@gigride.deleted`;

    console.log("STEP 2 - Updating profile");

    const { error: profileError } = await withTimeout(
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
        .eq("id", userId),
      "profile update"
    );

    if (profileError) {
      console.error("Profile update error:", profileError);
      return res.status(500).json({ error: profileError.message });
    }

    console.log("STEP 3 - Disabling vehicles");

    const { error: vehicleError } = await withTimeout(
      supabaseAdmin
        .from("vehicles")
        .update({ is_available: false })
        .eq("host_id", userId),
      "vehicle update"
    );

    if (vehicleError) {
      console.error("Vehicle update error:", vehicleError);
      return res.status(500).json({ error: vehicleError.message });
    }

    console.log("STEP 4 - Deleting auth user");

    const { error: deleteUserError } = await withTimeout(
      supabaseAdmin.auth.admin.deleteUser(userId),
      "auth delete"
    );

    if (deleteUserError) {
      console.error("Auth delete error:", deleteUserError);
      return res.status(500).json({ error: deleteUserError.message });
    }

    console.log("STEP 5 - Account deleted");

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE ACCOUNT ERROR:", e);
    return res.status(500).json({
      error: e.message || "Server error",
    });
  }
});

module.exports = router;