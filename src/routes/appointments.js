const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Get user's appointments
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: appointments, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId)
      .order("appointment_date", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ appointments });
  } catch (error) {
    console.error("Get appointments error:", error);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

// Book appointment
router.post(
  "/",
  authenticateToken,
  [
    body("doctor_id").isUUID().withMessage("Valid doctor ID required"),
    body("appointment_date").isISO8601().withMessage("Valid date required"),
    body("reason").trim().notEmpty().withMessage("Appointment reason required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { doctor_id, appointment_date, reason } = req.body;

      const { data: appointment, error } = await supabase
        .from("appointments")
        .insert([
          {
            user_id: userId,
            doctor_id,
            appointment_date,
            reason,
            status: "scheduled",
          },
        ])
        .select();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.status(201).json({ appointment: appointment[0] });
    } catch (error) {
      console.error("Book appointment error:", error);
      res.status(500).json({ error: "Failed to book appointment" });
    }
  },
);

// Cancel appointment
router.delete("/:appointmentId", authenticateToken, async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const userId = req.user.id;

    // Verify appointment belongs to user
    const { data: appointment } = await supabase
      .from("appointments")
      .select("id")
      .eq("id", appointmentId)
      .eq("user_id", userId)
      .single();

    if (!appointment) {
      return res.status(404).json({ error: "Appointment not found" });
    }

    const { error } = await supabase
      .from("appointments")
      .delete()
      .eq("id", appointmentId);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: "Appointment cancelled" });
  } catch (error) {
    console.error("Cancel appointment error:", error);
    res.status(500).json({ error: "Failed to cancel appointment" });
  }
});

// Get doctor's appointments
router.get("/doctor/schedule", authenticateToken, async (req, res) => {
  try {
    const doctorId = req.user.id;

    const { data: appointments, error } = await supabase
      .from("appointments")
      .select("*, users(name, email)")
      .eq("doctor_id", doctorId)
      .order("appointment_date", { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ appointments });
  } catch (error) {
    console.error("Get doctor appointments error:", error);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

module.exports = router;
