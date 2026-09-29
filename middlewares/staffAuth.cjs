const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

async function loadStaffProfile(req, res) {
  if (!req.user?.id) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id, staff_role")
    .eq("id", req.user.id)
    .maybeSingle();

  if (error) {
    console.error("STAFF AUTH PROFILE LOOKUP ERROR:", error.message);
    res.status(500).json({ error: "Unable to verify staff access" });
    return null;
  }

  if (!profile?.staff_role) {
    res.status(403).json({ error: "Staff access required" });
    return null;
  }

  req.staffProfile = profile;
  return profile;
}

async function requireStaff(req, res, next) {
  const profile = await loadStaffProfile(req, res);
  if (!profile) return;

  if (!["owner", "support_agent"].includes(profile.staff_role)) {
    return res.status(403).json({ error: "Staff access required" });
  }

  next();
}

async function requireOwner(req, res, next) {
  const profile = await loadStaffProfile(req, res);
  if (!profile) return;

  if (profile.staff_role !== "owner") {
    return res.status(403).json({ error: "Owner access required" });
  }

  next();
}

module.exports = {
  requireStaff,
  requireOwner,
};
