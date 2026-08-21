const axios = require("axios");

const BASE_URL = process.env.TAVUS_BASE_URL;
const API_KEY = process.env.TAVUS_API_KEY;

const client = axios.create({
    baseURL: BASE_URL,
    headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
    },
    timeout: 30000
});

class TavusService {

    async chat(sessionId, message) {

        try {

            const response = await client.post("/chat", {

                sessionId,

                message

            });

            return response.data;

        } catch (err) {

            throw new Error(err.response?.data?.message || err.message);

        }

    }

}

module.exports = new TavusService();