require("dotenv").config();

const express = require("express");
const cors = require("cors");

const paymentsRoutes = require("./routes/payments.cjs");
const stripeWebhook = require("./routes/stripeWebhook.cjs");
const bookingsRoutes = require("./routes/bookings.cjs");
const authRoutes = require("./routes/auth.cjs");
const bookingsCancel = require("./routes/bookingsCancel.cjs");
const vehiclesRoutes = require("./routes/vehicles.cjs");
const payoutsRoutes = require("./routes/payouts.cjs");
const depositsRoutes = require("./routes/deposits.cjs");
const bookingsCreate = require("./routes/bookingsCreate.cjs");
const bookingsStart = require("./routes/bookingsStart.cjs");
const bookingsComplete = require("./routes/bookingsComplete.cjs");
const depositRefundRoutes = require("./routes/depositRefunds.cjs");
const { startSchedulers } = require("./jobs/scheduler.cjs");
const pushRoutes = require("./routes/push.cjs");
const insuranceNotificationsRoutes = require("./routes/insuranceNotifications.cjs");
const adminAlerts = require("./routes/adminAlerts.cjs");
const messagesRoutes = require("./routes/messages.cjs");

const app = express();

app.use(cors());

// ✅ Stripe webhook must come BEFORE express.json()
app.use("/webhooks", stripeWebhook);

// ✅ NOW parse JSON bodies for everything else
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Routes after body parsing
app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/vehicles", vehiclesRoutes);
app.use("/api/payouts", payoutsRoutes);
app.use(bookingsCancel);
app.use("/api/deposits", depositsRoutes);
app.use("/api/bookings", bookingsCreate);
app.use("/api/bookings", bookingsStart);
app.use("/api/bookings", bookingsComplete);
app.use("/api/deposit-refunds", depositRefundRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/notifications", insuranceNotificationsRoutes);
app.use("/api/admin-alerts", adminAlerts);
app.use("/api/messages", messagesRoutes);

module.exports = app;

// ================================
// Health Check
// ================================
app.get("/", (req, res) => {
  res.json({ ok: true, message: "GigCar backend running" });
});

// ================================
// Start Server
// ================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`✅ Backend listening on http://0.0.0.0:${PORT}`);
  console.log("ENV SUPABASE_URL =", !!process.env.SUPABASE_URL);
  console.log("ENV HAS SERVICE KEY =", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("ENV HAS ANON KEY =", !!process.env.SUPABASE_ANON_KEY);

  try {
    const Stripe = require("stripe");
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const acct = await stripe.accounts.retrieve();

    console.log("🔑 STRIPE ACCOUNT ID (backend):", acct.id);
  } catch (err) {
    console.error("❌ Failed to fetch Stripe account:", err.message);
  }
  startSchedulers();
});










































