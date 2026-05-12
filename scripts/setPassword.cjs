require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const email = "gboi1993@gmail.com";
  const newPassword = "NewPassword123!";

  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;

  const user = list.users.find(u => (u.email || "").toLowerCase() === email.toLowerCase());
  if (!user) throw new Error("User not found");

  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });
  if (error) throw error;

  console.log("Password updated for:", data.user.email);
})();
