const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const crypto = require("crypto");
const { sendPasswordResetEmail } = require("../services/email");

const router = express.Router();

router.post("/forgot-password", [body("email").isEmail().withMessage("Valid email required")], async (req, res) => {
  const genericResponse = { message: "If an account exists for that email, a password reset link has been sent." };
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email")
      .eq("email", req.body.email.trim().toLowerCase())
      .maybeSingle();
    if (error || !user) return res.json(genericResponse);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const { error: updateError } = await supabase.from("users").update({
      password_reset_token: tokenHash,
      password_reset_expires_at: expiresAt,
    }).eq("id", user.id);
    if (updateError) throw updateError;

    const resetBase = process.env.PASSWORD_RESET_URL || "http://localhost:8081/reset-password";
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl: `${resetBase}?token=${rawToken}`,
    });
    return res.json(genericResponse);
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(503).json({ error: "Password reset email is temporarily unavailable. Please try again later." });
  }
});

router.post("/reset-password", [
  body("token").isHexadecimal().isLength({ min: 64, max: 64 }),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
    const { data: user, error } = await supabase.from("users").select("id, password_reset_expires_at").eq("password_reset_token", tokenHash).maybeSingle();
    if (error || !user || !user.password_reset_expires_at || new Date(user.password_reset_expires_at) < new Date()) {
      return res.status(400).json({ error: "This password reset link is invalid or has expired." });
    }
    const password = await bcrypt.hash(req.body.password, 10);
    const { error: updateError } = await supabase.from("users").update({ password, password_reset_token: null, password_reset_expires_at: null }).eq("id", user.id);
    if (updateError) throw updateError;
    return res.json({ message: "Password updated successfully. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ error: "Unable to reset password" });
  }
});

// Register endpoint
router.post(
  "/register",
  [
    body("name")
      .trim()
      .isLength({ min: 2 })
      .withMessage("Name must be at least 2 characters"),
    body("email").isEmail().withMessage("Valid email required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("role")
      .isIn(["Mother", "Doctor", "Administrator"])
      .withMessage("Invalid role"),
    body("phone")
      .optional({ values: "falsy" })
      .matches(/^[\d+\-\s\(\)]+$/)
      .isLength({ min: 10 })
      .withMessage("Phone must be at least 10 digits"),
    body("language")
      .optional()
      .isString()
      .withMessage("Language must be a string"),
    body("gestational_age")
      .optional()
      .isInt({ min: 0, max: 42 })
      .withMessage("Gestational age must be between 0 and 42 weeks"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const errorMessages = errors
          .array()
          .map((e) => e.msg)
          .join("; ");
        return res.status(400).json({ success: false, error: errorMessages });
      }

      const {
        name,
        email,
        password,
        role,
        phone,
        language = "English",
        gestational_age,
      } = req.body;

      if (role === "Mother" && !Number.isInteger(Number(gestational_age))) {
        return res.status(400).json({ error: "Gestational age is required for mothers" });
      }

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .single();

      if (existingUser) {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }

      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const { data: user, error } = await supabase
        .from("users")
        .insert([
          {
            name,
            email,
            password: hashedPassword,
            role,
            phone,
            language,
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        return res
          .status(500)
          .json({ error: "Failed to create user", details: error.message });
      }

      if (role === "Mother") {
        const weeks = Number(gestational_age);
        const pregnancyStart = new Date();
        pregnancyStart.setDate(pregnancyStart.getDate() - weeks * 7);
        const dueDate = new Date(pregnancyStart);
        dueDate.setDate(dueDate.getDate() + 280);
        const { error: pregnancyError } = await supabase
          .from("pregnancy_profiles")
          .insert({
            user_id: user.id,
            gestational_age: weeks,
            pregnancy_start_date: pregnancyStart.toISOString().split("T")[0],
            due_date: dueDate.toISOString().split("T")[0],
            created_at: new Date().toISOString(),
          });

        if (pregnancyError) {
          await supabase.from("users").delete().eq("id", user.id);
          return res.status(500).json({ error: "Failed to create pregnancy profile", details: pregnancyError.message });
        }
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN },
      );

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          language: user.language,
          phone: user.phone,
          gestational_age: role === "Mother" ? Number(gestational_age) : null,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Login endpoint
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email required"),
    body("password").notEmpty().withMessage("Password required"),
    body("role")
      .optional()
      .isIn(["mother", "doctor", "administrator", "Mother", "Doctor", "Administrator"])
      .withMessage("Invalid role"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, role: requestedRole } = req.body;

      // Find user
      const { data: user, error } = await supabase
        .from("users")
        .select("*")
        .eq("email", email)
        .single();

      if (error || !user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      if (
        requestedRole &&
        String(user.role).toLowerCase() !== String(requestedRole).toLowerCase()
      ) {
        return res.status(403).json({
          error: `This account is registered as a ${user.role}. Choose the matching login role.`,
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN },
      );

      res.json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          language: user.language,
          phone: user.phone,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// Get profile endpoint
router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, email, role, language, phone, created_at")
      .eq("id", req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { data: pregnancyProfile } = await supabase
      .from("pregnancy_profiles")
      .select("gestational_age, pregnancy_start_date, due_date, created_at")
      .eq("user_id", req.user.id)
      .maybeSingle();

    res.json({ user: { ...user, pregnancyProfile } });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
