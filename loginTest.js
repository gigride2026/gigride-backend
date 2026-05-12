require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

(async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'host@test.com',
    password: 'password123'
  });

  if (error) {
    console.error('Login failed:', error.message);
    return;
  }

  console.log('\nACCESS TOKEN:\n');
  console.log(data.session.access_token);
})();
