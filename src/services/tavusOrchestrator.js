/**
 * Tavus conversation builder — English path only.
 *
 * Previously this module also translated messages in and out of Twi so a
 * single Tavus persona could pretend to run bilingually. That translation
 * bridge has been removed: Twi conversations no longer touch Tavus at all,
 * they go through services/twiAssistant.js instead. This module now only
 * builds the conversation payload Tavus expects.
 */

const INTERNAL_LANGUAGE = "en";

const buildConversationPayloadCandidates = (config) => {
  const conversationName = config.name || "M-CARE Maternal Support Agent";

  return [
    {
      replica_id: config.replicaId,
      persona_id: config.personaId,
      conversation_name: conversationName,
      metadata: {
        internal_language: INTERNAL_LANGUAGE,
        instructions: config.instructions,
      },
    },
    {
      replica_id: config.replicaId,
      persona_id: config.personaId,
      conversation_name: conversationName,
      conversation_instructions: config.instructions,
    },
    {
      replica_id: config.replicaId,
      persona_id: config.personaId,
      system_prompt: config.instructions,
    },
    {
      replica_id: config.replicaId,
      persona_id: config.personaId,
    },
  ];
};

module.exports = {
  INTERNAL_LANGUAGE,
  buildConversationPayloadCandidates,
};
