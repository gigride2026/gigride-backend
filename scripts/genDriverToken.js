import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

console.log('SCRIPT STARTED');

const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const anon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const DRIVER_ID = '32b7f66e-8a5e-47db-8272-57bfb2268347';
const TEMP_PASSWORD = 'TempPass123!';

async function run() {
  console.log('UPDATING PASSWORD');

  const { error: updateError } =
    await admin.auth.admin.updateUserById(DRIVER_ID, {
      password: TEMP_PASSWORD,
    });

  if (updateError) {
    console.error('UPDATE ERROR:', updateError);
    return;
  }

  console.log('SIGNING IN');

  const { data, error } =
    await anon.auth.signInWithPassword({
      email: 'driver@local.dev',
      password: TEMP_PASSWORD,
    });

  if (error) {
    console.error('LOGIN ERROR:', error);
    return;
  }

  console.log('\n=== ACCESS TOKEN ===\n');
  console.log(data.session.access_token);
  console.log('\n====================\n');
}

run();

