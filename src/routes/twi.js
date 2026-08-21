const express = require("express");
const multer = require("multer");
const { body, validationResult } = require("express-validator");
const { authenticateToken } = require("../middleware/auth");
const twiAssistant = require("../services/twiAssistant");
const speech = require("../services/ghanaSpeech");
const { convertToWav, extensionFromMimeType } = require("../services/audioConvert");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Text message -> Twi reply (+ audio + avatar lip-sync data)
router.post(
  "/message",
  authenticateToken,
  [body("text").trim().isLength({ min: 1 }).withMessage("Text is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { text, is_first_turn = false, speaker = "female", with_audio = true } = req.body;
      const sessionKey = req.user?.id || req.ip;

      const result = await twiAssistant.handleMessage(text, {
        sessionKey,
        isFirstTurn: Boolean(is_first_turn),
        speaker,
        withAudio: Boolean(with_audio),
      });

      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Twi message error:", error);
      res.status(500).json({ success: false, error: "Failed to process message", details: error.message });
    }
  },
);

// Voice message: audio in -> transcript -> Twi reply (+ audio + lip-sync data)
router.post("/voice", authenticateToken, upload.single("audio"), async (req, res) => {
  try {
    const audioFile = req.file?.buffer;
    if (!audioFile) {
      return res.status(400).json({ success: false, error: "Audio file is required" });
    }

    const { is_first_turn = false, speaker = "female" } = req.body;
    const sessionKey = req.user?.id || req.ip;

    // The uploaded audio is whatever the client's recorder produced - webm/
    // Opus on web, m4a/AAC on native - but GhanaNLP's ASR API expects WAV.
    // Transcode first so transcription doesn't silently fail regardless of
    // which platform the request came from.
    let wavBuffer;
    try {
      const sourceExt = extensionFromMimeType(req.file.mimetype);
      wavBuffer = await convertToWav(audioFile, sourceExt);
    } catch (conversionError) {
      console.error("Audio conversion error:", conversionError.message);
      return res.status(422).json({
        success: false,
        error: "Could not process the recorded audio",
        details: conversionError.message,
      });
    }

    // GhanaNLP ASR is used for the raw transcription step (it understands
    // Twi phonetics far better than browser speech recognition); the mixed
    // language detection + KB + reply pipeline then runs on the transcript.
    let transcription;
    try {
      transcription = await speech.transcribe(wavBuffer, "tw");
    } catch (asrError) {
      console.error("GhanaNLP ASR error:", asrError.message);
      return res.status(asrError.status || 502).json({
        success: false,
        error: "Speech recognition service failed",
        details: asrError.message,
      });
    }

    const transcriptText = String(
      transcription?.text ||
      transcription?.transcript ||
      transcription?.transcription ||
      transcription?.result ||
      "",
    ).trim();

    if (!transcriptText) {
      console.error("GhanaNLP returned no transcript:", transcription?.raw);
      return res.status(422).json({
        success: false,
        error: "Could not transcribe audio",
        details: "The speech recognition service returned an empty transcript.",
      });
    }

    const result = await twiAssistant.handleMessage(transcriptText, {
      sessionKey,
      isFirstTurn: Boolean(is_first_turn),
      speaker,
      withAudio: true,
    });

    res.json({ success: true, transcript: transcriptText, ...result });
  } catch (error) {
    console.error("Twi voice error:", error);
    res.status(500).json({ success: false, error: "Failed to process voice message", details: error.message });
  }
});

// Synthesize speech + lip-sync for text that's already in Twi (no
// detection/KB/translation) - used for the fixed welcome greeting the
// avatar speaks when a conversation starts.
router.post(
  "/speak",
  authenticateToken,
  [body("text").trim().isLength({ min: 1 }).withMessage("Text is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { text, speaker = "female" } = req.body;
      const result = await twiAssistant.synthesize(text, { speaker });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("Twi speak error:", error);
      res.status(500).json({ success: false, error: "Failed to synthesize speech", details: error.message });
    }
  },
);

module.exports = router;
