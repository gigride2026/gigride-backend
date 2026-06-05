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
  padding:40px;
  font-family:Arial,sans-serif;
  color:white;
  text-align:center;
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

  <a
  href="gigride:///identity-verification"
    style="
      display:inline-block;
      padding:14px 24px;
      border-radius:12px;
      background:#8B5CF6;
      color:white;
      text-decoration:none;
      font-weight:700;
      margin-top:12px;
    "
  >
    Complete Verification
  </a>

  <p style="margin-top:30px;color:#9CA3AF;">
    Thanks for joining early — we're excited to have you.
  </p>

  <p style="margin-top:20px;">
    <strong>GigRide</strong><br/>
    support@gigride.app
  </p>

</div>
`
  });
}

module.exports = { sendWelcomeEmail };