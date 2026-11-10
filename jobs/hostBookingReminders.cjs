const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyUser } = require("../utils/pushNotifications.cjs");
const {
  sendHostBookingReminderEmail,
} = require("../utils/email.cjs");

const EVENT_15M_PUSH = "host_reminder_15m_push";
const EVENT_1H_PUSH = "host_reminder_1h_push";
const EVENT_1H_EMAIL = "host_reminder_1h_email";
const EVENT_4H_OWNER_PUSH = "host_reminder_4h_owner_push";

const EVENT_30M_OWNER_PUSH = "host_reminder_30m_owner_push";
const EVENT_2H_OWNER_PUSH = "host_reminder_2h_owner_push";
const EVENT_12H_OWNER_PUSH = "host_reminder_12h_owner_push";

async function claimEvent({
  bookingId,
  eventType,
  message,
  metadata = {},
}) {
  const { error } = await supabaseAdmin
    .from("booking_events")
    .insert({
      booking_id: bookingId,
      event_type: eventType,
      actor_role: "system",
      actor_id: null,
      message,
      metadata: {
        ...metadata,
        delivery_status: "claimed",
      },
    });

  if (!error) return true;

  // Unique index means another scheduler already claimed this delivery.
  if (error.code === "23505") return false;

  throw new Error(
    `Unable to claim booking event ${eventType}: ${error.message}`
  );
}

async function updateEventDelivery({
  bookingId,
  eventType,
  deliveryStatus,
  providerId = null,
  errorMessage = null,
}) {
  const { data: existingEvent, error: readError } = await supabaseAdmin
    .from("booking_events")
    .select("metadata")
    .eq("booking_id", bookingId)
    .eq("event_type", eventType)
    .maybeSingle();

  if (readError) {
    console.error(
      `Unable to read booking event ${eventType}:`,
      readError.message
    );
    return;
  }

  const metadata = {
    ...(existingEvent?.metadata || {}),
    delivery_status: deliveryStatus,
    provider_id: providerId,
    error: errorMessage,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("booking_events")
    .update({ metadata })
    .eq("booking_id", bookingId)
    .eq("event_type", eventType);

  if (error) {
    console.error(
      `Unable to update booking event ${eventType}:`,
      error.message
    );
  }
}

async function sendPushDelivery({
  booking,
  eventType,
  userId,
  title,
  body,
  data,
  message,
  metadata,
}) {
  const claimed = await claimEvent({
    bookingId: booking.id,
    eventType,
    message,
    metadata,
  });

  if (!claimed) return false;

  try {
    const result = await notifyUser({
      supabaseAdmin,
      userId,
      title,
      body,
      data,
    });

    await updateEventDelivery({
      bookingId: booking.id,
      eventType,
      deliveryStatus: result?.ok ? "accepted" : "failed",
      providerId:
        result?.results?.find((item) => item?.ticketId)?.ticketId || null,
      errorMessage: result?.ok
        ? null
        : result?.error || "Expo push was not accepted",
    });

    return Boolean(result?.ok);
  } catch (error) {
    await updateEventDelivery({
      bookingId: booking.id,
      eventType,
      deliveryStatus: "failed",
      errorMessage: error.message,
    });

    return false;
  }
}

async function send15MinuteReminder(booking) {
  return sendPushDelivery({
    booking,
    eventType: EVENT_15M_PUSH,
    userId: booking.host_id,
    title: "⏰ Booking Request Waiting",
    body:
      "You have a GigRide booking request waiting for your decision. Please approve or decline it.",
    data: {
      type: "host_booking_reminder",
      bookingId: booking.id,
      reminderStage: "15m",
    },
    message: "15-minute host booking reminder push claimed.",
    metadata: {
      reminder_stage: "15m",
      channel: "push",
      booking_status: booking.status,
    },
  });
}

async function sendOneHourPush(booking) {
  return sendPushDelivery({
    booking,
    eventType: EVENT_1H_PUSH,
    userId: booking.host_id,
    title: "⚠️ Action Needed: Booking Request",
    body:
      "Your GigRide booking request has been waiting for more than an hour. Please approve or decline it as soon as possible.",
    data: {
      type: "host_booking_reminder",
      bookingId: booking.id,
      reminderStage: "1h",
    },
    message: "1-hour host booking reminder push claimed.",
    metadata: {
      reminder_stage: "1h",
      channel: "push",
      booking_status: booking.status,
    },
  });
}

async function sendOneHourEmail(booking) {
  const claimed = await claimEvent({
    bookingId: booking.id,
    eventType: EVENT_1H_EMAIL,
    message: "1-hour host booking reminder email claimed.",
    metadata: {
      reminder_stage: "1h",
      channel: "email",
      booking_status: booking.status,
    },
  });

  if (!claimed) return false;

  try {
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.getUserById(booking.host_id);

    if (authError) {
      throw new Error(
        `Unable to load host email: ${authError.message}`
      );
    }

    const hostEmail = authData?.user?.email || null;

    if (!hostEmail) {
      throw new Error("Host does not have an email address.");
    }

    const result = await sendHostBookingReminderEmail({
      to: hostEmail,
      bookingId: booking.id,
    });

    await updateEventDelivery({
      bookingId: booking.id,
      eventType: EVENT_1H_EMAIL,
      deliveryStatus: result?.ok ? "accepted" : "failed",
      providerId: result?.id || null,
      errorMessage: result?.ok
        ? null
        : result?.error || "Reminder email was not accepted",
    });

    return Boolean(result?.ok);
  } catch (error) {
    await updateEventDelivery({
      bookingId: booking.id,
      eventType: EVENT_1H_EMAIL,
      deliveryStatus: "failed",
      errorMessage: error.message,
    });

    return false;
  }
}

async function sendTwelveHourEscalation(booking) {
  const ownerUserId = String(
    process.env.GIGRIDE_OWNER_USER_ID || ""
  ).trim();

  if (!ownerUserId) {
    console.error("GIGRIDE_OWNER_USER_ID is not configured.");
    return false;
  }

  return sendPushDelivery({
    booking,
    eventType: EVENT_12H_OWNER_PUSH,
    userId: ownerUserId,
    title: "🚨 GigRide Booking Still Unanswered",
    body: `Booking ${booking.id} has been awaiting host approval for 12 hours. Follow-up is needed.`,
    data: {
      type: "host_booking_escalation",
      bookingId: booking.id,
      hostId: booking.host_id,
      reminderStage: "12h",
    },
    message: "12-hour unanswered booking owner escalation.",
    metadata: {
      reminder_stage: "12h",
      channel: "push",
      booking_status: booking.status,
      host_id: booking.host_id,
    },
  });
}

async function sendTwoHourEscalation(booking) {
  const ownerUserId = String(
    process.env.GIGRIDE_OWNER_USER_ID || ""
  ).trim();

  if (!ownerUserId) {
    console.error("GIGRIDE_OWNER_USER_ID is not configured.");
    return false;
  }

  return sendPushDelivery({
    booking,
    eventType: EVENT_2H_OWNER_PUSH,
    userId: ownerUserId,
    title: "⚠️ GigRide Booking Still Unanswered",
    body: `Host has not responded to booking ${booking.id} after 2 hours.`,
    data: {
      type: "host_booking_escalation",
      bookingId: booking.id,
      hostId: booking.host_id,
      reminderStage: "2h",
    },
    message: "2-hour unanswered booking owner escalation.",
    metadata: {
      reminder_stage: "2h",
      channel: "push",
      booking_status: booking.status,
      host_id: booking.host_id,
    },
  });
}

async function sendThirtyMinuteEscalation(booking) {
  const ownerUserId = String(
    process.env.GIGRIDE_OWNER_USER_ID || ""
  ).trim();

  if (!ownerUserId) {
    console.error("GIGRIDE_OWNER_USER_ID is not configured.");
    return false;
  }

  return sendPushDelivery({
    booking,
    eventType: EVENT_30M_OWNER_PUSH,
    userId: ownerUserId,
    title: "⏰ GigRide Booking Awaiting Approval",
    body: `Host has not responded to booking ${booking.id} after 30 minutes.`,
    data: {
      type: "host_booking_escalation",
      bookingId: booking.id,
      hostId: booking.host_id,
      reminderStage: "30m",
    },
    message: "30-minute unanswered booking owner escalation.",
    metadata: {
      reminder_stage: "30m",
      channel: "push",
      booking_status: booking.status,
      host_id: booking.host_id,
    },
  });
}


async function runHostBookingReminders() {
  const now = Date.now();

  const fifteenMinutesAgo =
    new Date(now - 15 * 60 * 1000).toISOString();
const thirtyMinutesAgo =
  new Date(now - 30 * 60 * 1000).toISOString();
  const oneHourAgo =
    new Date(now - 60 * 60 * 1000).toISOString();
const twoHoursAgo =
  new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const twelveHoursAgo =
  new Date(now - 12 * 60 * 60 * 1000).toISOString();

  const today = new Date().toISOString().slice(0, 10);

  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select("id,host_id,status,created_at,start_date,end_date")
    .eq("status", "requested")
    .gte("start_date", today)
    .lte("created_at", fifteenMinutesAgo)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Unable to load requested bookings: ${error.message}`
    );
  }

  let fifteenMinutePushesAccepted = 0;
  let oneHourPushesAccepted = 0;
  let oneHourEmailsAccepted = 0;


  for (const booking of bookings || []) {
    if (!booking.host_id) continue;

    if (await send15MinuteReminder(booking)) {
      fifteenMinutePushesAccepted += 1;
    }
if (booking.created_at <= thirtyMinutesAgo) {
  await sendThirtyMinuteEscalation(booking);
}
    if (booking.created_at <= oneHourAgo) {
      if (await sendOneHourPush(booking)) {
        oneHourPushesAccepted += 1;
      }

      if (await sendOneHourEmail(booking)) {
        oneHourEmailsAccepted += 1;
      }
    }
if (booking.created_at <= twoHoursAgo) {
  await sendTwoHourEscalation(booking);
}
    if (booking.created_at <= twelveHoursAgo) {
  await sendTwelveHourEscalation(booking);
}
  }

  return {
    checked: bookings?.length || 0,
    fifteenMinutePushesAccepted,
    oneHourPushesAccepted,
    oneHourEmailsAccepted,

  };
}

module.exports = { runHostBookingReminders };
