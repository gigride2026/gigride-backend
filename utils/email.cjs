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

async function sendHostBookingReminderEmail({ to, bookingId }) {
  if (!to) {
    return { ok: false, error: "Missing recipient email" };
  }

  const result = await resend.emails.send({
    from: process.env.FROM_EMAIL || "GigRide <support@gigride.app>",
    to,
    subject: "Action needed: GigRide booking request",
    html: `
      <table width="100%" cellpadding="0" cellspacing="0" border="0"
        style="background-color:#F7F7FB;margin:0;padding:40px 20px;">
        <tr>
          <td align="center">
            <table width="560" cellpadding="0" cellspacing="0" border="0"
              style="background-color:#FFFFFF;border-radius:24px;padding:32px;">
              <tr>
                <td style="font-family:Arial,sans-serif;color:#111827;">
                  <img
                    src="https://gigride.app/gigride.png"
                    alt="GigRide"
                    width="110"
                    style="display:block;margin:0 auto 28px auto;"
                  />

                  <h2 style="margin:0 0 16px;text-align:center;">
                    Booking request waiting
                  </h2>

                  <p style="font-size:16px;line-height:24px;color:#4B5563;">
                    You have a GigRide booking request that has been waiting
                    for your decision for more than one hour.
                  </p>

                  <p style="font-size:16px;line-height:24px;color:#4B5563;">
                    Please open the GigRide app and approve or decline the
                    request as soon as possible so the driver knows whether
                    the vehicle is available.
                  </p>

                  <p style="font-size:13px;line-height:20px;color:#9CA3AF;">
                    Booking reference:
                    ${String(bookingId || "").slice(0, 8)}
                  </p>

                  <p style="margin-top:28px;font-size:13px;color:#9CA3AF;">
                    Questions? Contact
                    <a href="mailto:support@gigride.app"
                      style="color:#8B5CF6;">support@gigride.app</a>
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
    `,
  });

  if (result?.error) {
    return {
      ok: false,
      error: result.error.message || "Resend rejected the email",
    };
  }

  return {
    ok: Boolean(result?.data?.id),
    id: result?.data?.id || null,
    error: result?.data?.id ? null : "Resend did not return an email ID",
  };
}


async function sendSupportInviteCodeEmail({ to, code }) {
  if (!to || !code) {
    return { ok: false, error: "Missing recipient email or invite code" };
  }

  const result = await resend.emails.send({
    from: process.env.FROM_EMAIL || "GigRide <support@gigride.app>",
    to,
    subject: "Your GigRide Support access code",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#111827;">
        <h2 style="margin-bottom:16px;">You're invited to GigRide Support</h2>
        <p>Use the verification code below to accept your staff invitation:</p>

        <div style="font-size:36px;font-weight:700;letter-spacing:8px;text-align:center;padding:24px;margin:24px 0;background:#F3F4F6;border-radius:12px;">
          ${code}
        </div>

        <p>Open the GigRide app and enter this code on the Support invitation screen.</p>
        <p style="color:#6B7280;font-size:13px;margin-top:28px;">
          If you were not expecting this invitation, you can ignore this email.
        </p>
      </div>
    `,
  });

  if (result?.error) {
    return {
      ok: false,
      error: result.error.message || "Resend rejected the email",
    };
  }

  return {
    ok: Boolean(result?.data?.id),
    id: result?.data?.id || null,
    error: result?.data?.id ? null : "Resend did not return an email ID",
  };
}

module.exports = {
  sendWelcomeEmail,
  sendHostBookingReminderEmail,
  sendSupportInviteCodeEmail,
};