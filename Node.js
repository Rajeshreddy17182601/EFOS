require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(cors());

// --- CONFIGURATION ---
// I've integrated your key here. For production, move this back to .env
const OPENROUTER_API_KEY = "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";
const JWT_SECRET = process.env.JWT_SECRET || "efos_secret_key_2026";
const MONGO_URI = process.env.MONGO_URI; 

// --- 1. DATABASE MODEL ---
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    history: [{ type: Object }] 
});
const User = mongoose.model('User', UserSchema);

// --- 2. DATABASE CONNECTION ---
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("✅ MongoDB Connected Successfully"))
        .catch(err => console.error("❌ Database Connection Error:", err));
} else {
    console.warn("⚠️ MONGO_URI missing in .env. Database features will fail.");
}

// --- 3. AUTHENTICATION MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "Access Denied: No Token Provided" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: "Invalid Token" });
        req.user = user;
        next();
    });
};

// --- 4. API ROUTES ---

app.post('/api/auth/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const newUser = new User({ username: req.body.username, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: "User Created Successfully" });
    } catch (error) {
        res.status(500).json({ error: "Registration Failed" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (!user) return res.status(400).json({ message: "User not found" });

    const validPassword = await bcrypt.compare(req.body.password, user.password);
    if (!validPassword) return res.status(400).json({ message: "Invalid Password" });

    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET);
    res.json({ token });
});

// C. Generate AI Content (Key Integrated in Headers)
app.post('/api/content/generate', authenticateToken, async (req, res) => {
    const { prompt } = req.body;

    try {
        const aiResponse = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            "model": "google/gemini-2.0-flash-001",
            "messages": [
                { "role": "system", "content": "Return ONLY a JSON: {\"img_prompt\": \"...\", \"caption\": \"...\", \"hashtags\": \"...\"}" },
                { "role": "user", "content": prompt }
            ]
        }, {
            headers: { 
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5000",
                "X-Title": "EFOS Project"
            }
        });

        // Parse clean JSON from the AI response
        const aiText = aiResponse.data.choices[0].message.content;
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        const result = JSON.parse(jsonMatch[0]);

        // Save this generation to the user's history in MongoDB
        await User.findByIdAndUpdate(req.user.id, { $push: { history: result } });

        res.json({ success: true, data: result });
    } catch (error) {
        console.error("AI Error:", error.message);
        res.status(500).json({ error: "AI Generation Failed" });
    }
});

// --- 5. START SERVER ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 EFOS Backend Live with API Integration on Port ${PORT}`));
