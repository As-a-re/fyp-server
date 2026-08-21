/**
 * Transcodes uploaded voice-message audio to WAV before it's sent to
 * GhanaNLP's ASR endpoint.
 *
 * Why this exists: GhanaNLP's speech-to-text API expects WAV audio (per
 * their own Python client's documented usage), but the audio actually
 * arriving at POST /api/twi/voice varies by platform and is never WAV:
 *   - Web: the browser's MediaRecorder records audio/webm (Opus codec).
 *   - Native (expo-audio): records .m4a (AAC) - Android's native recording
 *     APIs can't produce raw WAV/PCM at all, only compressed formats, so
 *     this can't be fixed by just changing the client's recording options.
 * Sending either of those to an endpoint expecting WAV either fails
 * outright or (worse) silently returns an empty transcript, which is what
 * previously surfaced as "Could not transcribe audio" regardless of what
 * the person actually said.
 *
 * Using ffmpeg-static instead of a system ffmpeg install keeps this
 * dependency-free for anyone setting the project up (npm install is
 * enough, no apt-get/brew/Docker required) - it bundles a prebuilt static
 * ffmpeg binary per-platform.
 */

const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const ffmpegPath = require("ffmpeg-static");

/**
 * @param {Buffer} audioBuffer - raw uploaded audio bytes, any ffmpeg-readable format
 * @param {string} sourceExt - a hint extension (without dot) for the input,
 *   e.g. "webm", "m4a", "wav" - helps ffmpeg's format probing, though it
 *   also sniffs the actual content regardless.
 * @returns {Promise<Buffer>} 16kHz mono 16-bit PCM WAV bytes
 */
async function convertToWav(audioBuffer, sourceExt = "webm") {
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const inputPath = path.join(tmpDir, `twi-voice-${id}.${sourceExt}`);
  const outputPath = path.join(tmpDir, `twi-voice-${id}.wav`);

  await fs.writeFile(inputPath, audioBuffer);

  try {
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        "-y",
        "-i", inputPath,
        "-ac", "1", // mono
        "-ar", "16000", // 16kHz, standard ASR sample rate
        "-f", "wav",
        outputPath,
      ]);

      let stderr = "";
      proc.stderr.on("data", (chunk) => { stderr += chunk; });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      });
    });

    return await fs.readFile(outputPath);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// Picks a sensible source extension from a multer-reported mimetype, so
// ffmpeg gets a useful hint even though it also sniffs actual content.
function extensionFromMimeType(mimetype) {
  if (!mimetype) return "webm";
  if (mimetype.includes("webm")) return "webm";
  if (mimetype.includes("mp4") || mimetype.includes("m4a")) return "m4a";
  if (mimetype.includes("ogg")) return "ogg";
  if (mimetype.includes("wav")) return "wav";
  if (mimetype.includes("mpeg") || mimetype.includes("mp3")) return "mp3";
  return "webm";
}

module.exports = { convertToWav, extensionFromMimeType };
