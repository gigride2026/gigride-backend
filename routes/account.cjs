const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

router.post("/delete-account", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const { data: userData, error: userError } =
      await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user?.id) {
      return res.status(401).json({
        error: userError?.message || "Invalid user token",
      });
    }

    const userId = userData.user.id;
    const deletedAt = new Date().toISOString();
    const deletedEmail = `deleted-user-${userId}@gigride.deleted`;

    const { error: profileError } = await supabaseAdmin
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
      .eq("id", userId);

    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    // Mark host vehicles inactive if the column exists.
// If not, skip vehicle updates so account deletion can still complete.
const { error: vehicleError } = await supabaseAdmin
  .from("vehicles")
  .update({ status: "inactive" })
  .eq("host_id", userId);

if (vehicleError) {
  console.log("Vehicle update skipped:", vehicleError.message);
}

    if (vehicleError) {
      return res.status(500).json({ error: vehicleError.message });
    }

    const { error: authDeleteError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authDeleteError) {
      return res.status(500).json({ error: authDeleteError.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("DELETE ACCOUNT ERROR:", e);
    return res.status(500).json({
      error: e.message || "Server error",
    });
  }
});

module.exports = router;