/**
 * Mixed Twi/English language detector.
 *
 * Twi speakers very commonly code-switch mid-sentence ("Me pain no worry me paa",
 * "I dey feel dizzy small small"). A single-label detector (like franc) picks one
 * language for the whole string and throws away that signal, so this module scores
 * the sentence at the *word* level using a curated Twi function-word/stopword list
 * (the words that carry the most signal: pronouns, particles, conjunctions, common
 * verbs) plus a couple of orthographic cues (ɛ, ɔ, Twi digraphs) that never appear
 * in English. franc-min is used only as a tie-breaker for short/ambiguous input.
 */

const { franc } = require("franc-min");

// High-frequency Twi function words / particles / common verbs. Deliberately
// short (function words) because those are the words that show up regardless
// of topic, which is what makes them reliable code-switch signals.
const TWI_MARKERS = new Set([
  "me", "wo", "ne", "yɛn", "yɛ", "won", "wɔn", "ɛyɛ", "eyi", "ɛyi",
  "na", "nti", "efisɛ", "sɛ", "sɛn", "wɔ", "wɔho", "aane", "aane",
  "daabi", "yoo", "adɛn", "adɛn nti", "ɔyare", "ɔyaw", "yare", "yaw",
  "abasabasa", "apɔmuden", "apɔmden", "akwahosan", "onipa", "abofra",
  "nyinsɛn", "nyinsɛn", "awo", "awoo", "ɔyafunu", "yafunu", "ɔfa",
  "meda", "meda wo ase", "medaase", "ɛte sɛn", "ɛte", "wobɛtumi",
  "bɛtumi", "tumi", "menim", "minim", "mepɛ", "menpɛ", "mepɛsɛ",
  "mereka", "mereka sɛ", "kae", "kyerɛ", "kyerɛkyerɛ", "ka kyerɛ",
  "papa", "papabi", "paa", "koraa", "biara", "nyinaa", "bra", "kɔ",
  "kɔɔ", "aba", "baa", "ɛkɔm", "ɔkɔm", "nsuo", "nsu", "aduane",
  "ade", "adeɛ", "hwɛ", "hwɛ me", "boa", "boa me", "mehia", "hia",
  "ntɛm", "ntɛm ara", "seesei", "afei", "ɛnnɛ", "ɔkyena", "nkyɛe",
  "anɔpa", "anwummerɛ", "anadwo", "abusua", "kunu", "yere", "ba",
  "mmɔfra", "onua",
  // Symptom vocabulary from the M-CARE Expanded Twi Knowledge Base's
  // "Expanded Symptom Vocabulary" section - real clinical/symptom words a
  // Twi speaker would actually type when describing how they feel, which
  // is exactly the kind of code-switch-triggering content the original
  // function-word list above didn't cover (it was general-purpose, not
  // symptom-specific).
  "feɛ", "akyi", "yafunu", "ɔhyew", "twitwe", "afuru", "honam", "yam",
  "ɔberɛfoɔ", "abrɛ", "nna", "atifi", "ntwiri", "ahummu", "ahome",
  "nsammogya", "hoɔ", "horo", "pian", "mmerɛw", "ɛnhwe", "nan",
  "kɛseɛ", "denden", "nnyinaadeɛ", "nkyekyeraseɛ", "adwenem", "ɛyera",
  "ntɔ", "fam", "atiridii", "koko", "ahonhon", "akuro", "nnum", "nufu",
  "akokɔsradeɛ", "kankyee",
]);

// Character sequences that basically never occur in English but are common
// in written Twi (open vowels ɛ/ɔ, and a few frequent digraphs/diacritics).
const TWI_ORTHOGRAPHY = /[ɛɔ]|nyinsɛn|kyerɛ|hyɛ/i;

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * @param {string} text
 * @returns {{ language: 'en'|'tw'|'mixed', twiRatio: number, tokenCount: number,
 *             twiTokens: string[], confidence: number }}
 */
function detectMixedLanguage(text) {
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    return { language: "en", twiRatio: 0, tokenCount: 0, twiTokens: [], confidence: 0 };
  }

  const twiTokens = tokens.filter(
    (t) => TWI_MARKERS.has(t) || TWI_ORTHOGRAPHY.test(t),
  );

  const twiRatio = twiTokens.length / tokens.length;

  // Franc is a whole-string classifier; use it only when our word-level scan
  // is inconclusive (very short messages, or no marker words hit at all).
  let francGuess = null;
  if (tokens.length <= 3 || twiTokens.length === 0) {
    const code = franc(text);
    if (code === "aka") francGuess = "tw";
    else if (code === "eng") francGuess = "en";
  }

  let language;
  if (twiRatio === 0) {
    language = francGuess === "tw" ? "tw" : "en";
  } else if (twiRatio >= 0.75) {
    language = "tw";
  } else if (twiRatio > 0) {
    language = "mixed";
  }

  const confidence = twiRatio === 0 && !francGuess ? 0.4 : Math.min(0.5 + twiRatio, 0.95);

  return { language, twiRatio, tokenCount: tokens.length, twiTokens, confidence };
}

module.exports = { detectMixedLanguage, tokenize };
