async function sendExpoPushNotification({ to, title, body, data = {} }) {
  if (!to || !String(to).startsWith("ExponentPushToken[")) {
    console.log("Invalid Expo push token");

    return {
      ok: false,
      accepted: false,
      status: null,
      ticketId: null,
      error: "Invalid Expo push token",
    };
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

  let payload = null;

  try {
    payload = JSON.parse(text);
  } catch (_) {
    payload = null;
  }

  const ticket = Array.isArray(payload?.data)
    ? payload.data[0]
    : payload?.data;

  const accepted =
    res.ok &&
    ticket?.status === "ok";

  const errorMessage =
    ticket?.message ||
    ticket?.details?.error ||
    payload?.errors?.[0]?.message ||
    (!res.ok ? `Expo HTTP ${res.status}` : null) ||
    (!ticket ? "Expo returned an invalid push ticket" : null) ||
    (ticket?.status !== "ok"
      ? "Expo rejected the push notification"
      : null);

  console.log(
    "Expo push result:",
    accepted ? "accepted" : "rejected",
    "HTTP",
    res.status
  );

  return {
    ok: Boolean(accepted),
    accepted: Boolean(accepted),
    status: res.status,
    ticketId: ticket?.id || null,
    error: accepted ? null : errorMessage,
  };
}

async function notifyUser({
  supabaseAdmin,
  userId,
  title,
  body,
  data = {},
}) {
  console.log("notifyUser called with userId:", userId);

  if (!supabaseAdmin) {
    console.log("notifyUser stopped: missing supabaseAdmin");
    return { ok: false, sent: 0, error: "Missing supabaseAdmin" };
  }

  if (!userId) {
    console.log("notifyUser stopped: missing userId");
    return { ok: false, sent: 0, error: "Missing userId" };
  }

  const cleanUserId = String(userId).trim();

  const { data: tokens, error } = await supabaseAdmin
    .from("profiles")
    .select("id, expo_push_token")
    .eq("id", cleanUserId);

  console.log("Push token lookup userId:", cleanUserId);
  console.log("Push token lookup error:", error);

  if (error) {
    console.log("Push token lookup error message:", error.message);

    return {
      ok: false,
      sent: 0,
      error: error.message,
    };
  }

  const validTokens = (tokens || []).filter(
    (row) =>
      row.expo_push_token &&
      String(row.expo_push_token).startsWith("ExponentPushToken[")
  );

  if (validTokens.length === 0) {
    console.log("No valid push tokens found for user:", cleanUserId);

    return {
      ok: false,
      sent: 0,
      error: "No valid Expo push token",
    };
  }

  let sent = 0;
  const results = [];

  for (const row of validTokens) {
    try {
      const result = await sendExpoPushNotification({
        to: row.expo_push_token,
        title,
        body,
        data,
      });

      const ok = Boolean(result?.accepted);

      results.push({
        ok,
        accepted: ok,
        status: result?.status || null,
        ticketId: result?.ticketId || null,
        error: result?.error || null,
      });

      if (ok) sent += 1;
    } catch (err) {
      console.error("Push notification failed:", err.message);

      results.push({
        ok: false,
        accepted: false,
        status: null,
        ticketId: null,
        error: err.message,
      });
    }
  }

  return {
    ok: sent > 0,
    sent,
    attempted: validTokens.length,
    results,
    error: sent > 0 ? null : "Expo push was not accepted",
  };
}

async function notifyAdmin({ supabaseAdmin, title, body, data = {} }) {
  return notifyUser({
    supabaseAdmin,
    userId: "7e4696e3-e767-4f6c-887d-052b2c0ed588",
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
