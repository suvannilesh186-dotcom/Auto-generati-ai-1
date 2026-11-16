const express = require('express');
const cors = require('cors');

const app = express();

// CORS एरर को खत्म करने के लिए
app.use(cors());
app.use(express.json());

// आपका मुख्य API राऊट
app.post('/api/chat', async (req, res) => {
    const { apiKey, text } = req.body;

    if (!apiKey) {
        return res.status(400).json({ error: 'API Key is missing' });
    }

    try {
        const response = await fetch('https://api.aicredits.in/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'openai/gpt-5-mini', // आपका मॉडल
                messages: [
                    { role: "system", content: "You are AGC.AI Core. Answer concisely and quickly in 2-3 sentences." },
                    { role: "user", content: text }
                ],
                temperature: 0.6,
                max_tokens: 150
            })
        });

        const data = await response.json();
        res.json(data);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`AGC Backend running on port ${PORT}`);
});
