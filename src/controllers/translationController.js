const translator = require("../services/ghanaTranslator");

exports.translate = async (req, res) => {

    try {

        const {
            text,
            from,
            to
        } = req.body;

        let result;

        if (from === "tw" && to === "en") {

            result = await translator.twiToEnglish(text);

        }

        else if (from === "en" && to === "tw") {

            result = await translator.englishToTwi(text);

        }

        else {

            return res.status(400).json({
                error: "Unsupported language pair"
            });

        }

        res.json(result);

    }

    catch (e) {

        res.status(500).json({
            error: e.message
        });

    }

};