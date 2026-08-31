const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const healthRoutes = require("./routes/health");
const predictionRoutes = require("./routes/prediction");
const aiRoutes = require("./routes/ai");
const messageRoutes = require("./routes/messages");
const appointmentRoutes = require("./routes/appointments");
const medicalRoutes = require("./routes/medical");
const doctorRoutes = require("./routes/doctor");
const callRoutes = require("./routes/calls");
const twiRoutes = require("./routes/twi");
const notificationRoutes = require("./routes/notifications");
const errorHandler = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware
app.use(helmet());
// Configure CORS
const corsOptions =
  process.env.NODE_ENV === "production"
    ? {
        origin: ["https://yourapp.com"],
        credentials: true,
      }
    : {
        // In development allow any origin by reflecting request origin.
        // This permits LAN IPs such as http://10.21.16.149:8081 used by expo web.
        origin: true,
        credentials: true,
      };

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", limiter);

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/predict", predictionRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/medical", medicalRoutes);
app.use("/api/doctor", doctorRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/twi", twiRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/translation",require("./routes/translation"));
app.use("/speech",require("./routes/speech"));
app.use(errorHandler);

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Prenatal Monitoring API is running",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Internal server error",
  });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Prenatal Monitoring API ready`);
});
