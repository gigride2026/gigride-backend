const { sendPushNotification } = require("../utils/pushNotifications.cjs");

async function notifyUser(expoPushToken, title, body, data = {}) {
  if (!expoPushToken) {
    console.log("No push token, skipping notification");
    return { ok: false, error: "No push token" };
  }

  try {
    const result = await sendPushNotification({
      to: expoPushToken,
      title,
      body,
      data,
    });
    return result;
  } catch (err) {
    console.error("Push notification failed:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { notifyUser };