const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

router.post("/register-token", authenticateToken, [
  body("expo_push_token").trim().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { expo_push_token, platform, device_name } = req.body;
    const { data, error } = await supabase.from("push_tokens").upsert({
      user_id: req.user.id,
      expo_push_token,
      platform: platform || null,
      device_name: device_name || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,expo_push_token" }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, token: data });
  } catch (error) {
    console.error("Register push token error:", error);
    res.status(500).json({ error: "Failed to register push token" });
  }
});

router.get("/", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase.from("notifications")
      .select("*").eq("user_id", req.user.id)
      .order("created_at", { ascending: false }).limit(Math.min(Number(req.query.limit) || 50, 100));
    if (error) return res.status(500).json({ error: error.message });
    res.json({ notifications: data || [] });
  } catch (error) {
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

router.patch("/:id/read", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase.from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq("id", req.params.id).eq("user_id", req.user.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ notification: data });
  } catch (error) {
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});

module.exports = router;
