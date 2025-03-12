import express from "express";
import fetch from "node-fetch";
import redis from "redis";
import dotenv from "dotenv";
import cors from "cors";

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") }); // ✅ Manually load `.env`

const app = express();
const PORT = process.env.PORT || 5000;
const API_URL = "https://api-football-v1.p.rapidapi.com/v3/injuries?league=88&season=2024";
const API_KEY = process.env.RAPIDAPI_KEY;

// 🚀 Ensure REDIS_URL is set correctly
if (!process.env.REDIS_URL) {
    console.error("❌ REDIS_URL is missing in .env file!");
    process.exit(1);
}

// ✅ Create Redis client for Upstash
const redisClient = redis.createClient({
    url: process.env.REDIS_URL, // Force Upstash Redis
    password: process.env.UPSTASH_REDIS_REST_TOKEN, // Use authentication token
    socket: {
        tls: true, // Required for Upstash
        rejectUnauthorized: false
    }
});

// Handle Redis connection errors
redisClient.on("error", (err) => {
    console.error("❌ Redis Client Error:", err);
});

// Connect to Upstash Redis
(async () => {
    try {
        await redisClient.connect();
        console.log("✅ Connected to Upstash Redis!");
    } catch (err) {
        console.error("❌ Failed to connect to Upstash Redis:", err);
        process.exit(1);
    }
})();

app.use(cors()); // Allow frontend requests
app.use(express.json());

// ✅ Middleware to check Redis cache
const checkCache = async (req, res, next) => {
    try {
        const cachedData = await redisClient.get("injuryData");
        if (cachedData) {
            console.log("✅ Serving from Redis cache");
            return res.json(JSON.parse(cachedData));
        }
        next(); // Fetch fresh data if cache is empty
    } catch (err) {
        console.error("❌ Redis cache error:", err);
        next(); // Continue to API request if Redis fails
    }
};

// ✅ Fetch API data and store in Redis cache
const fetchAndCacheData = async () => {
    try {
        console.log("🔄 Fetching fresh data...");
        const response = await fetch(API_URL, {
            method: "GET",
            headers: {
                "x-rapidapi-key": API_KEY,
                "x-rapidapi-host": "api-football-v1.p.rapidapi.com"
            }
        });
        const data = await response.json();

        if (!data.response) throw new Error("Invalid API response");

        // Store in Redis with a 12-hour expiration time (43200 seconds)
        await redisClient.setEx("injuryData", 43200, JSON.stringify(data));

        return data;
    } catch (error) {
        console.error("❌ Error fetching API:", error);
        return null;
    }
};

// ✅ API Route - Check cache first, then fetch if needed
app.get("/injuries", checkCache, async (req, res) => {
    const data = await fetchAndCacheData();
    if (data) {
        res.json(data);
    } else {
        res.status(500).json({ message: "Failed to fetch data" });
    }
});

// ⏳ Refresh Redis cache every 12 hours
setInterval(fetchAndCacheData, 43200000);

app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
