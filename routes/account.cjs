const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


router.post("/delete-account", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const deletedAt = new Date().toISOString();
    const deletedEmail = `deleted-user-${userId}@gigride.deleted`;

    // Remove push tokens
    await supabaseAdmin
      .from("user_push_tokens")
      .delete()
      .eq("user_id", userId);

    // Remove push token from profile too
    await supabaseAdmin
      .from("profiles")
      .update({
        full_name: null,
        phone: null,
        avatar_url: null,
        expo_push_token: null,
        email: deletedEmail,

        identity_status: "deleted",
        identity_verified: false,
        identity_provider: null,
        identity_updated_at: deletedAt,

        license_front_url: null,
        license_back_url: null,
        selfie_url: null,
        host_id_front_url: null,
        host_selfie_url: null,
        host_registration_url: null,

        didit_session_id: null,
        didit_session_token: null,
        didit_verification_url: null,
        didit_last_status: null,
        didit_webhook_payload: null,
      })
      .eq("id", userId);

    // Disable vehicles instead of deleting, because bookings/payouts may reference them
    await supabaseAdmin
      .from("vehicles")
      .update({
        is_available: false,
      })
      .eq("host_id", userId);

    // Delete Supabase Auth login
    const { error: deleteUserError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      console.error("Delete auth user error:", deleteUserError);
      return res.status(500).json({ error: deleteUserError.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE ACCOUNT ERROR:", e);
    return res.status(500).json({
      error: "Server error",
      details: e.message,
    });
  }
});

module.exports = router;