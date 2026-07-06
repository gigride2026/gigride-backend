require("dotenv").config();

const express = require("express");
const cors = require("cors");
const router = express.Router();

router.post("/delete-account", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }

    const deletedAt = new Date().toISOString();

    await supabaseAdmin
      .from("user_push_tokens")
      .delete()
      .eq("user_id", userId);

    await supabaseAdmin
      .from("vehicles")
      .update({
        is_available: false,
        deleted_at: deletedAt,
      })
      .eq("host_id", userId);

    await supabaseAdmin
      .from("profiles")
      .update({
        full_name: null,
        phone: null,
        avatar_url: null,
        expo_push_token: null,
        email: `deleted-user-${userId}@gigride.deleted`,
        identity_status: "deleted",
        identity_verified: false,
        license_front_url: null,
        license_back_url: null,
        selfie_url: null,
        host_id_front_url: null,
        host_selfie_url: null,
        host_registration_url: null,
        didit_session_id: null,
        didit_session_token: null,
        didit_verification_url: null,
        didit_webhook_payload: null,
        updated_at: deletedAt,
      })
      .eq("id", userId);

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