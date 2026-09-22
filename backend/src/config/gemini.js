const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

// Agent 2 (vision/decisions) uses a separate key from a separate Google Cloud
// project so its free-tier quota doesn't share a pool with Agent 1's
// categorization calls — Google's free tier caps requests per (project, model).
// Falls back to the main key if a second one hasn't been set up yet.
const agent2ApiKey = process.env.GEMINI_API_KEY_AGENT2 || apiKey;

const genAI = new GoogleGenerativeAI(apiKey);
const agent2GenAI = new GoogleGenerativeAI(agent2ApiKey);

function getTextModel() {
  return genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
}

function getVisionModel() {
  return agent2GenAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
}

module.exports = { getTextModel, getVisionModel };
