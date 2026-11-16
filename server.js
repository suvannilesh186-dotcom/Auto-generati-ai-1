const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/chat', async (req, res) => {
    // Website se aane wali API Key ko Headers se nikalna
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        return res.status(400).json({ error: 'API Key is missing' });
    }

    try {
        // Website se aane wala prompt aur messages
        const frontendData = req.body;

        // AICredits ko request bhejna
        const response = await fetch('https://api.aicredits.in/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify(frontendData)
        });

        const data = await response.json();
        
        // AI ka reply wapas website ko dena
        res.status(response.status).json(data);

    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`AGC Backend is live on port ${PORT}`);
});
