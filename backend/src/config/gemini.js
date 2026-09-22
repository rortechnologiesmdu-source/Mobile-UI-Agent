const { GoogleGenerativeAI } = require('@google/generative-ai');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is not set');

const genAI = new GoogleGenerativeAI(apiKey);

function getTextModel() {
  return genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
}

function getVisionModel() {
  return genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
}

module.exports = { getTextModel, getVisionModel };
