const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const axios = require("axios");

const router = express.Router();

// Predict risk using ML service
router.post(
  "/risk",
  authenticateToken,
  [
    body("maternal_age")
      .optional()
      .isInt({ min: 12, max: 55 })
      .withMessage("Maternal age must be between 12-55"),
    body("gestational_age")
      .optional()
      .isInt({ min: 0, max: 42 })
      .withMessage("Gestational age must be between 0-42 weeks"),
    body("blood_pressure")
      .optional()
      .matches(/^\d{2,3}\/\d{2,3}$/)
      .withMessage("Blood pressure must be in format 120/80"),
    body("blood_sugar")
      .optional()
      .isFloat({ min: 0, max: 500 })
      .withMessage("Blood sugar must be between 0-500 mg/dL"),
    body("heart_rate")
      .optional()
      .isInt({ min: 40, max: 200 })
      .withMessage("Heart rate must be between 40-200 bpm"),
    body("temperature")
      .optional()
      .isFloat({ min: 95, max: 105 })
      .withMessage("Temperature must be between 95-105°F"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        maternal_age,
        gestational_age,
        blood_pressure,
        blood_sugar,
        heart_rate,
        temperature,
      } = req.body;

      // Get user's pregnancy profile if age not provided
      let userProfile = {};
      if (!maternal_age || !gestational_age) {
        const { data: profile } = await supabase
          .from("pregnancy_profiles")
          .select("gestational_age")
          .eq("user_id", req.user.id)
          .single();

        if (profile) {
          userProfile.gestational_age = profile.gestational_age;
        }
      }

      // Get latest health records if not provided
      let latestHealthData = {};
      if (!blood_pressure || !blood_sugar || !heart_rate || !temperature) {
        const { data: healthRecord } = await supabase
          .from("health_records")
          .select("blood_pressure, blood_sugar, heart_rate, temperature")
          .eq("user_id", req.user.id)
          .order("recorded_at", { ascending: false })
          .limit(1)
          .single();

        if (healthRecord) {
          latestHealthData = healthRecord;
        }
      }

      // Prepare data for ML service
      const mlData = {
        user_id: req.user.id,
        maternal_age: maternal_age || null,
        gestational_age: gestational_age || userProfile.gestational_age || null,
        blood_pressure:
          blood_pressure || latestHealthData.blood_pressure || null,
        blood_sugar: blood_sugar || latestHealthData.blood_sugar || null,
        heart_rate: heart_rate || latestHealthData.heart_rate || null,
        temperature: temperature || latestHealthData.temperature || null,
      };

      try {
        // Call ML service
        const mlResponse = await axios.post(
          `${process.env.ML_SERVICE_URL}/predict`,
          mlData,
          {
            timeout: 10000,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );

        const prediction = mlResponse.data;

        // Save prediction to database
        const { data: savedPrediction, error } = await supabase
          .from("ai_predictions")
          .insert([
            {
              user_id: req.user.id,
              prediction: prediction.risk,
              confidence: prediction.confidence,
              model_version: prediction.model_version || "1.0",
              created_at: new Date().toISOString(),
            },
          ])
          .select()
          .single();

        if (error) {
          console.error("Failed to save prediction:", error);
        }

        // Check if high risk and send alert
        if (prediction.risk === "High" && prediction.confidence > 0.8) {
          await sendEmergencyAlert(req.user.id, prediction);
        }

        res.json({
          prediction: {
            risk: prediction.risk,
            confidence: prediction.confidence,
            recommendations: getRecommendations(prediction.risk),
          },
          savedPrediction: savedPrediction || null,
        });
      } catch (mlError) {
        console.error("ML service error:", mlError.message);

        // Fallback prediction if ML service is unavailable
        const fallbackPrediction = generateFallbackPrediction(mlData);

        const { data: savedPrediction } = await supabase
          .from("ai_predictions")
          .insert([
            {
              user_id: req.user.id,
              prediction: fallbackPrediction.risk,
              confidence: fallbackPrediction.confidence,
              model_version: "fallback",
              created_at: new Date().toISOString(),
            },
          ])
          .select()
          .single();

        res.json({
          prediction: fallbackPrediction,
          savedPrediction,
          warning: "ML service unavailable, using fallback prediction",
        });
      }
    } catch (error) {
      console.error("Risk prediction error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get prediction history
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;

    const { data: predictions, error } = await supabase
      .from("ai_predictions")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      return res
        .status(500)
        .json({
          error: "Failed to fetch prediction history",
          details: error.message,
        });
    }

    res.json({ predictions });
  } catch (error) {
    console.error("Prediction history error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Helper functions
function getRecommendations(risk) {
  const recommendations = {
    Low: [
      "Continue regular prenatal checkups",
      "Maintain healthy diet and exercise",
      "Monitor health indicators weekly",
    ],
    Medium: [
      "Increase frequency of health monitoring",
      "Schedule additional prenatal appointments",
      "Consider consulting with healthcare provider",
      "Monitor blood pressure and blood sugar closely",
    ],
    High: [
      "Immediate medical consultation recommended",
      "Daily health monitoring required",
      "Prepare for potential early intervention",
      "Contact healthcare provider immediately",
    ],
  };

  return recommendations[risk] || recommendations["Low"];
}

function generateFallbackPrediction(data) {
  // Simple rule-based fallback prediction
  let riskScore = 0;

  if (data.blood_pressure) {
    const [systolic, diastolic] = data.blood_pressure.split("/").map(Number);
    if (systolic > 140 || diastolic > 90) riskScore += 2;
  }

  if (data.blood_sugar && data.blood_sugar > 120) riskScore += 1;
  if (data.gestational_age && data.gestational_age > 35) riskScore += 1;
  if (data.maternal_age && (data.maternal_age < 18 || data.maternal_age > 35))
    riskScore += 1;

  let risk = "Low";
  let confidence = 0.6;

  if (riskScore >= 3) {
    risk = "High";
    confidence = 0.7;
  } else if (riskScore >= 1) {
    risk = "Medium";
    confidence = 0.65;
  }

  return { risk, confidence };
}

async function sendEmergencyAlert(userId, prediction) {
  try {
    // Get user details
    const { data: user } = await supabase
      .from("users")
      .select("name, email, phone")
      .eq("id", userId)
      .single();

    // Get available doctors
    const { data: doctors } = await supabase
      .from("users")
      .select("id, email, phone")
      .eq("role", "Doctor");

    // Create emergency alert (in a real system, this would send notifications)
    console.log(
      `EMERGENCY ALERT: High risk detected for user ${user.name} (${user.email})`,
    );
    console.log(
      `Risk: ${prediction.risk}, Confidence: ${prediction.confidence}`,
    );

    // Here you would implement:
    // - Email notifications to doctors
    // - SMS alerts
    // - Push notifications
    // - Create emergency records in database
  } catch (error) {
    console.error("Failed to send emergency alert:", error);
  }
}

module.exports = router;
