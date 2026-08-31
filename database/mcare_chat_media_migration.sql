-- Adds audio/video message support to the existing `messages` table.
-- Run this in the Supabase SQL editor (same way as
-- mcare_symptom_review_migration.sql was run).

-- Widen the message_type check to allow audio/video, alongside the
-- existing text/medical_report/emergency types.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text', 'medical_report', 'emergency', 'audio', 'video'));

-- Where the media file lives in Supabase Storage (bucket: chat-media),
-- e.g. "<sender_id>/<message_id>/voice.m4a". NULL for text messages.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;

-- Message text is NOT NULL in the base schema, but audio/video messages
-- don't necessarily have meaningful text - relax that so the backend can
-- store a short placeholder (e.g. "[voice message]") without it being
-- semantically required. (No-op if already nullable.)
ALTER TABLE messages ALTER COLUMN message DROP NOT NULL;

-- Create a private bucket named "chat-media" in Supabase Storage
-- (Storage -> New bucket -> uncheck "Public bucket"), the same way
-- "symptom-images" was created for the symptom-report photo feature.
