const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const axios = require("axios");
const { getTavusConfig } = require("../config/tavus");
const { buildConversationPayloadCandidates } = require("../services/tavusOrchestrator");
const multer = require("multer");
const { sendPushNotification } = require("../services/pushService");

async function createTavusConversation(config, overrides = {}) {
  if (!config.apiKey || !config.personaId || !config.replicaId) {
    const error = new Error(
      "Tavus is not fully configured. Set TAVUS_API_KEY, TAVUS_PERSONA_ID and TAVUS_REPLICA_ID.",
    );
    error.status = 503;
    throw error;
  }

  const payload = {
    replica_id: config.replicaId,
    persona_id: config.personaId,
    conversation_name: overrides.conversation_name || "M-CARE Maternal Support Agent",
    ...(overrides.conversational_context
      ? { conversational_context: overrides.conversational_context }
      : {}),
    ...(overrides.custom_greeting ? { custom_greeting: overrides.custom_greeting } : {}),
    ...(overrides.callback_url ? { callback_url: overrides.callback_url } : {}),
  };

  try {
    return await axios.post(`${config.apiUrl}/conversations`, payload, {
      headers: config.headers,
      timeout: 30000,
      validateStatus: () => true,
    });
  } catch (error) {
    const wrapped = new Error(`Unable to reach Tavus: ${error.message}`);
    wrapped.status = 502;
    wrapped.cause = error;
    throw wrapped;
  }
}

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

// Safe Tavus connectivity diagnostic. Never returns the API key.
router.get("/tavus-status", authenticateToken, async (req, res) => {
  try {
    const config = getTavusConfig();
    const missing = [];
    if (!config.apiKey) missing.push("TAVUS_API_KEY");
    if (!config.personaId) missing.push("TAVUS_PERSONA_ID");
    if (!config.replicaId) missing.push("TAVUS_REPLICA_ID");

    if (missing.length) {
      return res.status(503).json({
        success: false,
        configured: false,
        missing,
        message: "Tavus configuration is incomplete",
      });
    }

    const response = await axios.get(`${config.apiUrl}/conversations`, {
      headers: config.headers,
      params: { limit: 1 },
      timeout: 15000,
      validateStatus: () => true,
    });

    return res.status(response.status >= 200 && response.status < 300 ? 200 : response.status).json({
      success: response.status >= 200 && response.status < 300,
      configured: true,
      tavus_http_status: response.status,
      message:
        response.status >= 200 && response.status < 300
          ? "Tavus API key is accepted and the account is reachable."
          : (response.data?.message || response.data?.error || "Tavus API rejected the credentials/request."),
      account_accessible: response.status >= 200 && response.status < 300,
    });
  } catch (error) {
    return res.status(502).json({
      success: false,
      configured: true,
      account_accessible: false,
      message: `Could not reach Tavus: ${error.message}`,
    });
  }
});

// Create AI conversation. English-only: the client should only ever reach
// this route after choosing English on the language gate screen. Twi
// conversations use POST /api/twi/message and /api/twi/voice instead.
router.post("/create-conversation", authenticateToken, async (req, res) => {
  try {
    const config = getTavusConfig();

    try {
      const response = await createTavusConversation(config);
      if (response.status < 200 || response.status >= 300) {
        const tavusDetails = response.data?.message || response.data?.error || response.data?.detail || "Tavus rejected the conversation request";
        const err = new Error(`Tavus HTTP ${response.status}: ${tavusDetails}`);
        err.status = response.status;
        err.providerResponse = response.data;
        throw err;
      }
      const conversationData = response.data;

      const { data: conversation, error } = await supabase
        .from("ai_sessions")
        .insert([
          {
            user_id: req.user.id,
            session_url: conversationData.conversation_url,
            session_id: conversationData.conversation_id,
            session_status: "active",
            started_at: new Date().toISOString(),
            language: "en",
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("Failed to save conversation:", error);
        return res.status(500).json({ error: "Failed to create conversation" });
      }

      res.status(201).json({
        message: "Conversation created successfully",
        conversation: {
          id: conversation.id,
          conversation_url: conversationData.conversation_url,
          conversation_id: conversationData.conversation_id,
          status: conversation.session_status,
          started_at: conversation.started_at,
          language: conversation.language,
        },
      });
    } catch (tavusError) {
      console.error("Tavus API error:", tavusError.message);
      const status = Number(tavusError.status || tavusError.response?.status) || 502;
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        error: "Failed to create conversation",
        status,
        details: tavusError.providerResponse?.message || tavusError.message,
        provider: tavusError.providerResponse || null,
        hint:
          status === 402
            ? "Tavus returned HTTP 402. Check Tavus account/plan/usage entitlement and API key."
            : undefined,
      });
    }
  } catch (error) {
    console.error("Create conversation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start AI assistant session (maintains backward compatibility)
router.post("/start-session", authenticateToken, async (req, res) => {
  try {
    const { data: activeSession } = await supabase
      .from("ai_sessions")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("session_status", "active")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSession) {
      return res.json({
        success: true,
        message: "Active session already exists",
        session: activeSession,
      });
    }

    const config = getTavusConfig();

    try {
      console.log(`\n🟦 [Tavus] Starting session (English)`);
      console.log(`📍 [Tavus] API URL: ${config.apiUrl}/conversations`);
      console.log(`👤 [Tavus] Persona ID: ${config.personaId}`);
      console.log(`🔄 [Tavus] Replica ID: ${config.replicaId}\n`);

      const response = await createTavusConversation(config);

      console.log(`✅ [Tavus] API Response Status: ${response.status}`);

      if (response.status < 200 || response.status >= 300) {
        const tavusDetails = response.data?.message || response.data?.error || response.data?.detail || "Tavus rejected the conversation request";
        const err = new Error(`Tavus HTTP ${response.status}: ${tavusDetails}`);
        err.status = response.status;
        err.providerResponse = response.data;
        throw err;
      }

      const sessionData = response.data;

      const { data: session, error } = await supabase
        .from("ai_sessions")
        .insert([
          {
            user_id: req.user.id,
            session_url: sessionData.conversation_url,
            session_id: sessionData.conversation_id,
            session_status: "active",
            started_at: new Date().toISOString(),
            language: "en",
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("❌ Failed to save AI session:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to save session",
        });
      }

      return res.status(201).json({
        success: true,
        message: "AI session started successfully",
        session: {
          id: session.id,
          session_url: session.session_url,
          session_id: session.session_id,
          status: session.session_status,
          started_at: session.started_at,
          language: session.language,
        },
      });
    } catch (tavusError) {
      console.error("\n❌ [Tavus] API Error occurred:");
      console.error("Error Message:", tavusError.message);

      if (tavusError.response) {
        console.error("HTTP Status:", tavusError.response.status);
        console.error("Response Data:", JSON.stringify(tavusError.response.data, null, 2));
      }

      const status = Number(tavusError.status || tavusError.response?.status) || 502;
      const providerDetails =
        tavusError.providerResponse ||
        tavusError.response?.data ||
        null;
      return res.status(status >= 400 && status < 600 ? status : 502).json({
        success: false,
        error: "Failed to create Tavus conversation",
        status,
        details:
          providerDetails?.message ||
          providerDetails?.error ||
          providerDetails?.detail ||
          tavusError.message,
        provider: providerDetails,
        hint:
          status === 402
            ? "Tavus returned HTTP 402. This is normally an account/plan/usage entitlement issue rather than a mobile-app bug. Check the Tavus Developer Portal billing/usage status and that the API key belongs to the intended account."
            : undefined,
      });
    }
  } catch (error) {
    console.error("❌ Start session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// End AI assistant session
router.post(
  "/end-session",
  authenticateToken,
  [body("session_id").notEmpty().withMessage("Session ID required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { session_id } = req.body;

      // End the remote Tavus conversation as well as the local session.
      // The old implementation only updated Supabase, leaving the Tavus room
      // active until its timeout.
      const config = getTavusConfig();
      if (config.apiKey && session_id) {
        const remote = await axios.post(
          `${config.apiUrl}/conversations/${encodeURIComponent(session_id)}/end`,
          {},
          { headers: config.headers, timeout: 15000, validateStatus: () => true },
        );
        if (remote.status >= 400 && remote.status !== 404) {
          console.warn("Tavus remote end-session rejected:", remote.status, remote.data);
        }
      }

      const { data: session, error } = await supabase
        .from("ai_sessions")
        .update({
          session_status: "ended",
          ended_at: new Date().toISOString(),
        })
        .eq("user_id", req.user.id)
        .eq("session_id", session_id)
        .eq("session_status", "active")
        .select()
        .single();

      if (error || !session) {
        return res.status(404).json({
          success: false,
          error: "Active session not found",
        });
      }

      console.log(`✅ [Tavus] Session ended: ${session_id}`);

      return res.json({
        success: true,
        message: "Session ended successfully",
        session,
      });
    } catch (error) {
      console.error("❌ End session error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  },
);

// Get session history
router.get("/sessions", authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const { data: sessions, error } = await supabase
      .from("ai_sessions")
      .select("*")
      .eq("user_id", req.user.id)
      .order("started_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch sessions",
        details: error.message,
      });
    }

    res.json({
      success: true,
      sessions,
    });
  } catch (error) {
    console.error("❌ Sessions history error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Get active session
router.get("/active-session", authenticateToken, async (req, res) => {
  try {
    const { data: session, error } = await supabase
      .from("ai_sessions")
      .select("*")
      .eq("user_id", req.user.id)
      .eq("session_status", "active")
      .single();

    if (error && error.code !== "PGRST116") {
      return res.status(500).json({
        success: false,
        error: "Failed to fetch active session",
        details: error.message,
      });
    }

    res.json({
      success: true,
      session: session || null,
    });
  } catch (error) {
    console.error("❌ Active session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Analyze and submit a symptom report for clinician review.
router.post(
  "/analyze-symptom",
  authenticateToken,
  upload.single("photo"),
  async (req, res) => {
    try {
      const symptomText = String(req.body.symptom_text || "").trim();
      const duration = String(req.body.duration || "").trim();
      const rawSeverity = String(req.body.severity_level || "Medium");
      const severityMap = { Mild: "Low", Moderate: "Medium", Severe: "High" };
      const severityLevel = severityMap[rawSeverity] || rawSeverity;

      if (symptomText.length < 5) {
        return res.status(400).json({ error: "Symptom description must be at least 5 characters" });
      }
      if (!duration) {
        return res.status(400).json({ error: "Duration is required" });
      }
      if (!["Low", "Medium", "High"].includes(severityLevel)) {
        return res.status(400).json({ error: "Invalid severity level" });
      }

      const { data: symptom, error } = await supabase
        .from("symptoms")
        .insert([{
          user_id: req.user.id,
          symptom_text: symptomText,
          duration,
          severity_level: severityLevel,
          review_status: "pending",
          created_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) {
        return res.status(500).json({ error: "Failed to save symptom report", details: error.message });
      }

      let storedImagePath = null;
      if (req.file) {
        const extension = req.file.mimetype === "image/png" ? "png" : req.file.mimetype === "image/webp" ? "webp" : "jpg";
        storedImagePath = `${req.user.id}/${symptom.id}/photo.${extension}`;
        const { error: uploadError } = await supabase.storage
          .from("symptom-images")
          .upload(storedImagePath, req.file.buffer, {
            contentType: req.file.mimetype,
            cacheControl: "3600",
            upsert: false,
          });
        if (uploadError) {
          console.error("Symptom image upload failed:", uploadError);
          await supabase.from("symptoms").delete().eq("id", symptom.id);
          return res.status(500).json({ error: "Could not store symptom photo", details: uploadError.message });
        }
        const { data: withImage, error: imageUpdateError } = await supabase
          .from("symptoms")
          .update({ image_url: storedImagePath })
          .eq("id", symptom.id)
          .select()
          .single();
        if (imageUpdateError) {
          await supabase.storage.from("symptom-images").remove([storedImagePath]);
          await supabase.from("symptoms").delete().eq("id", symptom.id);
          return res.status(500).json({ error: "Could not link symptom photo" });
        }
        symptom.image_url = withImage.image_url;
      }

      try {
        const aiAnalysis = await analyzeSymptomWithAI(symptomText, severityLevel);
        const { data: updatedSymptom, error: updateError } = await supabase
          .from("symptoms")
          .update({
            ai_prediction: aiAnalysis.prediction,
            ai_confidence: aiAnalysis.confidence,
            ai_recommendations: aiAnalysis.recommendations,
          })
          .eq("id", symptom.id)
          .select()
          .single();

        if (updateError) throw updateError;

        return res.status(201).json({
          message: "Symptom submitted for clinician review",
          symptom: updatedSymptom,
          analysis: aiAnalysis,
        });
      } catch (aiError) {
        console.error("AI analysis error:", aiError.message);
        return res.status(201).json({
          message: "Symptom submitted for clinician review; AI analysis unavailable",
          symptom,
          warning: "AI analysis temporarily unavailable",
        });
      }
    } catch (error) {
      console.error("Symptom analysis error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  },
);

// Patient's submitted reports and clinician feedback.
router.get("/my-symptom-reviews", authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("symptoms")
      .select("id, symptom_text, duration, severity_level, ai_prediction, ai_confidence, ai_recommendations, image_url, review_status, review_feedback, reviewed_at, reviewed_by, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 50, 100));

    if (error) return res.status(500).json({ error: error.message });

    const reviews = await Promise.all((data || []).map(async (item) => {
      let photo_url = null;
      if (item.image_url) {
        const signed = await supabase.storage.from("symptom-images").createSignedUrl(item.image_url, 600);
        photo_url = signed.data?.signedUrl || null;
      }
      return { ...item, photo_url };
    }));

    res.json({ reviews });
  } catch (error) {
    console.error("Get symptom reviews error:", error);
    res.status(500).json({ error: "Failed to load symptom reviews" });
  }
});

// Helper function for symptom analysis
async function analyzeSymptomWithAI(symptomText, severityLevel) {
  const keywords = {
    headache: { risk: "Low", confidence: 0.6 },
    swelling: { risk: "Medium", confidence: 0.7 },
    pain: { risk: "Medium", confidence: 0.6 },
    dizziness: { risk: "Medium", confidence: 0.7 },
    bleeding: { risk: "High", confidence: 0.9 },
    fever: { risk: "Medium", confidence: 0.8 },
    nausea: { risk: "Low", confidence: 0.5 },
  };

  let analysis = { risk: "Low", confidence: 0.5 };

  for (const [keyword, result] of Object.entries(keywords)) {
    if (symptomText.toLowerCase().includes(keyword)) {
      analysis = result;
      break;
    }
  }

  if (severityLevel === "High") {
    analysis.confidence = Math.min(analysis.confidence + 0.2, 1.0);
    if (analysis.risk === "Low") analysis.risk = "Medium";
    if (analysis.risk === "Medium") analysis.risk = "High";
  }

  const recommendations = {
    Low: ["Monitor symptoms", "Rest and hydrate", "Contact if symptoms worsen"],
    Medium: ["Monitor closely", "Schedule doctor appointment", "Rest and avoid stress"],
    High: ["Seek immediate medical attention", "Contact emergency services", "Do not wait"],
  };

  return {
    prediction: analysis.risk,
    confidence: analysis.confidence,
    recommendations: recommendations[analysis.risk],
  };
}

module.exports = router;
