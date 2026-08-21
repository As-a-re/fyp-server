const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken, requireRole } = require("../middleware/auth");
const { sendPushNotification } = require("../services/pushService");

const router = express.Router();

// Get all doctors (for mothers to browse)
router.get("/browse", authenticateToken, async (req, res) => {
  try {
    // Get all doctors registered in the system
    const { data: doctors, error } = await supabase
      .from("users")
      .select("id, name, email, phone, created_at")
      .eq("role", "Doctor")
      .order("name", { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ doctors: doctors || [] });
  } catch (error) {
    console.error("Get doctors error:", error);
    res.status(500).json({ error: "Failed to fetch doctors" });
  }
});

// Get doctor's patients
router.get("/patients", authenticateToken, async (req, res) => {
  try {
    const doctorId = req.user.id;

    // Get all patients assigned to this doctor
    const { data: patients, error } = await supabase
      .from("users")
      .select("id, name, email, phone, created_at")
      .eq("doctor_id", doctorId)
      .eq("role", "Mother");

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ patients: patients || [] });
  } catch (error) {
    console.error("Get patients error:", error);
    res.status(500).json({ error: "Failed to fetch patients" });
  }
});

// Get patient details
router.get("/patients/:patientId", authenticateToken, async (req, res) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.user.id;

    // Verify doctor has access to this patient
    const { data: patient, error } = await supabase
      .from("users")
      .select("*, pregnancy_profiles(*)")
      .eq("id", patientId)
      .eq("doctor_id", doctorId)
      .single();

    if (error || !patient) {
      return res.status(404).json({ error: "Patient not found" });
    }

    res.json({ patient });
  } catch (error) {
    console.error("Get patient details error:", error);
    res.status(500).json({ error: "Failed to fetch patient details" });
  }
});

// Get patient health history
router.get(
  "/patients/:patientId/history",
  authenticateToken,
  async (req, res) => {
    try {
      const { patientId } = req.params;
      const doctorId = req.user.id;

      // Verify doctor has access to this patient
      const { data: patient } = await supabase
        .from("users")
        .select("doctor_id")
        .eq("id", patientId)
        .single();

      if (!patient || patient.doctor_id !== doctorId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Get health records
      const { data: healthRecords, error } = await supabase
        .from("health_records")
        .select("*")
        .eq("user_id", patientId)
        .order("recorded_at", { ascending: false })
        .limit(50);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({ healthRecords: healthRecords || [] });
    } catch (error) {
      console.error("Get patient history error:", error);
      res.status(500).json({ error: "Failed to fetch patient history" });
    }
  },
);

// Add clinical note
router.post(
  "/patients/:patientId/notes",
  authenticateToken,
  [body("note").trim().notEmpty().withMessage("Note is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { patientId } = req.params;
      const doctorId = req.user.id;
      const { note } = req.body;

      // Verify doctor has access
      const { data: patient } = await supabase
        .from("users")
        .select("doctor_id")
        .eq("id", patientId)
        .single();

      if (!patient || patient.doctor_id !== doctorId) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Add clinical note
      const { data: clinicalNote, error } = await supabase
        .from("clinical_notes")
        .insert([
          {
            user_id: patientId,
            doctor_id: doctorId,
            note,
          },
        ])
        .select();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.status(201).json({ clinicalNote: clinicalNote[0] });
    } catch (error) {
      console.error("Add note error:", error);
      res.status(500).json({ error: "Failed to add clinical note" });
    }
  },
);


// Get symptom reports awaiting/under review for this doctor.
router.get("/symptom-reviews", authenticateToken, requireRole(["Doctor"]), async (req, res) => {
  try {
    const statuses = req.query.status ? String(req.query.status).split(",") : ["pending", "under_review"];
    const { data: patients, error: patientsError } = await supabase
      .from("users")
      .select("id, name, email")
      .eq("doctor_id", req.user.id)
      .eq("role", "Mother");
    if (patientsError) return res.status(500).json({ error: patientsError.message });
    const ids = (patients || []).map(p => p.id);
    if (!ids.length) return res.json({ reviews: [] });

    const { data: symptoms, error } = await supabase
      .from("symptoms")
      .select("*")
      .in("user_id", ids)
      .in("review_status", statuses)
      .order("created_at", { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const patientMap = new Map((patients || []).map(p => [p.id, p]));
    const reviews = await Promise.all((symptoms || []).map(async item => {
      let photo_url = null;
      if (item.image_url) {
        const signed = await supabase.storage.from("symptom-images").createSignedUrl(item.image_url, 600);
        photo_url = signed.data?.signedUrl || null;
      }
      return { ...item, patient: patientMap.get(item.user_id) || null, photo_url };
    }));
    res.json({ reviews });
  } catch (error) {
    console.error("Doctor symptom review list error:", error);
    res.status(500).json({ error: "Failed to load symptom reviews" });
  }
});

// Submit clinician feedback for a symptom report belonging to this doctor.
router.patch("/symptom-reviews/:symptomId", authenticateToken, requireRole(["Doctor"]), [
  body("feedback").trim().isLength({ min: 5 }).withMessage("Clinical feedback must be at least 5 characters"),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { symptomId } = req.params;
    const feedback = req.body.feedback.trim();

    const { data: symptom, error: symptomError } = await supabase
      .from("symptoms")
      .select("id, user_id, symptom_text, review_status")
      .eq("id", symptomId)
      .single();
    if (symptomError || !symptom) return res.status(404).json({ error: "Symptom report not found" });

    const { data: patient, error: patientError } = await supabase
      .from("users")
      .select("id, name, doctor_id")
      .eq("id", symptom.user_id)
      .eq("doctor_id", req.user.id)
      .eq("role", "Mother")
      .single();
    if (patientError || !patient) return res.status(403).json({ error: "You are not assigned to this patient" });

    const { data: updated, error } = await supabase
      .from("symptoms")
      .update({
        review_status: "reviewed",
        reviewed_by: req.user.id,
        review_feedback: feedback,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", symptomId)
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from("notifications").insert({
      user_id: patient.id,
      title: "Symptom Report Reviewed",
      body: "Your clinician has reviewed your symptom report. Tap to view the feedback.",
      notification_type: "symptom_review",
      reference_id: symptomId,
      reference_type: "symptom",
      data: { screen: "symptom-checker", symptom_id: symptomId },
    });

    try {
      await sendPushNotification({
        userId: patient.id,
        title: "Symptom Report Reviewed",
        body: "Your clinician has reviewed your symptom report. Tap to view the feedback.",
        data: { type: "symptom_review", screen: "symptom-checker", symptom_id: symptomId },
      });
    } catch (pushError) {
      console.error("Push notification failed after review:", pushError.message);
    }

    res.json({ message: "Clinical review submitted", symptom: updated });
  } catch (error) {
    console.error("Submit symptom review error:", error);
    res.status(500).json({ error: "Failed to submit clinical review" });
  }
});

module.exports = router;
