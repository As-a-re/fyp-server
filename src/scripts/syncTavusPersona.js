/**
 * Syncs the Tavus persona (TAVUS_PERSONA_ID) with:
 *   - the shared M-CARE system prompt (config/mcarePersona.js -> IDENTITY)
 *   - the 4 clinical LLM tools from the original spec (classify_maternal_risk,
 *     trigger_emergency_escalation, interpret_lab_result, request_doctor_review)
 *   - the Raven perception/vision layer: this is what actually turns on
 *     real-time computer vision on the Tavus side (facial expressions, body
 *     language, visible symptoms/documents held up to camera) and wires the
 *     one visual tool (detect_pregnancy_symptom) from the spec to it.
 *
 * Tools and perception are PERSONA-level settings in Tavus (not per
 * conversation) - a persona is created once, usually via the dashboard, and
 * this script keeps its tool/perception config in sync with the code in
 * config/mcarePersona.js so "what vision the assistant does" lives in this
 * repo instead of only in a manually-edited dashboard screen.
 *
 * Usage:
 *   cd backend
 *   node src/scripts/syncTavusPersona.js            # applies the patch
 *   node src/scripts/syncTavusPersona.js --dry-run   # prints the patch, does not call Tavus
 *
 * Requires TAVUS_API_KEY and TAVUS_PERSONA_ID in the environment (.env).
 */

require("dotenv").config();
const axios = require("axios");
const mcare = require("../config/mcarePersona");

const TAVUS_API_KEY = process.env.TAVUS_API_KEY;
const TAVUS_API_URL = process.env.TAVUS_API_URL || "https://tavusapi.com/v2";
const TAVUS_PERSONA_ID = process.env.TAVUS_PERSONA_ID;

function buildPatchOperations() {
  // "add" (per RFC 6902) creates the path if it's missing and replaces it
  // if it already exists, so this is safe to run whether or not the
  // persona already has a /layers/llm or /layers/perception object.
  return [
    { op: "add", path: "/system_prompt", value: mcare.IDENTITY },
    { op: "add", path: "/layers/llm/tools", value: mcare.LLM_TOOLS },
    {
      op: "add",
      path: "/layers/perception",
      value: {
        perception_model: mcare.PERCEPTION_MODEL,
        visual_awareness_queries: mcare.VISUAL_AWARENESS_QUERIES,
        visual_tool_prompt: mcare.VISUAL_TOOL_PROMPT,
        visual_tools: mcare.VISUAL_TOOLS,
      },
    },
  ];
}

async function syncTavusPersona({ dryRun = false } = {}) {
  const operations = buildPatchOperations();

  if (dryRun) {
    console.log("Dry run — would PATCH persona with:");
    console.log(JSON.stringify(operations, null, 2));
    return { dryRun: true, operations };
  }

  if (!TAVUS_API_KEY || !TAVUS_PERSONA_ID) {
    throw new Error(
      "Missing TAVUS_API_KEY or TAVUS_PERSONA_ID in the environment. Set them in backend/.env first.",
    );
  }

  const response = await axios.patch(
    `${TAVUS_API_URL}/personas/${TAVUS_PERSONA_ID}`,
    operations,
    {
      headers: {
        "x-api-key": TAVUS_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    },
  );

  console.log(`✅ Tavus persona ${TAVUS_PERSONA_ID} updated (status ${response.status}).`);
  console.log(
    "   - system_prompt set to the M-CARE identity\n" +
      `   - layers.llm.tools set to ${mcare.LLM_TOOLS.length} clinical tool(s)\n` +
      `   - layers.perception enabled (${mcare.PERCEPTION_MODEL}) with ` +
      `${mcare.VISUAL_TOOLS.length} visual tool(s) and ${mcare.VISUAL_AWARENESS_QUERIES.length} awareness quer(y/ies)`,
  );

  return response.data;
}

if (require.main === module) {
  const dryRun = process.argv.includes("--dry-run");
  syncTavusPersona({ dryRun }).catch((error) => {
    console.error("❌ Failed to sync Tavus persona:", error.response?.data || error.message);
    process.exitCode = 1;
  });
}

module.exports = { syncTavusPersona, buildPatchOperations };
