const { RtcTokenBuilder, RtcRole } = require("agora-access-token");
const db = require("../utils/db");

const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

// Get Agora Token
exports.getAgoraToken = async (req, res) => {
  try {
    const { channelName, callType } = req.body;
    const userId = req.user.id;

    if (!channelName) {
      return res.status(400).json({ error: "Channel name is required" });
    }

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      return res.status(500).json({
        error: "Agora credentials not configured",
      });
    }

    // Generate token
    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      userId,
      RtcRole.PUBLISHER,
      privilegeExpiredTs,
    );

    return res.status(200).json({
      token,
      appId: AGORA_APP_ID,
      uid: userId,
      channelName,
      callType,
    });
  } catch (error) {
    console.error("Error generating token:", error);
    return res.status(500).json({
      error: "Failed to generate token",
      message: error.message,
    });
  }
};

// Initiate a call
exports.initiateCall = async (req, res) => {
  try {
    const { recipient_id, call_type, channel_name } = req.body;
    const caller_id = req.user.id;

    if (!recipient_id || !call_type) {
      return res.status(400).json({
        error: "recipient_id and call_type are required",
      });
    }

    // Create call record
    const query = `
      INSERT INTO calls (caller_id, recipient_id, call_type, channel_name, status, started_at)
      VALUES (?, ?, ?, ?, 'initiated', NOW())
      RETURNING id, caller_id, recipient_id, call_type, status, started_at
    `;

    const result = await db.execute(query, [
      caller_id,
      recipient_id,
      call_type,
      channel_name || `call_${caller_id}_${recipient_id}`,
    ]);

    const callRecord = result[0];

    // TODO: Send notification to recipient about incoming call
    // You might want to use socket.io or push notifications here

    return res.status(201).json({
      message: "Call initiated",
      call: callRecord,
    });
  } catch (error) {
    console.error("Error initiating call:", error);
    return res.status(500).json({
      error: "Failed to initiate call",
      message: error.message,
    });
  }
};

// Accept a call
exports.acceptCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const query = `
      UPDATE calls
      SET status = 'accepted', accepted_at = NOW()
      WHERE id = ? AND recipient_id = ?
      RETURNING id, status, accepted_at
    `;

    const result = await db.execute(query, [callId, userId]);

    if (result.length === 0) {
      return res.status(404).json({ error: "Call not found" });
    }

    return res.status(200).json({
      message: "Call accepted",
      call: result[0],
    });
  } catch (error) {
    console.error("Error accepting call:", error);
    return res.status(500).json({
      error: "Failed to accept call",
      message: error.message,
    });
  }
};

// Reject a call
exports.rejectCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const query = `
      UPDATE calls
      SET status = 'rejected', ended_at = NOW()
      WHERE id = ? AND (recipient_id = ? OR caller_id = ?)
      RETURNING id, status, ended_at
    `;

    const result = await db.execute(query, [callId, userId, userId]);

    if (result.length === 0) {
      return res.status(404).json({ error: "Call not found" });
    }

    return res.status(200).json({
      message: "Call rejected",
      call: result[0],
    });
  } catch (error) {
    console.error("Error rejecting call:", error);
    return res.status(500).json({
      error: "Failed to reject call",
      message: error.message,
    });
  }
};

// End a call
exports.endCall = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user.id;

    const query = `
      UPDATE calls
      SET status = 'ended', ended_at = NOW()
      WHERE (id = ? OR channel_name = ?) AND (caller_id = ? OR recipient_id = ?)
      RETURNING id, status, ended_at, started_at
    `;

    const result = await db.execute(query, [callId, callId, userId, userId]);

    if (result.length === 0) {
      return res.status(404).json({ error: "Call not found" });
    }

    const call = result[0];

    // Calculate call duration
    let duration = null;
    if (call.started_at && call.ended_at) {
      duration = Math.floor(
        (new Date(call.ended_at) - new Date(call.started_at)) / 1000,
      );
    }

    return res.status(200).json({
      message: "Call ended",
      call: {
        ...call,
        duration,
      },
    });
  } catch (error) {
    console.error("Error ending call:", error);
    return res.status(500).json({
      error: "Failed to end call",
      message: error.message,
    });
  }
};

// Get call history
exports.getCallHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const query = `
      SELECT 
        c.*,
        CASE 
          WHEN c.caller_id = ? THEN 'outgoing'
          ELSE 'incoming'
        END as direction
      FROM calls c
      WHERE c.caller_id = ? OR c.recipient_id = ?
      ORDER BY c.started_at DESC
      LIMIT ? OFFSET ?
    `;

    const calls = await db.execute(query, [
      userId,
      userId,
      userId,
      limit,
      offset,
    ]);

    return res.status(200).json({
      calls,
      total: calls.length,
    });
  } catch (error) {
    console.error("Error fetching call history:", error);
    return res.status(500).json({
      error: "Failed to fetch call history",
      message: error.message,
    });
  }
};

// Get active call
exports.getActiveCall = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT *
      FROM calls
      WHERE (caller_id = ? OR recipient_id = ?)
        AND status IN ('initiated', 'accepted')
      ORDER BY started_at DESC
      LIMIT 1
    `;

    const results = await db.execute(query, [userId, userId]);

    if (results.length === 0) {
      return res.status(200).json({
        activeCall: null,
      });
    }

    return res.status(200).json({
      activeCall: results[0],
    });
  } catch (error) {
    console.error("Error fetching active call:", error);
    return res.status(500).json({
      error: "Failed to fetch active call",
      message: error.message,
    });
  }
};
