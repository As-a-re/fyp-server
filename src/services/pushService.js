const axios = require("axios");
const supabase = require("../config/database");

async function sendPushNotification({ userId, title, body, data = {} }) {
  const { data: tokens, error } = await supabase
    .from("push_tokens")
    .select("id, expo_push_token")
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) throw error;
  if (!tokens?.length) return { sent: 0 };

  const messages = tokens.map(({ expo_push_token }) => ({
    to: expo_push_token,
    sound: "default",
    title,
    body,
    data,
  }));

  const response = await axios.post(
    "https://exp.host/--/api/v2/push/send",
    messages,
    { headers: { "Content-Type": "application/json" }, timeout: 15000 },
  );

  return { sent: messages.length, response: response.data };
}

module.exports = { sendPushNotification };
