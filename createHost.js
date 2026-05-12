require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data, error } = await supabase.auth.admin.createUser({
    email: 'host@local.dev',
    password: 'TestHost123!',
    email_confirm: true
  });

  if (error) {
    console.error('❌ Error creating host:', error.message);
    return;
  }

  console.log('✅ Host user created');
  console.log('HOST USER ID:', data.user.id);
})();
