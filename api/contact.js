// api/contact.js (for Vercel Serverless Function)

// This API key MUST be set as an Environment Variable in your Vercel Project Settings.
// It is NOT exposed to the client-side browser.
const API_KEY = process.env.GEMINI_API_KEY; // Vercel automatically exposes environment variables via process.env

export default async function handler(req, res) {
    // Only allow POST requests for the contact form
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { name, email, message } = req.body;

    // Basic validation
    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Name, email, and message fields are required.' });
    }

    // Crucial: Check if the API key is actually available
    if (!API_KEY) {
        console.error("Serverless Function Error: GEMINI_API_KEY environment variable is not set.");
        return res.status(500).json({ error: 'Server configuration error: Gemini API key missing.' });
    }

    try {
        // --- Call Gemini API from the serverless function ---
        let chatHistory = [];
        const prompt = `Categorize the following message into one of these types: "Job Inquiry", "Collaboration Opportunity", "General Feedback", "Other". Provide only the category name, without any extra text or punctuation. If unsure, choose "Other".\n\nMessage: "${message}"`;
        chatHistory.push({ role: "user", parts: [{ text: prompt }] });

        const payload = {
            contents: chatHistory,
            generationConfig: {
                responseMimeType: "text/plain", // Request plain text for categorization
            }
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

        // Implement exponential backoff for robustness in server-side calls too
        let retries = 3;
        let delay = 1000; // 1 second

        let geminiResponse;
        for (let i = 0; i < retries; i++) {
            try {
                geminiResponse = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (geminiResponse.ok) {
                    break; // Success! Exit retry loop
                } else if (geminiResponse.status === 429 && i < retries - 1) { // Too Many Requests
                    console.warn(`Backend rate limit hit, retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2; // Exponential backoff
                } else {
                    // If response is not OK and not 429, or it's the last retry
                    const errorDetails = await geminiResponse.text(); // Get full error text
                    throw new Error(`Gemini API failed with status ${geminiResponse.status}: ${errorDetails}`);
                }
            } catch (error) {
                if (i < retries - 1) {
                    console.error(`Backend fetch error: ${error.message}, retrying...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                } else {
                    throw error; // Re-throw if it's the last retry
                }
            }
        }

        if (!geminiResponse || !geminiResponse.ok) {
            // This case should ideally be caught by the loop, but as a safeguard
            throw new Error("Failed to get a successful response from Gemini API after all retries.");
        }

        const geminiResult = await geminiResponse.json();
        let category = "Uncategorized"; // Default if parsing fails
        if (geminiResult && geminiResult.candidates && geminiResult.candidates.length > 0 &&
            geminiResult.candidates[0].content && geminiResult.candidates[0].content.parts &&
            geminiResult.candidates[0].content.parts.length > 0) {
            category = geminiResult.candidates[0].content.parts[0].text.trim();
        }

        // Send a success response back to the client (your index.html)
        res.status(200).json({ message: 'Message received successfully!', category: category });

    } catch (error) {
        console.error('Backend serverless function caught an error:', error);
        // Provide a more generic error message to the client for security
        res.status(500).json({ error: `Internal server error: ${error.message}` });
    }
}
