-- AI-Assisted Prenatal Monitoring System Database Schema
-- Execute this in your Supabase SQL editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Mother', 'Doctor', 'Administrator')),
    language VARCHAR(50) DEFAULT 'English',
    phone VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pregnancy profiles table
CREATE TABLE IF NOT EXISTS pregnancy_profiles (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gestational_age INTEGER CHECK (gestational_age >= 0 AND gestational_age <= 42),
    due_date DATE,
    blood_type VARCHAR(10),
    risk_level VARCHAR(20) DEFAULT 'Low' CHECK (risk_level IN ('Low', 'Medium', 'High')),
    pregnancy_history TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Health records table
CREATE TABLE IF NOT EXISTS health_records (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blood_pressure VARCHAR(20), -- Format: "120/80"
    blood_sugar DECIMAL(5,2), -- mg/dL
    heart_rate INTEGER, -- bpm
    temperature DECIMAL(4,1), -- Fahrenheit
    weight DECIMAL(5,2), -- lbs
    oxygen_level INTEGER, -- percentage
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Symptom reports table
CREATE TABLE IF NOT EXISTS symptoms (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symptom_text TEXT NOT NULL,
    image_url TEXT,
    severity_level VARCHAR(20) DEFAULT 'Medium' CHECK (severity_level IN ('Low', 'Medium', 'High')),
    ai_prediction VARCHAR(20),
    ai_confidence DECIMAL(3,2),
    ai_recommendations TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI predictions table
CREATE TABLE IF NOT EXISTS ai_predictions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prediction VARCHAR(20) NOT NULL CHECK (prediction IN ('Low', 'Medium', 'High')),
    confidence DECIMAL(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    model_version VARCHAR(50) DEFAULT '1.0',
    input_data JSONB, -- Store the input features used for prediction
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- AI sessions table
CREATE TABLE IF NOT EXISTS ai_sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255) UNIQUE NOT NULL, -- Tavus session ID
    session_url TEXT NOT NULL,
    session_status VARCHAR(20) DEFAULT 'active' CHECK (session_status IN ('active', 'ended', 'expired')),
    language VARCHAR(10) DEFAULT 'en' CHECK (language IN ('en', 'tw')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'medical_report', 'emergency')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    CHECK (sender_id != recipient_id) -- Prevent sending messages to yourself
);

-- Emergency alerts table
CREATE TABLE IF NOT EXISTS emergency_alerts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'High' CHECK (severity IN ('Low', 'Medium', 'High')),
    message TEXT NOT NULL,
    prediction_id UUID REFERENCES ai_predictions(id),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE
);

-- Video/Voice calls table
CREATE TABLE IF NOT EXISTS calls (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    caller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    call_type VARCHAR(20) NOT NULL CHECK (call_type IN ('audio', 'video')),
    channel_name VARCHAR(255) NOT NULL,
    status VARCHAR(20) DEFAULT 'initiated' CHECK (status IN ('initiated', 'accepted', 'rejected', 'ended')),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    accepted_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CHECK (caller_id != recipient_id) -- Prevent calling yourself
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_pregnancy_profiles_user_id ON pregnancy_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_health_records_user_id ON health_records(user_id);
CREATE INDEX IF NOT EXISTS idx_health_records_recorded_at ON health_records(recorded_at);
CREATE INDEX IF NOT EXISTS idx_symptoms_user_id ON symptoms(user_id);
CREATE INDEX IF NOT EXISTS idx_symptoms_created_at ON symptoms(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_user_id ON ai_predictions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_created_at ON ai_predictions(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_user_id ON ai_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_sessions_status ON ai_sessions(session_status);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_read_at ON messages(read_at);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_user_id ON emergency_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_emergency_alerts_status ON emergency_alerts(status);
CREATE INDEX IF NOT EXISTS idx_calls_caller_id ON calls(caller_id);
CREATE INDEX IF NOT EXISTS idx_calls_recipient_id ON calls(recipient_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pregnancy_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE symptoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can only see their own profile, doctors can see all patients
CREATE POLICY "Users can view own profile" ON users
    FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Doctors can view all users" ON users
    FOR SELECT USING (
        auth.jwt() ->> 'role' = 'Doctor' OR 
        auth.jwt() ->> 'role' = 'Administrator'
    );

-- Pregnancy profiles
CREATE POLICY "Users can view own pregnancy profile" ON pregnancy_profiles
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own pregnancy profile" ON pregnancy_profiles
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert own pregnancy profile" ON pregnancy_profiles
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Doctors can view all pregnancy profiles" ON pregnancy_profiles
    FOR SELECT USING (
        auth.jwt() ->> 'role' = 'Doctor' OR 
        auth.jwt() ->> 'role' = 'Administrator'
    );

-- Health records
CREATE POLICY "Users can view own health records" ON health_records
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert own health records" ON health_records
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Doctors can view all health records" ON health_records
    FOR SELECT USING (
        auth.jwt() ->> 'role' = 'Doctor' OR 
        auth.jwt() ->> 'role' = 'Administrator'
    );

-- Symptoms
CREATE POLICY "Users can view own symptoms" ON symptoms
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert own symptoms" ON symptoms
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Doctors can view all symptoms" ON symptoms
    FOR SELECT USING (
        auth.jwt() ->> 'role' = 'Doctor' OR 
        auth.jwt() ->> 'role' = 'Administrator'
    );

-- AI predictions
CREATE POLICY "Users can view own predictions" ON ai_predictions
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "System can insert predictions" ON ai_predictions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Doctors can view all predictions" ON ai_predictions
    FOR SELECT USING (
        auth.jwt() ->> 'role' = 'Doctor' OR 
        auth.jwt() ->> 'role' = 'Administrator'
    );

-- AI sessions
CREATE POLICY "Users can view own sessions" ON ai_sessions
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "System can manage sessions" ON ai_sessions
    FOR ALL USING (true);

-- Messages
CREATE POLICY "Users can view messages they sent or received" ON messages
    FOR SELECT USING (
        auth.uid()::text = sender_id::text OR 
        auth.uid()::text = recipient_id::text
    );

CREATE POLICY "Users can send messages" ON messages
    FOR INSERT WITH CHECK (auth.uid()::text = sender_id::text);

CREATE POLICY "Users can update read status of received messages" ON messages
    FOR UPDATE USING (auth.uid()::text = recipient_id::text);

-- Emergency alerts
CREATE POLICY "Users can view own alerts" ON emergency_alerts
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "System can manage alerts" ON emergency_alerts
    FOR ALL USING (true);

-- Calls (Video/Voice)
CREATE POLICY "Users can view their own calls" ON calls
    FOR SELECT USING (
        auth.uid()::text = caller_id::text OR 
        auth.uid()::text = recipient_id::text
    );

CREATE POLICY "Users can initiate calls" ON calls
    FOR INSERT WITH CHECK (auth.uid()::text = caller_id::text);

CREATE POLICY "Users can update their calls" ON calls
    FOR UPDATE USING (
        auth.uid()::text = caller_id::text OR 
        auth.uid()::text = recipient_id::text
    );

CREATE POLICY "Doctors can view all alerts" ON emergency_alerts
    FOR SELECT USING (
        auth.jwt() ->> 'role' = 'Doctor' OR 
        auth.jwt() ->> 'role' = 'Administrator'
    );

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pregnancy_profiles_updated_at BEFORE UPDATE ON pregnancy_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a function to get unread message count
CREATE OR REPLACE FUNCTION get_unread_message_count(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    unread_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO unread_count
    FROM messages
    WHERE recipient_id = p_user_id AND read_at IS NULL;
    
    RETURN COALESCE(unread_count, 0);
END;
$$ LANGUAGE plpgsql;

-- Create a view for conversation summaries
CREATE OR REPLACE VIEW conversation_summaries AS
SELECT DISTINCT ON (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id))
    LEAST(sender_id, recipient_id) as user1_id,
    GREATEST(sender_id, recipient_id) as user2_id,
    message,
    created_at as last_message_time,
    CASE 
        WHEN sender_id < recipient_id THEN sender_id 
        ELSE recipient_id 
    END as last_sender_id
FROM messages
ORDER BY LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at DESC;
