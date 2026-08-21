# Twi Voice / GhanaNLP ASR Fix

## What was fixed

The Twi voice endpoint was calling the legacy GhanaNLP ASR v1 endpoint:

`/asr/v1/transcribe`

The project now defaults to the current ASR v2 endpoint:

`/asr/v2/transcribe?language=tw`

The GhanaNLP Dart SDK also currently points its ASR client at `https://translation-api.ghananlp.org/asr/v2`, which is the basis for this change.

## Audio pipeline

Browser/native audio -> Express multipart upload -> FFmpeg -> 16 kHz mono WAV -> GhanaNLP ASR v2 -> normalized `{ text, raw }` response.

## Environment

Set these in `backend/.env.local`:

```env
GHANA_BASE_URL=https://translation-api.ghananlp.org
GHANA_API_KEY=YOUR_REAL_KEY
GHANA_ASR_VERSION=v2
GHANA_ASR_CONTENT_TYPE=audio/wav
GHANA_API_TIMEOUT_MS=120000
```

The API key must remain server-side.

## Run

From `backend/`:

```bash
npm install
npm run dev
```

From the Expo project root, start the web app normally.

## What to look for in the backend console

When voice is submitted, the backend should print:

```text
[Ghana ASR] POST https://translation-api.ghananlp.org/asr/v2/transcribe?language=tw
[Ghana ASR] audio bytes: <number>, content-type: audio/wav
[Ghana ASR] HTTP 200
[Ghana ASR] transcript length: <number>
```

If the provider rejects the request, the frontend now receives the provider HTTP status/details instead of the unhelpful generic `Could not transcribe audio` message.
