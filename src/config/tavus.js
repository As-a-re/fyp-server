/**
 * Tavus AI Configuration — English path only.
 *
 * The app now routes by language before ever reaching this module: English
 * selections go to Tavus (this file), Twi selections go to the free knowledge-base +
 * TalkingHead pipeline (see services/twiAssistant.js). There is no more
 * per-language branching here or translation bridging in front of Tavus —
 * Tavus always runs in English, using the shared M-CARE clinical persona.
 */

const mcare = require("./mcarePersona");

const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
const TAVUS_API_URL = process.env.TAVUS_API_URL || "https://tavusapi.com/v2";
const TAVUS_PERSONA_ID = process.env.TAVUS_PERSONA_ID;
const TAVUS_REPLICA_ID = process.env.TAVUS_REPLICA_ID;

const validateConfig = () => {
  if (!TAVUS_API_KEY || !TAVUS_PERSONA_ID || !TAVUS_REPLICA_ID) {
    console.warn(
      "⚠️ Tavus configuration incomplete. Set TAVUS_API_KEY, TAVUS_PERSONA_ID, TAVUS_REPLICA_ID.",
    );
  }
};

const getTavusConfig = () => {
  validateConfig();
  return {
    apiKey: TAVUS_API_KEY,
    apiUrl: TAVUS_API_URL,
    personaId: TAVUS_PERSONA_ID,
    replicaId: TAVUS_REPLICA_ID,
    name: "M-CARE Maternal Support Agent",
    instructions: mcare.IDENTITY,
    headers: {
      "x-api-key": TAVUS_API_KEY,
      "Content-Type": "application/json",
    },
  };
};

module.exports = {
  getTavusConfig,
  TAVUS_API_KEY,
  TAVUS_API_URL,
  TAVUS_PERSONA_ID,
  TAVUS_REPLICA_ID,
};
