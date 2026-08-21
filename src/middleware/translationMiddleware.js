const translator = require("../services/ghanaTranslator");

async function translateIncoming(req, res, next) {
    try {
        const { text, language } = req.body;

        if (!text) {
            return res.status(400).json({
                error: "No text supplied."
            });
        }

        if (language === "tw") {
            const translated = await translator.twiToEnglish(text);

            req.body.originalText = text;
            req.body.text = translated.translation || translated.text || translated;
            req.body.originalLanguage = "tw";
        }

        next();

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: err.message
        });
    }
}

module.exports = translateIncoming;