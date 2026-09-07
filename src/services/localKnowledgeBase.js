const fs = require("fs");
const path = require("path");

const KB_PATH = path.join(__dirname, "../../kb.json");
const rawKnowledgeBase = JSON.parse(fs.readFileSync(KB_PATH, "utf8"));

// These are deliberate, reviewed substitutions for the English words that
// were mixed into the KB's Twi fields. English clinical fields remain intact.
const TWI_GLOSSARY = [
  ["emergency help", "mmoa a ɛhia ntɛm"],
  ["emergency care", "ayaresa a ɛhia ntɛm"],
  ["emergency", "tebea a ɛhia mmoa ntɛm"],
  ["pregnancy", "nyinsɛn"],
  ["pregnant", "ɔyamfo"],
  ["vomiting", "fe"],
  ["vomit", "fe"],
  ["migraine", "ti yaw a ɛyɛ den"],
  ["fainting", "ɔhwe ase"],
  ["sweating", "fifiri"],
  ["infection", "yareɛ a mmoawa de ba"],
  ["temperature", "ɔhyew"],
  ["fever", "ahotɔ"],
  ["dehydration", "nsuo a ɛsa fi nipadua mu"],
  ["confusion", "adwene mu basaa"],
  ["seizure", "nkyɛkyerɛaseɛ"],
  ["swelling", "ahon"],
  ["danger signs", "ɔhaw ho nsɛnkyerɛnne"],
  ["vaginal bleeding", "mogya a ɛfiri awo kwan mu"],
  ["movement", "akokoaa no nkɔsoɔ"],
  ["sign", "sɛnkyerɛnne"],
  ["danger", "ɔhaw"],
  ["warning signs", "kɔkɔbɔ nsɛnkyerɛnne"],
  ["maternity care", "awo ne nyinsɛn mu ayaresa"],
  ["maternity professionals", "awo ne nyinsɛn mu ayaresafoɔ"],
  ["antenatal care", "nyinsɛn mu nhwɛsoɔ"],
  ["antenatal appointment", "nyinsɛn mu nhwɛsoɔ bere"],
  ["antenatal", "nyinsɛn mu nhwɛsoɔ"],
  ["urgent assessment", "nhwɛsoɔ a ɛhia ntɛm"],
  ["medical assessment", "ayaresafoɔ nhwɛsoɔ"],
  ["professional advice", "ɔyaresafoɔ afotu"],
  ["breathing difficulty", "ahomeyɛ mu den"],
  ["shortness of breath", "ahome a ɛyɛ tia"],
  ["chest pain", "kokoam yaw"],
  ["blood pressure", "mogya nhyɛsoɔ"],
  ["headache", "ti yaw"],
  ["nausea", "fe ho nkɔm"],
  ["diarrhea", "ayamtuo"],
  ["constipation", "asukɔ"],
  ["cough", "ɔhome"],
  ["cold", "awɔw"],
  ["symptoms", "nsɛnkyerɛnne"],
  ["symptom", "sɛnkyerɛnne"],
  ["stress", "adwennwen"],
  ["vision", "aniwa hu adeɛ"],
  ["grey", "nsõ kɔkɔɔ"],
  ["normal", "ɛyɛ sɛnea ɛsɛ"],
  ["help", "mmoa"],
];

function translateTwiText(value) {
  let translated = String(value || "");
  for (const [english, twi] of TWI_GLOSSARY) {
    translated = translated.replace(
      new RegExp(`\\b${english.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "gi"),
      twi,
    );
  }
  return translated;
}

const knowledgeBase = {
  ...rawKnowledgeBase,
  entries: (rawKnowledgeBase.entries || []).map((entry) => ({
    ...entry,
    twi_questions: (entry.twi_questions || []).map(translateTwiText),
    twi_answer: translateTwiText(entry.twi_answer),
  })),
};

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function terms(value) {
  return new Set(normalize(value).split(/\s+/).filter((term) => term.length > 2));
}

function findEntry(query, translatedQuery = "") {
  const queryTerms = terms(`${query} ${translatedQuery}`);
  if (!queryTerms.size) return null;

  let best = null;
  let bestScore = 0;

  for (const entry of knowledgeBase.entries || []) {
    const searchable = [
      entry.intent,
      ...(entry.keywords || []),
      ...(entry.english_questions || []),
      ...(entry.twi_questions || []),
      ...(entry.retrieval_aliases || []),
    ].join(" ");
    const entryTerms = terms(searchable);
    const overlap = [...queryTerms].filter((term) => entryTerms.has(term)).length;
    const exactPhrase = [
      ...(entry.english_questions || []),
      ...(entry.twi_questions || []),
      ...(entry.retrieval_aliases || []),
    ].some((phrase) => normalize(query).includes(normalize(phrase)));
    const score = overlap + (exactPhrase ? 4 : 0);

    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? best : null;
}

module.exports = { findEntry };