require("dotenv").config();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyUser } = require("../services/notify.cjs");

async function releasePayouts() {
  try {
    const nowIso = new Date().toISOString();

    console.log("🚀 releasePayouts job started at:", nowIso);

    const { data: payouts, error: fetchError } = await supabaseAdmin
      .from("host_payouts")
      .select("*")
      .eq("status", "pending")
      .lte("payout_available_at", nowIso)
      .order("payout_available_at", { ascending: true });

    if (fetchError) {
      console.error("❌ Failed to fetch pending payouts:", fetchError);
      return {
        ok: false,
        error: fetchError.message,
      };
    }

    const rows = Array.isArray(payouts) ? payouts : [];

    console.log(`🔎 Found ${rows.length} payout(s) ready to release`);

    if (rows.length === 0) {
      return {
        ok: true,
        released: 0,
        failed: 0,
        skipped: 0,
      };
    }

    let released = 0;
    let failed = 0;
    let skipped = 0;

    for (const payout of rows) {
      const payoutId = String(payout.id || "").trim();
      const bookingId = String(payout.booking_id || "").trim();

      if (!payoutId || !bookingId) {
        failed += 1;
        continue;
      }

      const { data: booking, error: bookingError } = await supabaseAdmin
        .from("bookings")
        .select("id, dispute_status")
        .eq("id", bookingId)
        .maybeSingle();

      if (bookingError) {
        failed += 1;
        console.error(`❌ Failed to fetch booking ${bookingId}:`, bookingError);
        continue;
      }

      if (!booking) {
        failed += 1;
        console.error(`❌ Booking not found for payout ${payoutId}`);
        continue;
      }

      if (String(booking.dispute_status || "none").toLowerCase() !== "none") {
        skipped += 1;
        console.log(
          `⏸️ Skipping payout ${payoutId} because booking ${bookingId} is on hold/disputed`
        );
        continue;
      }

      const paidAt = new Date().toISOString();

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("host_payouts")
        .update({
          status: "paid",
          paid_at: paidAt,
        })
        .eq("id", payoutId)
        .eq("status", "pending")
        .select("*")
        .maybeSingle();

      if (updateError) {
        failed += 1;
        console.error(`❌ Failed to release payout ${payoutId}:`, updateError);
        continue;
      }

      if (!updated) {
        failed += 1;
        console.warn(`⚠️ No payout updated for ${payoutId}`);
        continue;
      }

      released += 1;
      console.log(`✅ Payout released: ${payoutId}`);

      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("expo_push_token")
        .eq("id", payout.host_id)
        .maybeSingle();

      await notifyUser(
        profile?.expo_push_token,
        "Payout released",
        `Your payout of $${(Number(payout.net_amount_cents || 0) / 100).toFixed(2)} was released.`,
        {
          bookingId: payout.booking_id,
          payoutId: payout.id,
          type: "payout_released",
        }
      );
    }

    console.log("🏁 releasePayouts job finished", {
      released,
      failed,
      skipped,
    });

    return {
      ok: true,
      released,
      failed,
      skipped,
    };
  } catch (e) {
    console.error("💥 releasePayouts job crashed:", e);
    return {
      ok: false,
      error: e.message || "Unknown error",
    };
  }
}

module.exports = { releasePayouts };