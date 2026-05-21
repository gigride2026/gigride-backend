const express = require("express");
const router = express.Router();

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyUser } = require("../utils/pushNotifications.cjs");

router.post("/notify", async (req, res) => {
  try {
    const { conversation_id, sender_id, body } = req.body || {};

    if (!conversation_id || !sender_id) {
      return res.status(400).json({ error: "Missing conversation_id or sender_id" });
    }

    const { data: convo, error } = await supabaseAdmin
      .from("conversations")
      .select("id, booking_id, driver_id, host_id")
      .eq("id", conversation_id)
      .single();

    if (error || !convo) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    const recipientId =
      sender_id === convo.driver_id ? convo.host_id : convo.driver_id;

    if (!recipientId || recipientId === sender_id) {
      return res.json({ ok: true, skipped: true, reason: "No separate recipient" });
    }

    await notifyUser({
      supabaseAdmin,
      userId: recipientId,
      title: "New Message",
      body: body || "You have a new message.",
      data: {
        type: "new_message",
        conversationId: conversation_id,
        bookingId: convo.booking_id,
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    console.error("MESSAGE NOTIFY ERROR:", e);
    return res.status(500).json({ error: e.message || "Failed to notify message" });
  }
});

module.exports = router;