const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/auth.cjs");

router.use(authMiddleware);
const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { notifyUser } = require("../utils/pushNotifications.cjs");
const ADMIN_USER_ID = "7e4696e3-e767-4f6c-887d-052b2c0ed588";

function requireAdmin(req, res, next) {
  if (req.user?.id !== ADMIN_USER_ID) {
    return res.status(403).json({
      error: "Administrator access required",
    });
  }

  next();
}
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

    const authenticatedUserId = req.user?.id;

if (
  sender_id !== authenticatedUserId ||
  (authenticatedUserId !== convo.driver_id &&
    authenticatedUserId !== convo.host_id)
) {
  return res.status(403).json({
    error: "Not authorized for this conversation",
  });
}

const recipientId =
  authenticatedUserId === convo.driver_id
    ? convo.host_id
    : convo.driver_id;

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
router.post("/admin/conversations", requireAdmin, async (req, res) => {
  try {
    const adminId = req.user.id;
    const { customer_id, customer_role } = req.body || {};

    if (
      !customer_id ||
      !["host", "driver"].includes(customer_role) ||
      customer_id === adminId
    ) {
      return res.status(400).json({
        error: "Valid customer_id and customer_role are required",
      });
    }

    const { data: customer, error: customerError } =
      await supabaseAdmin.auth.admin.getUserById(customer_id);

    if (customerError || !customer?.user) {
      return res.status(404).json({
        error: "Customer not found",
      });
    }

    const { data: conversation, error } = await supabaseAdmin
      .from("admin_conversations")
      .upsert(
        {
          admin_id: adminId,
          customer_id,
          customer_role,
        },
        {
          onConflict: "admin_id,customer_id,customer_role",
          ignoreDuplicates: false,
        }
      )
      .select("id, admin_id, customer_id, customer_role, created_at")
      .single();

    if (error) throw error;

    return res.json({ conversation });
  } catch (error) {
    console.error("ADMIN CONVERSATION ERROR:", error);
    return res.status(500).json({
      error: "Unable to open private conversation",
    });
  }
});
router.get("/admin/conversations/:conversationId/messages", async (req, res) => {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;

    const { data: conversation, error: conversationError } =
      await supabaseAdmin
        .from("admin_conversations")
        .select("id, admin_id, customer_id")
        .eq("id", conversationId)
        .maybeSingle();

    if (conversationError) throw conversationError;

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found",
      });
    }

    if (
      userId !== conversation.admin_id &&
      userId !== conversation.customer_id
    ) {
      return res.status(403).json({
        error: "Not authorized to view this conversation",
      });
    }

    const { data: messages, error } = await supabaseAdmin
      .from("admin_messages")
      .select("id, conversation_id, sender_id, body, read_at, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    return res.json({
      conversation,
      messages: messages || [],
    });
  } catch (error) {
    console.error("ADMIN MESSAGES ERROR:", error);
    return res.status(500).json({
      error: "Unable to retrieve private messages",
    });
  }
});
router.post("/admin/conversations/:conversationId/messages", async (req, res) => {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    const body = String(req.body?.body || "").trim();

    if (!body || body.length > 5000) {
      return res.status(400).json({
        error: "Message must contain 1 to 5000 characters",
      });
    }

    const { data: conversation, error: conversationError } =
      await supabaseAdmin
        .from("admin_conversations")
        .select("id, admin_id, customer_id")
        .eq("id", conversationId)
        .maybeSingle();

    if (conversationError) throw conversationError;

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found",
      });
    }

    if (
      userId !== conversation.admin_id &&
      userId !== conversation.customer_id
    ) {
      return res.status(403).json({
        error: "Not authorized to send messages",
      });
    }

    const { data: message, error } = await supabaseAdmin
      .from("admin_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: userId,
        body,
      })
      .select("id, conversation_id, sender_id, body, created_at, read_at")
      .single();

    if (error) throw error;

    const recipientId =
      userId === conversation.admin_id
        ? conversation.customer_id
        : conversation.admin_id;

    try {
      await notifyUser({
        supabaseAdmin,
        userId: recipientId,
        title: "New Private Message",
        body: "You have a new message on GigRide.",
        data: {
          type: "admin_private_message",
          conversationId,
        },
      });
    } catch (notificationError) {
      console.error("PRIVATE MESSAGE NOTIFICATION ERROR:", notificationError);
    }

    return res.json({ message });
  } catch (error) {
    console.error("PRIVATE MESSAGE SEND ERROR:", error);
    return res.status(500).json({
      error: "Unable to send private message",
    });
  }
});
// List private conversations for the authenticated user.
router.get("/admin/conversations", async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        error: "Authentication required",
      });
    }

    const isAdmin = userId === ADMIN_USER_ID;

    const query = supabaseAdmin
      .from("admin_conversations")
      .select(
        "id, admin_id, customer_id, customer_role, created_at, updated_at"
      )
      .order("updated_at", { ascending: false });

    const { data, error } = await (
      isAdmin
        ? query.eq("admin_id", userId)
        : query.eq("customer_id", userId)
    );

    if (error) throw error;

    return res.json({
      conversations: data || [],
    });
  } catch (error) {
    console.error("PRIVATE CONVERSATION LIST ERROR:", error);

    return res.status(500).json({
      error: "Unable to retrieve private conversations",
    });
  }
});
module.exports = router;
