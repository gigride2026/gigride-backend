require("dotenv").config();

const express = require("express");
const cors = require("cors");

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
const bonzahRoutes = require("./routes/bonzah.cjs");
const paypalRoutes = require("./routes/paypal.cjs");
const squareRoutes = require("./routes/squareRoutes.cjs");
const payoutRoutes = require("./routes/payoutRoutes.cjs");
const diditRoutes = require("./routes/diditRoutes.cjs");
const accountRoutes = require("./routes/account.cjs");

const app = express();

app.use(cors());

app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
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
app.use("/api/bonzah", bonzahRoutes);
app.use("/api/paypal", paypalRoutes);
app.use("/api/square", squareRoutes);
app.use("/api/payouts", payoutRoutes);
app.use("/api/didit", diditRoutes);
app.use("/api/account", accountRoutes);

app.get("/", (req, res) => {
  res.json({ ok: true, message: "GigRide backend running" });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`✅ Backend listening on http://0.0.0.0:${PORT}`);
  console.log("ENV SUPABASE_URL =", !!process.env.SUPABASE_URL);
  console.log("ENV HAS SERVICE KEY =", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("ENV HAS ANON KEY =", !!process.env.SUPABASE_ANON_KEY);
  console.log("ENV HAS DIDIT API KEY =", !!process.env.DIDIT_API_KEY);
  console.log("ENV HAS DIDIT WORKFLOW ID =", !!process.env.DIDIT_WORKFLOW_ID);

  startSchedulers();
});

module.exports = app;