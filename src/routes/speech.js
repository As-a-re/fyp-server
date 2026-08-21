const express=require("express");
const router=express.Router();
const speech=require("../services/ghanaSpeech");
const controller = require("../controllers/speechController")
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

router.get("/speakers", controller.getSpeakers);

router.post("/tts", controller.tts);

router.post("/transcribe", upload.single("audio"), controller.transcribe);

module.exports=router;