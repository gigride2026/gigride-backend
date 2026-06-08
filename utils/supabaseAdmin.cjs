const { createClient } = require("@supabase/supabase-js");

function cleanEnv(v) {
  return String(v || "").trim().replace(/^"+|"+$/g, "");
}

const SUPABASE_URL = cleanEnv(process.env.SUPABASE_URL);
const SERVICE_ROLE_KEY = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!SUPABASE_URL || !SUPABASE_URL.startsWith("https://")) {
  throw new Error(
    `supabaseAdmin.cjs: SUPABASE_URL is missing/invalid: ${JSON.stringify(
      SUPABASE_URL
    )}`
  );
}

if (!SERVICE_ROLE_KEY) {
  throw new Error("supabaseAdmin.cjs: SUPABASE_SERVICE_ROLE_KEY is missing");
}

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
    },
  }
);

module.exports = { supabaseAdmin };