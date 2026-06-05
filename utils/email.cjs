const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendWelcomeEmail({ to }) {
  if (!to) return;

  await resend.emails.send({
    from: process.env.FROM_EMAIL || "GigRide <support@gigride.app>",
    to,
    subject: "Welcome to GigRide 🚗",
    html: `
     <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7FB;margin:0;padding:40px 20px;">
  <tr>
    <td align="center" bgcolor="#05050A" style="background-color:#05050A;padding:32px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border-radius:28px;box-shadow:0 8px 30px rgba(0,0,0,0.08);">
        <tr>
          <td align="center" style="padding:34px 24px;font-family:Arial,sans-serif;color:#ffffff;text-align:center;">
            
            <img
              src="https://gigride.app/gigride.png"
              alt="GigRide"
              width="120"
              style="display:block;margin:0 auto 30px auto;"
            />

            <div style="height:1px;background:#333;margin:30px 0;"></div>

           <p style="color:#111827;font-size:24px;font-weight:700;margin:0 0 16px;">
              Welcome to GigRide
            </p>

            <p style="color:#4B5563;font-size:16px;line-height:24px;margin:0 0 16px;">
              Your GigRide account has been created.
            </p>

            <p style="color:#D1D5DB;font-size:16px;line-height:24px;margin:0 0 24px;">
              Open the GigRide app to finish setting up your profile, complete any required verification, and start using the platform.
            </p>

            <p style="margin-top:30px;color:#9CA3AF;font-size:13px;line-height:20px;">
             Questions? Contact <a href="mailto:support@gigride.app" style="color:#8B5CF6;">support@gigride.app</a>
            </p>

            <p style="color:#4B5563;font-size:14px;line-height:22px;">
              <strong>GigRide</strong><br/>
              support@gigride.app
            </p>

          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
`
  });
}

module.exports = { sendWelcomeEmail };