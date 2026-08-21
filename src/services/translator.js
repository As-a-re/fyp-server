/**
 * Azure Translator Service
 * Handles translation between English and Twi languages
 */

const axios = require("axios");

const getTranslatorConfig = () => {
  const apiKey = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION;
  const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT;

  if (!apiKey || !endpoint) {
    throw new Error(
      "Missing Azure Translator configuration. Please check your environment variables: AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_ENDPOINT",
    );
  }

  return {
    apiKey,
    region,
    endpoint,
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
      "Ocp-Apim-Subscription-Region": region || "global",
      "Content-Type": "application/json",
    },
  };
};

/**
 * Translate text from source language to target language
 * @param {string} text - Text to translate
 * @param {string} from - Source language code (e.g., 'en', 'tw')
 * @param {string} to - Target language code (e.g., 'en', 'tw')
 * @returns {Promise<string>} - Translated text
 */
const translateText = async (text, from, to) => {
  try {
    const config = getTranslatorConfig();

    const response = await axios.post(
      `${config.endpoint}/translate?api-version=3.0&from=${from}&to=${to}`,
      [{ text }],
      {
        headers: config.headers,
        timeout: 10000,
      },
    );

    if (response.data && response.data[0] && response.data[0].translations) {
      return response.data[0].translations[0].text;
    }

    throw new Error("Invalid translation response");
  } catch (error) {
    console.error("Translation error:", error.message);

    // Return original text if translation fails
    console.warn("Returning original text due to translation failure");
    return text;
  }
};

/**
 * Translate English to Twi
 * @param {string} text - English text to translate
 * @returns {Promise<string>} - Twi translation
 */
const translateEnglishToTwi = async (text) => {
  return translateText(text, "en", "tw");
};

/**
 * Translate Twi to English
 * @param {string} text - Twi text to translate
 * @returns {Promise<string>} - English translation
 */
const translateTwiToEnglish = async (text) => {
  return translateText(text, "tw", "en");
};

/**
 * Detect language of text
 * @param {string} text - Text to detect language for
 * @returns {Promise<string>} - Language code (e.g., 'en', 'tw')
 */
const detectLanguage = async (text) => {
  try {
    const config = getTranslatorConfig();

    const response = await axios.post(
      `${config.endpoint}/detect?api-version=3.0`,
      [{ text }],
      {
        headers: config.headers,
        timeout: 10000,
      },
    );

    if (response.data && response.data[0] && response.data[0].language) {
      return response.data[0].language;
    }

    return "en"; // Default to English
  } catch (error) {
    console.error("Language detection error:", error.message);
    return "en"; // Default to English
  }
};

/**
 * Auto-translate text to target language based on detection
 * @param {string} text - Text to translate
 * @param {string} targetLanguage - Target language code ('en' or 'tw')
 * @returns {Promise<string>} - Translated text
 */
const autoTranslate = async (text, targetLanguage) => {
  const detectedLanguage = await detectLanguage(text);

  if (detectedLanguage === targetLanguage) {
    return text; // No translation needed
  }

  return translateText(text, detectedLanguage, targetLanguage);
};

module.exports = {
  translateText,
  translateEnglishToTwi,
  translateTwiToEnglish,
  detectLanguage,
  autoTranslate,
  getTranslatorConfig,
};
