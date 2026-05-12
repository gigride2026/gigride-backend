require('dotenv').config();
const supabase = require('./utils/supabaseClient');

(async () => {
  const { data, error } = await supabase
    .from('vehicles')
    .insert([
      {
        host_id: null, // or a valid host UUID if you have one
        make: 'Test',
        model: 'Car',
        year: 2025,
        daily_rate_cents: 5000,
        weekly_rate_cents: 30000,
        monthly_rate_cents: 120000,
        mileage_cap_miles: 1000,
        gig_platform_approved: true,
        status: 'available',
        image_url: 'https://example.com/test-car.jpg'
      }
    ])
    .select(); // <-- this ensures Supabase returns the inserted row

  if (error) {
    console.error('Error inserting vehicle:', error);
  } else {
    console.log('Inserted vehicle:', data);
  }
})();

