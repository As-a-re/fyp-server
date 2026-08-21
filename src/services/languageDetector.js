const franc = require("franc-min");

function detect(text) {

    const result = franc(text);

    switch (result) {

        case "aka":
            return "tw";

        case "eng":
            return "en";

        default:
            return "en";
    }
}

module.exports = detect;