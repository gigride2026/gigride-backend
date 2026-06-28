const axios = require("axios");

const DIDIT_BASE_URL = process.env.DIDIT_BASE_URL || "https://verification.didit.me";

function requireDiditEnv() {
  if (!process.env.DIDIT_API_KEY) throw new Error("Missing DIDIT_API_KEY");
  if (!process.env.DIDIT_WORKFLOW_ID) throw new Error("Missing DIDIT_WORKFLOW_ID");
  if (!process.env.PUBLIC_BACKEND_URL) throw new Error("Missing PUBLIC_BACKEND_URL");
}

async function createDiditSession({ profileId, email, role }) {
  requireDiditEnv();

  const callbackUrl = `${process.env.PUBLIC_BACKEND_URL}/api/didit/webhook`;

  const payload = {
    workflow_id: process.env.DIDIT_WORKFLOW_ID,
    vendor_data: profileId,
    callback: callbackUrl,
    callback_method: "post",
    metadata: {
      profile_id: profileId,
      role: role || "driver",
      app: "GigRide",
    },
    contact_details: {
      email,
      send_notification_emails: false,
    },
  };

  const response = await axios.post(`${DIDIT_BASE_URL}/v3/session/`, payload, {
    headers: {
      "x-api-key": process.env.DIDIT_API_KEY,
      "Content-Type": "application/json",
    },
    timeout: 20000,
  });

  return response.data;
}

module.exports = {
  createDiditSession,
};