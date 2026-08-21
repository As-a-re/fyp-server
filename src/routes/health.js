const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Record health data
router.post(
  "/record",
  authenticateToken,
  [
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
    body("weight")
      .optional()
      .isFloat({ min: 50, max: 500 })
      .withMessage("Weight must be between 50-500 lbs"),
    body("oxygen_level")
      .optional()
      .isInt({ min: 70, max: 100 })
      .withMessage("Oxygen level must be between 70-100%"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        blood_pressure,
        blood_sugar,
        heart_rate,
        temperature,
        weight,
        oxygen_level,
      } = req.body;

      const { data: healthRecord, error } = await supabase
        .from("health_records")
        .insert([
          {
            user_id: req.user.id,
            blood_pressure,
            blood_sugar,
            heart_rate,
            temperature,
            weight,
            oxygen_level,
            recorded_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        return res.status(500).json({
          error: "Failed to record health data",
          details: error.message,
        });
      }

      res.status(201).json({
        message: "Health data recorded successfully",
        record: healthRecord,
      });
    } catch (error) {
      console.error("Health record error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get health history
router.get("/history", authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data: records, error } = await supabase
      .from("health_records")
      .select("*")
      .eq("user_id", req.user.id)
      .order("recorded_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch health history",
        details: error.message,
      });
    }

    // Get total count
    const { count } = await supabase
      .from("health_records")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user.id);

    res.json({
      records,
      pagination: {
        total: count,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < count,
      },
    });
  } catch (error) {
    console.error("Health history error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get latest health record with pregnancy profile
router.get("/latest", authenticateToken, async (req, res) => {
  try {
    const { data: record, error } = await supabase
      .from("health_records")
      .select("*")
      .eq("user_id", req.user.id)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 is "not found"
      return res.status(500).json({
        error: "Failed to fetch latest health record",
        details: error.message,
      });
    }

    // Get pregnancy profile
    const { data: pregnancyProfile, error: pregError } = await supabase
      .from("pregnancy_profiles")
      .select("*")
      .eq("user_id", req.user.id)
      .single();

    if (pregError && pregError.code !== "PGRST116") {
      console.warn("Pregnancy profile not found:", pregError.message);
    }

    // Combine health record with pregnancy profile data
    const combinedData = record
      ? {
          ...record,
          gestational_age: pregnancyProfile?.gestational_age || null,
          due_date: pregnancyProfile?.due_date || null,
          risk_level: pregnancyProfile?.risk_level || null,
        }
      : null;

    res.json({
      record: combinedData,
    });
  } catch (error) {
    console.error("Latest health record error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
