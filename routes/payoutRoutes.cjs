const express = require("express");
const router = express.Router();
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");

router.post("/run-host-payout-batch", async (req, res) => {
  try {
    const now = new Date().toISOString();

    const { data: pendingPayouts, error: fetchError } = await supabaseAdmin
      .from("host_payouts")
      .select("*")
      .eq("status", "pending")
      .lte("payout_available_at", now);

    if (fetchError) throw fetchError;

    if (!pendingPayouts || pendingPayouts.length === 0) {
      return res.json({
        ok: true,
        message: "No eligible pending host payouts.",
      });
    }

    const totalGrossCents = pendingPayouts.reduce(
      (sum, payout) => sum + Number(payout.gross_amount_cents || 0),
      0
    );

    const totalFeeCents = pendingPayouts.reduce(
      (sum, payout) => sum + Number(payout.application_fee_cents || 0),
      0
    );

    const totalNetCents = pendingPayouts.reduce(
      (sum, payout) => sum + Number(payout.net_amount_cents || 0),
      0
    );

    const { data: batch, error: batchError } = await supabaseAdmin
      .from("payout_batches")
      .insert({
        status: "created",
        total_gross_cents: totalGrossCents,
        total_platform_fee_cents: totalFeeCents,
        total_net_payout_cents: totalNetCents,
        payout_count: pendingPayouts.length,
      })
      .select("*")
      .single();

    if (batchError) throw batchError;

    const payoutIds = pendingPayouts.map((payout) => payout.id);

    const { error: updateError } = await supabaseAdmin
      .from("host_payouts")
      .update({
        status: "batched",
        payout_batch_id: batch.id,
        batched_at: now,
      })
      .in("id", payoutIds);

    if (updateError) throw updateError;

    return res.json({
      ok: true,
      message: "Host payout batch created.",
      batch_id: batch.id,
      payout_count: pendingPayouts.length,
      total_gross_cents: totalGrossCents,
      total_platform_fee_cents: totalFeeCents,
      total_net_payout_cents: totalNetCents,
    });
  } catch (e) {
    console.error("RUN HOST PAYOUT BATCH ERROR:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;