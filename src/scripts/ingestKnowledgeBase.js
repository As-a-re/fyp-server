/**
 * Ingests knowledge-base content into ml-service's TF-IDF index (see
 * ml-service/kb.py), which backs the Twi assistant's free replacement for
 * CustomGPT.ai (see services/ragService.js).
 *
 * Usage:
 *   cd backend
 *   node src/scripts/ingestKnowledgeBase.js                         # ingests kb-content/mcare-twi-pdf-kb.json
 *   node src/scripts/ingestKnowledgeBase.js path/to/other-file.json  # ingest a different file
 *   node src/scripts/ingestKnowledgeBase.js --replace                # replace the whole index instead of merging
 *
 * The content file is a JSON array of { id, content, metadata } objects -
 * see backend/kb-content/maternal-health-kb.json for the format and a
 * starter set of maternal-health content. That starter set is illustrative,
 * written to make the pipeline testable out of the box - review and expand
 * it with properly vetted clinical content before relying on it for real
 * users.
 *
 * Requires the ml-service to be running (ML_SERVICE_URL, default
 * http://localhost:8000) and, if the service has KB_INGEST_TOKEN set,
 * the same value set here as KB_INGEST_TOKEN.
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:8000";
const KB_INGEST_TOKEN = process.env.KB_INGEST_TOKEN;

async function ingestKnowledgeBase({ filePath, replace = false } = {}) {
  const resolvedPath = filePath || path.join(__dirname, "../../kb-content/mcare-twi-pdf-kb.json");
  const chunks = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));

  console.log(`Ingesting ${chunks.length} chunk(s) from ${resolvedPath} into ${ML_SERVICE_URL} ...`);

  const response = await axios.post(
    `${ML_SERVICE_URL}/kb/ingest`,
    { chunks, replace },
    {
      headers: {
        "Content-Type": "application/json",
        ...(KB_INGEST_TOKEN && { "X-Ingest-Token": KB_INGEST_TOKEN }),
      },
      timeout: 20000,
    },
  );

  console.log(`✅ Knowledge base now has ${response.data.chunk_count} chunk(s) indexed.`);
  return response.data;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const filePath = args.find((a) => !a.startsWith("--"));

  ingestKnowledgeBase({ filePath, replace }).catch((error) => {
    console.error("❌ Failed to ingest knowledge base:", error.response?.data || error.message);
    process.exitCode = 1;
  });
}

module.exports = { ingestKnowledgeBase };
