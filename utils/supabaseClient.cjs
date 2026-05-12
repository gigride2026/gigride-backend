// utils/supabaseAdmin.cjs
const { createClient } = require("@supabase/supabase-js");

function clean(v) {
  return String(v || "").trim().replace(/^"+|"+$/g, "");
}

const SUPABASE_URL = clean(process.env.SUPABASE_URL);
const SERVICE_KEY =
  clean(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
  clean(process.env.SUPABASE_SERVICE_ROLE_KEY); // keep both just in case you used either name

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL in backend .env");
if (!SERVICE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in backend .env");

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`, // ✅ this is what makes request.jwt.claim.role = service_role
    },
  },
});

module.exports = { supabaseAdmin };







