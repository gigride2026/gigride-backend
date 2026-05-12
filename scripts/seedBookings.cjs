// scripts/seedBookings.cjs
// Run: node scripts/seedBookings.cjs
// This will insert 4 test bookings (requested/approved/active/completed)
// using an existing vehicle from your `vehicles` table.

require("dotenv").config();

const supabase = require("../utils/supabaseClient.cjs"); // ✅ your backend Supabase service-role client

function iso(d) {
  return new Date(d).toISOString();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  console.log("🌱 Seeding bookings...");

  // 1) Find an existing vehicle (prefer available)
  const { data: vehicles, error: vErr } = await supabase
    .from("vehicles")
    .select("id, host_id, daily_rate_cents, status")
    .order("created_at", { ascending: false })
    .limit(10);

  if (vErr) {
    console.error("❌ Could not read vehicles table:", vErr.message);
    process.exit(1);
  }

  if (!vehicles || vehicles.length === 0) {
    console.log("❌ No vehicles found in `vehicles` table.");
    console.log("✅ Add at least 1 vehicle first (so bookings can reference it), then re-run:");
    console.log("   node scripts/seedBookings.cjs");
    process.exit(0);
  }

  const vehicle =
    vehicles.find((v) => v.status === "available") ||
    vehicles[0];

  if (!vehicle.host_id) {
    console.log("❌ Found a vehicle but it has no host_id.");
    console.log("✅ Fix host_id on that vehicle (in Supabase) then re-run.");
    process.exit(0);
  }

  if (!vehicle.daily_rate_cents) {
    console.log("⚠️ Vehicle daily_rate_cents missing; defaulting to 8300.");
    vehicle.daily_rate_cents = 8300;
  }

  // 2) Choose a driver id
  // We try to find a user from a `profiles` table if you have one.
  // If you don't, we will create a random UUID-like string (may fail if FK constraint exists).
  let driverId = null;

  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, role")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!pErr && profiles && profiles.length) {
    const driverProfile = profiles.find((p) => p.role === "driver") || profiles[0];
    driverId = driverProfile?.id || null;
  }

  if (!driverId) {
    // fallback (only works if your bookings.driver_id does NOT enforce FK to profiles/auth users)
    driverId = "32b7f66e-8a5e-47db-8272-57bfb2268347";
    console.log("⚠️ No profiles found (or profiles table missing). Using fallback driver_id:", driverId);
    console.log("   If inserts fail due to foreign keys, tell me and I’ll adjust to your schema.");
  }

  const today = new Date();

  // 3) Build bookings
  const rows = [
    {
      vehicle_id: vehicle.id,
      driver_id: driverId,
      host_id: vehicle.host_id,
      start_date: iso(addDays(today, 1)),
      end_date: iso(addDays(today, 4)),
      total_price_cents: 3 * vehicle.daily_rate_cents,
      status: "requested",
    },
    {
      vehicle_id: vehicle.id,
      driver_id: driverId,
      host_id: vehicle.host_id,
      start_date: iso(addDays(today, 2)),
      end_date: iso(addDays(today, 5)),
      total_price_cents: 3 * vehicle.daily_rate_cents,
      status: "approved",
    },
    {
      vehicle_id: vehicle.id,
      driver_id: driverId,
      host_id: vehicle.host_id,
      start_date: iso(addDays(today, -1)),
      end_date: iso(addDays(today, 2)),
      total_price_cents: 3 * vehicle.daily_rate_cents,
      status: "active",
    },
    {
      vehicle_id: vehicle.id,
      driver_id: driverId,
      host_id: vehicle.host_id,
      start_date: iso(addDays(today, -10)),
      end_date: iso(addDays(today, -7)),
      total_price_cents: 3 * vehicle.daily_rate_cents,
      status: "completed",
    },
  ];

  // 4) Insert
  const { data: inserted, error: insErr } = await supabase
    .from("bookings")
    .insert(rows)
    .select("id, status, start_date, end_date");

  if (insErr) {
    console.error("❌ Insert failed:", insErr.message);
    console.log("\nMost common causes:");
    console.log("1) bookings table requires extra columns (NOT NULL constraints)");
    console.log("2) driver_id must exist in profiles/auth (foreign key constraint)");
    console.log("3) status enum only allows certain values");
    process.exit(1);
  }

  console.log("✅ Inserted bookings:");
  console.table(inserted);

  console.log("\n✅ Now test your API:");
  console.log("curl http://192.168.12.100:3000/api/bookings");
  console.log("\n✅ Then reload the app and you should see counts > 0.");
}

main().catch((e) => {
  console.error("❌ Unexpected error:", e);
  process.exit(1);
});
