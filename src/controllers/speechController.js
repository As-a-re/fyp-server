const speech = require("../services/ghanaSpeech");
const { convertToWav, extensionFromMimeType } = require("../services/audioConvert");

exports.getSpeakers = async (req, res) => {

    const speakers = await speech.speakers();

    res.json(speakers);

};

exports.tts = async (req, res) => {

    const {
        text,
        speaker,
        speaker_id,
        language = "tw"
    } = req.body;

    const audio = await speech.tts(text, speaker || speaker_id, language);

    res.setHeader("Content-Type", "audio/wav");

    res.send(audio);

};

exports.transcribe = async (req, res) => {

    try {
        const language = req.query.language || req.body.language || "tw";
        const audioFile = req.file?.buffer || req.body?.audio;

        if (!audioFile) {
            return res.status(400).json({
                error: "Audio file is required"
            });
        }

        let wavBuffer = audioFile;

        // Keep the standalone /speech/transcribe route consistent with
        // /api/twi/voice. The browser sends WebM and native sends M4A; the
        // GhanaNLP ASR service receives normalized audio from the backend.
        if (req.file?.mimetype && !req.file.mimetype.includes("wav")) {
            wavBuffer = await convertToWav(
                audioFile,
                extensionFromMimeType(req.file.mimetype),
            );
        }

        const transcription = await speech.transcribe(wavBuffer, language);

        res.json({
            success: true,
            ...transcription,
        });
    } catch (error) {
        console.error("Speech transcription error:", error);
        res.status(500).json({
            error: "Failed to transcribe audio",
            message: error.message
        });
    }

};