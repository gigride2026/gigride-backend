// scripts/genHostToken.cjs
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY; // fallback if you used SUPABASE_KEY
const EMAIL = process.env.HOST_EMAIL || "host@local.dev";
const PASSWORD = process.env.HOST_PASSWORD || "password123";

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL in .env");
if (!SUPABASE_ANON_KEY) throw new Error("Missing SUPABASE_ANON_KEY (or SUPABASE_KEY) in .env");

(async () => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });

  if (error) {
    console.error("Login failed:", error.message);
    process.exit(1);
  }

  console.log("\n✅ HOST ACCESS TOKEN:\n");
  console.log(data.session.access_token);
  console.log("\n✅ HOST USER ID:", data.user.id, "\n");
})();
