async function sendExpoPushNotification({ to, title, body, data = {} }) {
  if (!to || !String(to).startsWith("ExponentPushToken[")) {
    console.log("Invalid Expo push token:", to);
    return null;
  }

  const message = {
    to,
    sound: "default",
    title,
    body,
    data,
  };

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(message),
  });

  const text = await res.text();

  console.log("Expo push response:", res.status, text);

  return {
    status: res.status,
    body: text,
  };
}

async function notifyUser({ supabaseAdmin, userId, title, body, data = {} }) {
  console.log("notifyUser called with userId:", userId);

  if (!supabaseAdmin) {
    console.log("notifyUser stopped: missing supabaseAdmin");
    return;
  }

  if (!userId) {
    console.log("notifyUser stopped: missing userId");
    return;
  }

  const cleanUserId = String(userId).trim();

  const { data: tokens, error } = await supabaseAdmin
   .from("profiles")
.select("id, expo_push_token")
.eq("id", cleanUserId);

  console.log("Push token lookup userId:", cleanUserId);
  console.log("Push token lookup error:", error);
  console.log("Push tokens found:", tokens);

  if (error) {
    console.log("Push token lookup error message:", error.message);
    return;
  }

  if (!tokens || tokens.length === 0) {
    console.log("No push tokens found for user:", cleanUserId);
    return;
  }

  for (const row of tokens) {
    console.log("Sending push to token:", row.expo_push_token);

    await sendExpoPushNotification({
      to: row.expo_push_token,
      title,
      body,
      data,
    });
  }
}
async function notifyAdmin({ supabaseAdmin, title, body, data = {} }) {
  await notifyUser({
    supabaseAdmin,
    userId: "c513215e-2488-44b6-8a2e-01e04d40168a",
    title,
    body,
    data,
  });
}
module.exports = {
  sendExpoPushNotification,
  notifyUser,
  notifyAdmin,
};