const translator = require("../services/ghanaTranslator");

async function outgoing(req, res, next) {

    const oldJson = res.json;

    res.json = async function (data) {

        try {

            if (req.body.originalLanguage === "tw") {

                const translated = await translator.englishToTwi(
                    data.response || data.message || data.text
                );

                data.response = translated.translation || translated.text || translated;

            }

        } catch (e) {
            console.error(e);
        }

        oldJson.call(this, data);
    };

    next();
}

module.exports = outgoing;