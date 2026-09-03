-- M-CARE: consolidated database fixes for the current backend.
-- Run this once in the Supabase SQL editor against an EXISTING project.
-- It is idempotent (safe to re-run).
--
-- This supersedes mcare_symptom_review_migration.sql and
-- mcare_chat_media_migration.sql - running this single file covers
-- everything both of those did. Those two files are kept only for
-- historical reference; don't run them separately as well as this one
-- (harmless if you do, since every statement here is idempotent, but
-- unnecessary).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_doctor_id ON public.users(doctor_id);

ALTER TABLE public.symptoms
  ADD COLUMN IF NOT EXISTS duration TEXT,
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_feedback TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE public.symptoms DROP CONSTRAINT IF EXISTS symptoms_review_status_check;
ALTER TABLE public.symptoms
  ADD CONSTRAINT symptoms_review_status_check
  CHECK (review_status IN ('pending','under_review','reviewed'));

CREATE INDEX IF NOT EXISTS idx_symptoms_review_status ON public.symptoms(review_status);
CREATE INDEX IF NOT EXISTS idx_symptoms_user_review ON public.symptoms(user_id, review_status);

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_message_type_check
  CHECK (message_type IN ('text','medical_report','emergency','audio','video'));

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS media_url TEXT;

ALTER TABLE public.messages ALTER COLUMN message DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON public.messages(sender_id, recipient_id, created_at DESC);

-- Notifications required by clinician-review feedback.
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  notification_type VARCHAR(50) NOT NULL DEFAULT 'general',
  reference_id UUID,
  reference_type VARCHAR(50),
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Push notification device tokens. Required by
-- POST /api/notifications/register-token and services/pushService.js -
-- without this table, push registration returns a 500 and clinician-review
-- push notifications silently fail (the in-app notification above still
-- works either way, since it's created first and independently).
CREATE TABLE IF NOT EXISTS public.push_tokens (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform VARCHAR(20),
  device_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
  ON public.push_tokens(user_id, is_active);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own push tokens" ON public.push_tokens;
CREATE POLICY "Users can view own push tokens"
  ON public.push_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own push tokens" ON public.push_tokens;
CREATE POLICY "Users can insert own push tokens"
  ON public.push_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own push tokens" ON public.push_tokens;
CREATE POLICY "Users can update own push tokens"
  ON public.push_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create these two PRIVATE buckets in Supabase Storage if they do not exist:
--   symptom-images
--   chat-media
-- The backend also attempts to create them automatically on startup when
-- SUPABASE_SERVICE_ROLE_KEY has storage-admin permissions.
--
-- Storage RLS policies are intentionally NOT set up here for either
-- bucket. Every Storage read/write in this codebase (routes/ai.js,
-- routes/messages.js) goes through the backend's service-role Supabase
-- client (config/database.js), which bypasses Row Level Security
-- entirely - the frontend never talks to Supabase Storage directly, only
-- ever receives short-lived signed URLs the backend generates. A private
-- bucket with RLS enabled and no policies denies all direct access by
-- default, which is the correct, safe state for that access pattern.
--
-- If you ever add direct client-side Storage access (bypassing the
-- backend), note that symptom-images and chat-media need DIFFERENT
-- ownership policies: symptom-images is single-owner (only the patient who
-- uploaded a photo should read it - see the single-owner policies in
-- mcare_symptom_review_migration.sql for that pattern), but chat-media
-- needs BOTH the sender and the recipient of a message to be able to read
-- its attached media, which requires a policy that joins storage.objects
-- against the messages table rather than a simple folder-ownership check.
