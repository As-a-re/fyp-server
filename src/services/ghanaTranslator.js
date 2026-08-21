const axios = require("axios");
const cache = require("./cache");

const BASE = process.env.GHANA_BASE_URL;
const KEY = process.env.GHANA_API_KEY;

const getHeaders = () => ({
  "Cache-Control": "no-cache",
  "Ocp-Apim-Subscription-Key": KEY,
  "Content-Type": "application/json",
});

const normalizeTranslation = (payload) => {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload?.translation) {
    return payload.translation;
  }

  if (payload?.text) {
    return payload.text;
  }

  if (payload?.data?.translation) {
    return payload.data.translation;
  }

  if (payload?.data?.text) {
    return payload.data.text;
  }

  return payload;
};

class GhanaTranslator {
  async englishToTwi(text) {
    if (!text || typeof text !== "string" || !text.trim()) {
      return "";
    }

    if (!BASE || !KEY) {
      throw new Error("Missing Ghana translation configuration");
    }

    const cacheKey = `en_tw_${text.trim().toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return { translation: cached, source: "cache" };
    }

    const response = await axios.post(
      `${BASE}/v1/translate`,
      {
        text,
        in: "en",
        out: "tw",
        lang: "tw",
        source_language: "en",
        target_language: "tw",
      },
      { headers: getHeaders() },
    );

    const translation = normalizeTranslation(response.data);
    cache.set(cacheKey, translation);

    return { translation, raw: response.data };
  }

  async twiToEnglish(text) {
    if (!text || typeof text !== "string" || !text.trim()) {
      return "";
    }

    if (!BASE || !KEY) {
      throw new Error("Missing Ghana translation configuration");
    }

    const cacheKey = `tw_en_${text.trim().toLowerCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return { translation: cached, source: "cache" };
    }

    const response = await axios.post(
      `${BASE}/v1/translate`,
      {
        text,
        in: "tw",
        out: "en",
        lang: "en",
        source_language: "tw",
        target_language: "en",
      },
      { headers: getHeaders() },
    );

    const translation = normalizeTranslation(response.data);
    cache.set(cacheKey, translation);

    return { translation, raw: response.data };
  }
}

module.exports = new GhanaTranslator();