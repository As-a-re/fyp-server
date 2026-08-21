const express = require("express");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Get test results
router.get("/test-results", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: results, error } = await supabase
      .from("test_results")
      .select("*")
      .eq("user_id", userId)
      .order("test_date", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ results });
  } catch (error) {
    console.error("Get test results error:", error);
    res.status(500).json({ error: "Failed to fetch test results" });
  }
});

// Get vaccinations
router.get("/vaccinations", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: vaccinations, error } = await supabase
      .from("vaccinations")
      .select("*")
      .eq("user_id", userId)
      .order("vaccination_date", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ vaccinations });
  } catch (error) {
    console.error("Get vaccinations error:", error);
    res.status(500).json({ error: "Failed to fetch vaccinations" });
  }
});

// Record vaccination
router.post(
  "/vaccinations",
  authenticateToken,
  [
    body("vaccine_name").trim().notEmpty().withMessage("Vaccine name required"),
    body("vaccination_date").isISO8601().withMessage("Valid date required"),
    body("provider").trim().notEmpty().withMessage("Provider name required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.user.id;
      const { vaccine_name, vaccination_date, provider, batch_number, notes } =
        req.body;

      const { data: vaccination, error } = await supabase
        .from("vaccinations")
        .insert([
          {
            user_id: userId,
            vaccine_name,
            vaccination_date,
            provider,
            batch_number: batch_number || null,
            notes: notes || null,
            status: "completed",
          },
        ])
        .select();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.status(201).json({ vaccination: vaccination[0] });
    } catch (error) {
      console.error("Record vaccination error:", error);
      res.status(500).json({ error: "Failed to record vaccination" });
    }
  },
);

module.exports = router;
