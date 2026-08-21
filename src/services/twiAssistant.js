/**
 * Orchestrates the whole Twi-side pipeline. This is the Twi equivalent of
 * tavusOrchestrator.js, but instead of forwarding to Tavus it drives:
 *
 *   user text/voice (Twi, English, or code-mixed)
 *     -> detect language mix
 *     -> normalize to English
 *     -> check for an emergency or a "are you a doctor?" question first -
 *        if matched, use the M-CARE Twi knowledge base's own fixed,
 *        previously-reviewed Twi answer verbatim, skipping translation
 *        entirely for these two safety/trust-critical cases
 *     -> otherwise: retrieve relevant chunks + generate a grounded answer
 *        (free TF-IDF retrieval in ml-service + Groq for generation - see
 *        services/ragService.js; this replaced CustomGPT.ai, which requires
 *        payment after a 7-day company-email-gated trial)
 *     -> translate the grounded English answer back to Twi
 *     -> humanize the Twi so it reads like a person, not a translation
 *     -> synthesize natural-sounding Twi speech (GhanaNLP TTS)
 *     -> return text + audio + rough word timings for the avatar's lip-sync
 *
 * The talking-avatar UI (TalkingHead) never talks to the knowledge base or
 * translator directly - it only calls the /api/twi/* routes backed by this
 * module, so the knowledge base and translation providers can be swapped
 * out later without touching the frontend.
 */

const translator = require("./ghanaTranslator");
const speech = require("./ghanaSpeech");
const kb = require("./ragService");
const { detectMixedLanguage } = require("./mixedLanguageDetector");
const { humanizeTwi } = require("./humanizeTwi");
const mcare = require("../config/mcarePersona");

const FALLBACK_ANSWER_EN =
  "I'm sorry, I don't have that information in my knowledge base yet. Please ask your midwife or doctor, or try rephrasing your question.";

/** Rough per-word duration estimate, sent alongside the reply text mainly so
 * the avatar page has a words/wtimes/wdurations fallback available. The
 * avatar's primary lip-sync signal is now a dedicated Twi grapheme-to-viseme
 * engine (see components/twiAvatarHtml.js -> twiTextToVisemes) that reads
 * the actual reply_text and scales itself to the real synthesized audio
 * duration, so this no longer has to carry the whole approximation on its
 * own — it's a fallback, not the primary sync mechanism. */
const DEFAULT_WORDS_PER_SECOND = 2.3;

function buildWordTimings(text, durationSeconds) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return { words: [], wtimes: [], wdurations: [] };

  const totalSeconds =
    durationSeconds && durationSeconds > 0
      ? durationSeconds
      : words.length / DEFAULT_WORDS_PER_SECOND;

  const perWordMs = (totalSeconds * 1000) / words.length;

  const wtimes = words.map((_, i) => Math.round(i * perWordMs));
  const wdurations = words.map(() => Math.round(perWordMs * 0.9));

  return { words, wtimes, wdurations };
}

async function toEnglishQuery(text, mix) {
  if (mix.language === "en") return text;

  // For pure Twi or code-mixed input, translate the whole thing to English
  // so the knowledge base (which is indexed in English) gets a clean query.
  const translated = await translator.twiToEnglish(text);
  return translated.translation || translated.text || translated || text;
}

async function toTwiReply(englishText) {
  const translated = await translator.englishToTwi(englishText);
  return translated.translation || translated.text || translated || englishText;
}

class TwiAssistant {
  /**
   * @param {string} text - user message, possibly mixed Twi/English
   * @param {object} opts
   * @param {string} opts.sessionKey - stable per-user/session id for KB threading
   * @param {boolean} opts.isFirstTurn - first message of the conversation
   * @param {string} opts.speaker - GhanaNLP TTS speaker id
   * @param {boolean} opts.withAudio - whether to synthesize speech too
   */
  async handleMessage(text, opts = {}) {
    const { sessionKey = "default", isFirstTurn = false, speaker = "female", withAudio = true } = opts;

    const mix = detectMixedLanguage(text);

    const englishQuery = await toEnglishQuery(text, mix);

    // Module 5 (Emergency Override) takes priority over every other module,
    // on both the English and Twi paths: a red-flag symptom always gets the
    // same urgent instruction, skipping the knowledge-base round trip.
    const textEmergency = mcare.detectEmergency(text);
    const emergency = textEmergency.isEmergency ? textEmergency : mcare.detectEmergency(englishQuery);

    // "Are you a doctor/real/human?" gets the exact previously-reviewed
    // self-disclosure answer too, rather than leaving a trust-sensitive
    // question to free-form generation.
    const isSelfDisclosure = !emergency.isEmergency && mcare.detectSelfDisclosure(text);

    let englishAnswer;
    let citations = [];
    let isEmergency = false;
    let twiReply;

    if (emergency.isEmergency) {
      englishAnswer = mcare.EMERGENCY_RESPONSE_EN;
      isEmergency = true;
      // Used directly, verbatim, not machine-translated: the M-CARE Twi
      // knowledge base's own QA notes are explicit that translation must
      // never be allowed to soften an emergency instruction, so this fixed,
      // previously-reviewed Twi string is used as-is instead of round-
      // tripping EMERGENCY_RESPONSE_EN through the translator.
      twiReply = mcare.EMERGENCY_RESPONSE_TW;
    } else if (isSelfDisclosure) {
      englishAnswer = mcare.SELF_DISCLOSURE_EN;
      // Same reasoning as the emergency case: a fixed, reviewed answer to a
      // trust-sensitive question, used verbatim rather than translated.
      twiReply = mcare.SELF_DISCLOSURE_TW;
    } else if (kb.isConfigured()) {
      try {
        const kbResult = await kb.ask(englishQuery, sessionKey);
        englishAnswer = kbResult.answer || FALLBACK_ANSWER_EN;
        citations = kbResult.citations;
      } catch (error) {
        console.error("Knowledge-base error:", error.message);
        englishAnswer = FALLBACK_ANSWER_EN;
      }
    } else {
      englishAnswer = FALLBACK_ANSWER_EN;
    }

    if (twiReply === undefined) {
      const rawTwiReply = await toTwiReply(englishAnswer);
      twiReply = humanizeTwi(rawTwiReply, { isFirstTurn });

      // If the answer was grounded in a lab-explanation chunk, append the
      // knowledge base's own standard safety closing line (Twi, verbatim)
      // rather than leaving that boundary to per-generation phrasing.
      const isLabTopic = citations.some((c) => c.metadata?.category === "lab");
      if (isLabTopic) {
        twiReply = `${twiReply} ${mcare.LAB_CLOSING_LINE_TW}`;
      }
    }

    const result = {
      detected_language: mix.language,
      twi_ratio: mix.twiRatio,
      input_text: text,
      english_query: englishQuery,
      english_answer: englishAnswer,
      reply_text: twiReply,
      citations,
      is_emergency: isEmergency,
      emergency_keyword: emergency.matchedKeyword,
      is_self_disclosure: isSelfDisclosure,
    };

    if (withAudio && twiReply) {
      try {
        const audioBuffer = await speech.tts(twiReply, speaker, "tw");
        result.audio_base64 = Buffer.from(audioBuffer).toString("base64");
        result.audio_mime = "audio/wav";
        // Word-level fallback timing only; the avatar computes its real
        // Twi viseme timeline itself from reply_text + actual audio
        // duration (see twiAvatarHtml.js).
        result.lipsync = buildWordTimings(twiReply, null);
      } catch (error) {
        console.error("Twi TTS error:", error.message);
      }
    }

    return result;
  }

  /**
   * Synthesize speech + lip-sync data for text that's already in Twi (no
   * detection, knowledge-base lookup, or translation) - used for the fixed
   * welcome greeting the avatar speaks when a conversation starts, and
   * useful generally for any other pre-written Twi prompt.
   */
  async synthesize(text, { speaker = "female" } = {}) {
    if (!text || !text.trim()) {
      return { reply_text: "" };
    }

    const result = { reply_text: text };

    try {
      const audioBuffer = await speech.tts(text, speaker, "tw");
      result.audio_base64 = Buffer.from(audioBuffer).toString("base64");
      result.audio_mime = "audio/wav";
      result.lipsync = buildWordTimings(text, null);
    } catch (error) {
      console.error("Twi TTS error (synthesize):", error.message);
    }

    return result;
  }
}

module.exports = new TwiAssistant();
