const express=require("express");
const router=express.Router();
const translator=require("../services/ghanaTranslator");
const controller = require("../controllers/translationController");

router.post("/toTwi",async(req,res)=>{

const {text}=req.body;

const translated=await translator.englishToTwi(text);

res.json(translated);

});

router.post("/toEnglish",async(req,res)=>{

const {text}=req.body;

const translated=await translator.twiToEnglish(text);

res.json(translated);

});

router.post("/", controller.translate);

module.exports=router;