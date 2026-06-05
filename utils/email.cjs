const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendWelcomeEmail({ to }) {
  if (!to) return;

  await resend.emails.send({
    from: process.env.FROM_EMAIL || "GigRide <support@gigride.app>",
    to,
    subject: "Welcome to GigRide 🚗",
    html: `
<div style="
  background:#05050A;
  padding:32px 20px;
  font-family:Arial,sans-serif;
  color:white;
  text-align:center;
  width:100%;
  min-height:100vh;
">

  <div style="
    max-width:560px;
    margin:0 auto;
    background-color:#0B0B12;
    border-radius:28px;
    padding:34px 24px;
  ">
  
  <div style="text-align:center;margin-bottom:30px;">
    <img
  src="https://gigride.app/gigride.png"
  alt="GigRide"
  width="120"
  style="display:block;margin:0 auto;"
/>
  </div>

 <hr style="margin:30px 0;border:none;border-top:1px solid #333;" />

<p style="color:#9CA3AF;font-size:13px;">
Questions? Contact support@gigride.app
</p>

  <p>Your account has been created.</p>

 <p>
  Next step: complete identity verification so you can safely
  book vehicles built for gig work.
</p>

<p style="color:#D1D5DB;font-size:14px;line-height:22px;">
  Open the GigRide app and tap
  <strong>Complete Verification</strong>
  from your profile to finish onboarding.
</p>

<p>
  Your GigRide account has been created.
</p>

<p>
  Open the GigRide app to finish setting up your profile, complete any required verification, and start using the platform.
</p>

  <p style="margin-top:30px;color:#9CA3AF;">
    Thanks for joining early — we're excited to have you.
  </p>

  <p>
  <strong>GigRide</strong><br/>
  support@gigride.app
</p>

  </div>
</div>
`
  });
}

module.exports = { sendWelcomeEmail };