/**
 * Machine-translated Twi tends to read stiffly: overly literal, no
 * conversational particles, sentences that are too long to be spoken
 * naturally by TTS. This module does a light, rule-based pass to make the
 * final text sound like a person chatting with you rather than a translated
 * document, before it's handed to text-to-speech.
 *
 * This is deliberately conservative (no meaning changes) - it only affects
 * cadence, punctuation, and a couple of very common conversational openers.
 */

const CONVERSATIONAL_OPENERS = [
  "Ɛyɛ",
  "Ɔke",
  "Nokware",
  "Wo ho te sɛn?",
];

function pickOpener(isFirstTurn) {
  if (!isFirstTurn) return null;
  return CONVERSATIONAL_OPENERS[0];
}

function splitLongSentences(text) {
  // Break sentences longer than ~22 words at the nearest conjunction so TTS
  // doesn't have to say one unbroken 40-word sentence in a single breath.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const words = sentence.split(/\s+/);
      if (words.length <= 22) return sentence;

      const midpoint = Math.floor(words.length / 2);
      const breakWords = ["na", "nanso", "sɛ", "ɛno nti"];
      let breakIndex = -1;
      for (let i = midpoint; i < words.length; i += 1) {
        if (breakWords.includes(words[i].toLowerCase())) {
          breakIndex = i;
          break;
        }
      }
      if (breakIndex === -1) return sentence;

      const first = words.slice(0, breakIndex).join(" ");
      const rest = words.slice(breakIndex).join(" ");
      return `${first}. ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
    })
    .join(" ");
}

function tidyPunctuation(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?])/g, "$1")
    .replace(/([.,!?])(?=\S)/g, "$1 ")
    .trim();
}

/**
 * @param {string} translatedText - raw en->tw machine translation
 * @param {{ isFirstTurn?: boolean }} opts
 */
function humanizeTwi(translatedText, opts = {}) {
  if (!translatedText || !translatedText.trim()) return translatedText;

  let text = tidyPunctuation(translatedText);
  text = splitLongSentences(text);

  const opener = pickOpener(opts.isFirstTurn);
  if (opener && !text.startsWith(opener)) {
    text = `${opener}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
  }

  return text;
}

module.exports = { humanizeTwi };
