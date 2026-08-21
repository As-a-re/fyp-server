const axios = require("axios");

const BASE = (process.env.GHANA_BASE_URL || "https://translation-api.ghananlp.org").replace(/\/$/, "");
const KEY = process.env.GHANA_API_KEY;
const ASR_VERSION = process.env.GHANA_ASR_VERSION || "v3";
const ASR_CONTENT_TYPE = process.env.GHANA_ASR_CONTENT_TYPE || "audio/wav";
const TIMEOUT = Number(process.env.GHANA_API_TIMEOUT_MS || 120000);

const getHeaders = (contentType = "application/json") => ({
  "Ocp-Apim-Subscription-Key": KEY,
  "Cache-Control": "no-cache",
  "Content-Type": contentType,
  Accept: "application/json, text/plain, */*",
});

const normalizeAudioBuffer = (audio) => {
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  if (ArrayBuffer.isView(audio)) {
    return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  }
  return Buffer.from(audio);
};

const parseResponseText = (data) => {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return "";

    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return data;
};

const extractTranscript = (data) => {
  const parsed = parseResponseText(data);

  if (typeof parsed === "string") return parsed.trim();
  if (!parsed || typeof parsed !== "object") return "";

  const candidates = [
    parsed.text,
    parsed.transcript,
    parsed.transcription,
    parsed.result,
    parsed.data?.text,
    parsed.data?.transcript,
    parsed.data?.transcription,
    parsed.data?.result,
    parsed.output?.text,
    parsed.output?.transcript,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    if (candidate && typeof candidate === "object") {
      const nested = extractTranscript(candidate);
      if (nested) return nested;
    }
  }

  return "";
};

class GhanaSpeech {
  async speakers() {
    if (!KEY) throw new Error("GHANA_API_KEY is not configured");

    const res = await axios.get(`${BASE}/tts/v2/speakers`, {
      headers: getHeaders(),
      timeout: TIMEOUT,
    });

    return res.data;
  }

  async tts(text, speaker = "female", language = "tw") {
    if (!KEY) throw new Error("GHANA_API_KEY is not configured");

    const res = await axios.post(
      `${BASE}/tts/v2/synthesize`,
      { text, language, speaker_id: speaker },
      {
        headers: getHeaders(),
        responseType: "arraybuffer",
        timeout: TIMEOUT,
      },
    );

    return res.data;
  }

  async transcribe(audio, language = "tw") {
    if (!KEY) throw new Error("GHANA_API_KEY is not configured");

    const audioBuffer = normalizeAudioBuffer(audio);
    if (!audioBuffer.length) throw new Error("Audio buffer is empty");

    if (!/^[a-z]{2,3}$/.test(language)) {
      throw new Error(`Invalid ASR language code: ${language}`);
    }

    // Khaya ASR v3 is the configured production endpoint for this project.
    // Override GHANA_ASR_VERSION only if your active subscription explicitly
    // provides a different endpoint version.
    const url = `${BASE}/asr/${ASR_VERSION}/transcribe?language=${encodeURIComponent(language)}`;

    console.log(`[Ghana ASR] POST ${url}`);
    console.log(`[Ghana ASR] audio bytes: ${audioBuffer.length}, content-type: ${ASR_CONTENT_TYPE}`);

    try {
      const res = await axios.post(url, audioBuffer, {
        headers: {
          ...getHeaders(ASR_CONTENT_TYPE),
          "Content-Length": audioBuffer.length,
        },
        responseType: "text",
        transformResponse: [(data) => data],
        timeout: TIMEOUT,
        validateStatus: () => true,
      });

      const responseBody = parseResponseText(res.data);
      const transcript = extractTranscript(responseBody);

      console.log(`[Ghana ASR] HTTP ${res.status}`);
      console.log(`[Ghana ASR] response type: ${typeof responseBody}`);
      console.log(`[Ghana ASR] transcript length: ${transcript.length}`);

      if (res.status < 200 || res.status >= 300) {
        const detail = typeof responseBody === "string"
          ? responseBody.slice(0, 1000)
          : JSON.stringify(responseBody).slice(0, 1000);

        const error = new Error(`GhanaNLP ASR HTTP ${res.status}: ${detail}`);
        error.status = res.status;
        error.providerResponse = responseBody;
        throw error;
      }

      // Return a normalized shape so every caller in the project can use
      // transcription.text regardless of whether GhanaNLP returned plain text
      // or a JSON object.
      return {
        text: transcript,
        raw: responseBody,
      };
    } catch (error) {
      if (error.response) {
        console.error("[Ghana ASR] request failed", {
          status: error.response.status,
          data: error.response.data,
        });
      } else {
        console.error("[Ghana ASR] request failed:", error.message);
      }
      throw error;
    }
  }
}

module.exports = new GhanaSpeech();
module.exports.extractTranscript = extractTranscript;
