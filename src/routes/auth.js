const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const supabase = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

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
      .optional()
      .matches(/^[\d+\-\s\(\)]+$/)
      .isLength({ min: 10 })
      .withMessage("Phone must be at least 10 digits"),
    body("language")
      .optional()
      .isString()
      .withMessage("Language must be a string"),
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
      } = req.body;

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
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

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

    res.json({ user });
  } catch (error) {
    console.error("Profile error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
