/**
 * Free replacement for CustomGPT.ai: a small retrieval-augmented-generation
 * (RAG) pipeline built entirely on services that are genuinely free (no
 * credit card, no company-email-gated trial):
 *
 *   1. Retrieval - the Node backend sends the English query to this
 *      project's own ml-service (POST /kb/query), which does TF-IDF +
 *      cosine similarity over ingested maternal-health content. No external
 *      API, no per-request cost, no rate limit beyond your own server.
 *      See ml-service/kb.py.
 *
 *   2. Generation - the retrieved chunks + the question are sent to Groq's
 *      OpenAI-compatible chat completions API (https://api.groq.com), which
 *      has a genuinely free, no-credit-card developer tier
 *      (https://console.groq.com). This is the only external network call
 *      in the pipeline, and it's the only piece that requires an API key.
 *
 * If GROQ_API_KEY isn't set, isConfigured() reports false and twiAssistant.js
 * falls back to its own generic message rather than crashing - same
 * graceful-degradation behaviour the old CustomGPT integration had.
 */

const axios = require("axios");
const mcare = require("../config/mcarePersona");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = process.env.GROQ_API_URL || "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

const isConfigured = () => Boolean(GROQ_API_KEY);

async function retrieveChunks(query, topK = 4) {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/kb/query`,
      { text: query, top_k: topK },
      { timeout: 10000 },
    );
    return response.data?.results || [];
  } catch (error) {
    console.error("Knowledge-base retrieval error:", error.message);
    return [];
  }
}

function buildGroundedPrompt(question, chunks) {
  if (chunks.length === 0) {
    return (
      `${question}\n\n` +
      "(No matching knowledge-base excerpts were found for this question - " +
      "say clearly that you don't have that information yet rather than guessing.)"
    );
  }

  const context = chunks
    .map((chunk, i) => `[${i + 1}] ${chunk.content}`)
    .join("\n\n");

  return `Knowledge base excerpts:\n${context}\n\nQuestion: ${question}`;
}

class RagService {
  isConfigured() {
    return isConfigured();
  }

  /**
   * Ask the free knowledge-base pipeline a question in English and get back
   * a grounded English answer plus which chunks it was grounded in.
   * @param {string} prompt - English-language question
   * @param {string} sessionKey - unused here (kept for interface parity
   *   with the old CustomGPT service, which threaded conversations by
   *   session; Groq's completions endpoint is stateless per-call so this
   *   pipeline doesn't need it, but twiAssistant.js still passes it)
   */
  async ask(prompt, sessionKey = "default") {
    if (!isConfigured()) {
      throw new Error("Groq is not configured. Set GROQ_API_KEY.");
    }

    if (!prompt || !prompt.trim()) {
      return { answer: "", citations: [] };
    }

    const chunks = await retrieveChunks(prompt);
    const userContent = buildGroundedPrompt(prompt, chunks);

    const response = await axios.post(
      GROQ_API_URL,
      {
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: mcare.RAG_SYSTEM_PREFIX },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 400,
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      },
    );

    const answer = response.data?.choices?.[0]?.message?.content || "";

    return {
      answer,
      citations: chunks.map((c) => ({ id: c.id, score: c.score, metadata: c.metadata })),
      raw: response.data,
    };
  }
}

module.exports = new RagService();
