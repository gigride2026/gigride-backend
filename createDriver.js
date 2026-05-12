require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data, error } = await supabase.auth.admin.createUser({
    email: 'driver@local.dev',
    password: 'TestDriver123!',
    email_confirm: true,
  });

  if (error) {
    console.error(error.message);
    return;
  }

  console.log('✅ Driver created:', data.user.id);
})();
