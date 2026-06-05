const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendWelcomeEmail({ to }) {
  if (!to) return;

  await resend.emails.send({
    from: process.env.FROM_EMAIL || "GigRide <support@gigride.app>",
    to,
    subject: "Welcome to GigRide 🚗",
    html: `
      <h2>Welcome to GigRide</h2>
      <p>Your account has been created.</p>
      <p>Next step: complete identity verification so you can safely book vehicles built for gig work.</p>
      <p>Thanks for joining early — we’re excited to have you.</p>
      <p><strong>GigRide</strong></p>
    `,
  });
}

module.exports = { sendWelcomeEmail };