const express = require("express");
const router = express.Router();
const callController = require("../controllers/callController");
const { authenticateToken } = require("../middleware/auth");

// Require authentication for all call endpoints
router.use(authenticateToken);

// Get Agora token
router.post("/get-token", callController.getAgoraToken);

// Initiate a call
router.post("/initiate", callController.initiateCall);

// Accept a call
router.post("/:callId/accept", callController.acceptCall);

// Reject a call
router.post("/:callId/reject", callController.rejectCall);

// End a call
router.post("/:callId/end", callController.endCall);

// Get call history
router.get("/history", callController.getCallHistory);

// Get active call
router.get("/active", callController.getActiveCall);

module.exports = router;
