const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken, requireRole } = require("../middleware/auth");

const router = express.Router();

// Send message
router.post(
  "/send",
  authenticateToken,
  [
    body("recipient_id").notEmpty().withMessage("Recipient ID required"),
    body("message")
      .trim()
      .isLength({ min: 1, max: 1000 })
      .withMessage("Message must be 1-1000 characters"),
    body("message_type")
      .optional()
      .isIn(["text", "medical_report", "emergency"])
      .withMessage("Invalid message type"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { recipient_id, message, message_type = "text" } = req.body;

      // Verify recipient exists
      const { data: recipient, error: recipientError } = await supabase
        .from("users")
        .select("id, name, role")
        .eq("id", recipient_id)
        .single();

      if (recipientError || !recipient) {
        return res.status(404).json({ error: "Recipient not found" });
      }

      // Validate communication rules
      if (
        req.user.role === "Mother" &&
        recipient.role !== "Doctor" &&
        recipient.role !== "Administrator"
      ) {
        return res.status(403).json({
          error: "Mothers can only message doctors or administrators",
        });
      }

      if (
        req.user.role === "Doctor" &&
        recipient.role !== "Mother" &&
        recipient.role !== "Administrator"
      ) {
        return res.status(403).json({
          error: "Doctors can only message mothers or administrators",
        });
      }

      // Create message
      const { data: newMessage, error } = await supabase
        .from("messages")
        .insert([
          {
            sender_id: req.user.id,
            recipient_id,
            message,
            message_type,
            created_at: new Date().toISOString(),
            read_at: null,
          },
        ])
        .select(
          `
        *,
        sender:sender_id(name, role),
        recipient:recipient_id(name, role)
      `,
        )
        .single();

      if (error) {
        return res
          .status(500)
          .json({ error: "Failed to send message", details: error.message });
      }

      // Send notification (in production, this would use push notifications, email, etc.)
      await sendMessageNotification(recipient_id, newMessage);

      res.status(201).json({
        message: "Message sent successfully",
        data: newMessage,
      });
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get conversation
router.get("/conversation/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Verify user exists
    const { data: otherUser, error: userError } = await supabase
      .from("users")
      .select("id, name, role")
      .eq("id", userId)
      .single();

    if (userError || !otherUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get conversation between current user and specified user
    const { data: messages, error } = await supabase
      .from("messages")
      .select(
        `
        *,
        sender:sender_id(name, role),
        recipient:recipient_id(name, role)
      `,
      )
      .or(
        `and(sender_id.eq.${req.user.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${req.user.id})`,
      )
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch conversation",
        details: error.message,
      });
    }

    // Mark messages as read if current user is recipient
    const unreadMessages = messages.filter(
      (msg) => msg.recipient_id === req.user.id && !msg.read_at,
    );
    if (unreadMessages.length > 0) {
      await supabase
        .from("messages")
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_id", req.user.id)
        .eq("sender_id", userId)
        .is("read_at", null);
    }

    res.json({
      messages: messages.reverse(), // Reverse to show chronological order
      otherUser,
      unreadCount: unreadMessages.length,
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all conversations (list of users with whom current user has messaged)
router.get("/conversations", authenticateToken, async (req, res) => {
  try {
    // Get unique conversation partners
    const { data: conversations, error } = await supabase
      .from("messages")
      .select(
        `
        id,
        sender_id,
        recipient_id,
        created_at,
        read_at,
        sender:sender_id(id, name, role),
        recipient:recipient_id(id, name, role)
      `,
      )
      .or(`sender_id.eq.${req.user.id},recipient_id.eq.${req.user.id}`)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch conversations",
        details: error.message,
      });
    }

    // Process conversations to get unique users and last message
    const userMap = new Map();

    conversations.forEach((msg) => {
      const otherUser =
        msg.sender_id === req.user.id ? msg.recipient : msg.sender;

      // Skip if other user data is missing
      if (!otherUser || !otherUser.id) {
        console.warn(
          "Skipping conversation with missing user data:",
          msg.sender_id === req.user.id ? msg.recipient_id : msg.sender_id,
        );
        return;
      }

      const otherUserId = otherUser.id;

      if (!userMap.has(otherUserId)) {
        userMap.set(otherUserId, {
          user: otherUser,
          user_id: otherUser.id, // Add alias for compatibility
          lastMessage: {
            id: msg.id,
            message: msg.message,
            message_type: msg.message_type,
            created_at: msg.created_at,
            is_from_me: msg.sender_id === req.user.id,
            is_read: msg.read_at !== null,
          },
          unreadCount: 0,
        });
      }

      // Count unread messages
      if (msg.recipient_id === req.user.id && !msg.read_at) {
        const conv = userMap.get(otherUserId);
        conv.unreadCount++;
      }
    });

    const conversationList = Array.from(userMap.values());

    res.json({
      conversations: conversationList,
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get unread message count
router.get("/unread-count", authenticateToken, async (req, res) => {
  try {
    const { count, error } = await supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("recipient_id", req.user.id)
      .is("read_at", null);

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch unread count",
        details: error.message,
      });
    }

    res.json({
      unreadCount: count || 0,
    });
  } catch (error) {
    console.error("Unread count error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Mark message as read
router.post("/mark-read/:messageId", authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;

    const { data: message, error } = await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("id", messageId)
      .eq("recipient_id", req.user.id)
      .select()
      .single();

    if (error || !message) {
      return res
        .status(404)
        .json({ error: "Message not found or not authorized" });
    }

    res.json({
      message: "Message marked as read",
      data: message,
    });
  } catch (error) {
    console.error("Mark as read error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Doctor-only: Get all patient conversations
router.get(
  "/doctor/patients",
  authenticateToken,
  requireRole(["Doctor"]),
  async (req, res) => {
    try {
      // Get all unique patients this doctor has messaged with
      const { data: patients, error } = await supabase
        .from("messages")
        .select(
          `
        sender_id,
        recipient_id,
        sender:sender_id(id, name, email, phone),
        recipient:recipient_id(id, name, email, phone)
      `,
        )
        .or(`sender_id.eq.${req.user.id},recipient_id.eq.${req.user.id}`)
        .eq("sender.role", "Mother")
        .or("recipient.role.eq.Mother");

      if (error) {
        return res
          .status(500)
          .json({ error: "Failed to fetch patients", details: error.message });
      }

      // Get unique patients
      const patientMap = new Map();

      patients.forEach((msg) => {
        const patient =
          msg.sender.role === "Mother" ? msg.sender : msg.recipient;
        if (patient && !patientMap.has(patient.id)) {
          patientMap.set(patient.id, patient);
        }
      });

      const patientList = Array.from(patientMap.values());

      res.json({
        patients: patientList,
      });
    } catch (error) {
      console.error("Get patients error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Helper function to send notifications
async function sendMessageNotification(recipientId, message) {
  try {
    // In production, this would:
    // - Send push notifications via Firebase/Expo
    // - Send email notifications
    // - Send SMS notifications
    // - Create real-time database subscriptions

    const senderName = message?.sender?.name || "unknown sender";
    console.log(
      `Notification: New message from ${senderName} to user ${recipientId}`,
    );

    // For now, we'll just log it
    return true;
  } catch (error) {
    console.error("Failed to send notification:", error);
    return false;
  }
}

module.exports = router;
