// routes/hosts.js

console.log('🔥 hosts.js LOADED 🔥');

const express = require('express');
const router = express.Router();

const stripe = require('../utils/stripeClient.cjs');
const supabase = require('../utils/../utils/supabaseClient.cjs');
const authMiddleware = require('../middlewares/auth.cjs');

// 🔐 Require host to be authenticated
router.use(authMiddleware);

/**
 * POST /hosts/connect-stripe
 * Creates a Stripe Connect onboarding link
 */
router.post('/connect-stripe', async (req, res) => {
  try {
    const host_id = req.user.id;

    // 1️⃣ Create Stripe Connected Account
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    // 2️⃣ Save Stripe account ID
    const { error } = await supabase
      .from('hosts')
      .update({ stripe_account_id: account.id })
      .eq('id', host_id);

    if (error) throw error;

    // 3️⃣ Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: 'http://localhost:3000/reauth',
      return_url: 'http://localhost:3000/return',
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });

  } catch (err) {
    console.error('🔥 STRIPE CONNECT ERROR 🔥', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;



