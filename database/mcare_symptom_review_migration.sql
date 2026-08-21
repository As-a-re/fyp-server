-- M-CARE production migration: symptom review, private photos, notifications

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS doctor_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_doctor_id ON public.users(doctor_id);

ALTER TABLE public.symptoms ADD COLUMN IF NOT EXISTS duration TEXT;
ALTER TABLE public.symptoms ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE public.symptoms ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.symptoms ADD COLUMN IF NOT EXISTS review_feedback TEXT;
ALTER TABLE public.symptoms ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.symptoms ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.symptoms DROP CONSTRAINT IF EXISTS symptoms_review_status_check;
ALTER TABLE public.symptoms ADD CONSTRAINT symptoms_review_status_check CHECK (review_status IN ('pending','under_review','reviewed'));
CREATE INDEX IF NOT EXISTS idx_symptoms_review_status ON public.symptoms(review_status);
CREATE INDEX IF NOT EXISTS idx_symptoms_user_review ON public.symptoms(user_id,review_status);

CREATE TABLE IF NOT EXISTS public.notifications (
 id UUID DEFAULT uuid_generate_v4() PRIMARY KEY, user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 title TEXT NOT NULL, body TEXT NOT NULL, notification_type VARCHAR(50) NOT NULL DEFAULT 'general', reference_id UUID, reference_type VARCHAR(50),
 data JSONB DEFAULT '{}'::jsonb, is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW(), read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON public.notifications(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.push_tokens (
 id UUID DEFAULT uuid_generate_v4() PRIMARY KEY, user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, expo_push_token TEXT NOT NULL,
 platform VARCHAR(20), device_name TEXT, is_active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
 UNIQUE(user_id,expo_push_token)
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON public.push_tokens(user_id,is_active);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view own push tokens" ON public.push_tokens;
CREATE POLICY "Users can view own push tokens" ON public.push_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can insert own push tokens" ON public.push_tokens;
CREATE POLICY "Users can insert own push tokens" ON public.push_tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update own push tokens" ON public.push_tokens;
CREATE POLICY "Users can update own push tokens" ON public.push_tokens FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Create a PRIVATE Supabase Storage bucket named symptom-images in the dashboard.
-- Then run these Storage policies: \nDROP POLICY IF EXISTS "Patients upload own symptom images" ON storage.objects;
CREATE POLICY "Patients upload own symptom images" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id='symptom-images' AND (storage.foldername(name))[1]=auth.uid()::text);
DROP POLICY IF EXISTS "Patients view own symptom images" ON storage.objects;
CREATE POLICY "Patients view own symptom images" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='symptom-images' AND (storage.foldername(name))[1]=auth.uid()::text);
DROP POLICY IF EXISTS "Patients delete own symptom images" ON storage.objects;
CREATE POLICY "Patients delete own symptom images" ON storage.objects FOR DELETE TO authenticated USING (bucket_id='symptom-images' AND (storage.foldername(name))[1]=auth.uid()::text);
