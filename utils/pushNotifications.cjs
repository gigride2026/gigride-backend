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
  if (!supabaseAdmin || !userId) return;

  const { data: tokens, error } = await supabaseAdmin
    .from("user_push_tokens")
    .select("expo_push_token")
    .eq("user_id", userId);

  if (error) {
    console.log("Push token lookup error:", error.message);
    return;
  }

  if (!tokens || tokens.length === 0) {
    console.log("No push tokens found for user:", userId);
    return;
  }

  for (const row of tokens) {
    await sendExpoPushNotification({
      to: row.expo_push_token,
      title,
      body,
      data,
    });
  }
}

module.exports = {
  sendExpoPushNotification,
  notifyUser,
};