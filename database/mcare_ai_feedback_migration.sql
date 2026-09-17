ALTER TABLE symptoms ADD COLUMN IF NOT EXISTS ai_feedback_en TEXT;
ALTER TABLE symptoms ADD COLUMN IF NOT EXISTS ai_feedback_tw TEXT;
ALTER TABLE symptoms ADD COLUMN IF NOT EXISTS ai_audio_en TEXT;
ALTER TABLE symptoms ADD COLUMN IF NOT EXISTS ai_audio_tw TEXT;
ALTER TABLE pregnancy_profiles ADD COLUMN IF NOT EXISTS pregnancy_start_date DATE;