// ==========================================
// AGC.AI Dashboard & Chat JavaScript Logic
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { CONFIG } from './config.js';

let auth;
let loaderInterval = null; // Loader text rotation timer

const loaderMessages = [
    "Thinking...",
    "Reading data...",
    "Processing...",
    "Analyzing...",
    "Almost ready..."
];

// Helper to append chat message easily
function appendMessage(text, sender) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`;
    msgDiv.innerText = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// YouTube Channel Data Fetching Function
async function fetchYouTubeChannelData(accessToken) {
    try {
        const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
            const channel = data.items[0];
            const channelName = channel.snippet.title;
            const channelLogo = channel.snippet.thumbnails.default.url;
            const subscriberCount = channel.statistics.subscriberCount;

            const nameElem = document.getElementById('channel-name');
            const logoElem = document.getElementById('channel-logo');

            if (nameElem) nameElem.innerText = channelName;
            if (logoElem) logoElem.src = channelLogo;

            const profileInfo = document.querySelector('.profile-info');
            if (profileInfo) {
                let subSpan = document.getElementById('subCount');
                if (!subSpan) {
                    subSpan = document.createElement('span');
                    subSpan.id = 'subCount';
                    subSpan.style.display = 'block';
                    subSpan.style.fontSize = '11px';
                    subSpan.style.color = '#58a6ff';
                    subSpan.style.marginTop = '2px';
                    profileInfo.appendChild(subSpan);
                }
                subSpan.innerText = `Subscribers: ${subscriberCount}`;
            }
        } else {
            console.warn("YouTube API returned no channel items. Token might lack youtube.readonly scope.");
        }
    } catch (error) {
        console.error("YouTube API Error:", error);
    }
}

try {
    const firebaseConfig = {
        apiKey: CONFIG.firebaseApiKey,
        authDomain: CONFIG.authDomain,
        projectId: CONFIG.projectId,
        storageBucket: CONFIG.storageBucket,
        messagingSenderId: CONFIG.messagingSenderId,
        appId: CONFIG.appId,
        measurementId: CONFIG.measurementId
    };

    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);

    // User authentication state listener
    onAuthStateChanged(auth, (user) => {
        if (user) {
            const emailElem = document.getElementById('user-email');
            const nameElem = document.getElementById('channel-name');
            const logoElem = document.getElementById('channel-logo');

            if (emailElem) emailElem.innerText = user.email || "Connected User";
            if (nameElem && user.displayName) nameElem.innerText = user.displayName;
            if (logoElem && user.photoURL) logoElem.src = user.photoURL;

            // Welcome Message with User Name
            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages && chatMessages.children.length === 0) {
                const userName = user.displayName ? user.displayName.split(' ')[0] : 'Commander';
                appendMessage(`Hi ${userName}! बताइए आज कौन सा ऑटोमेशन या कंटेंट तैयार करना है?`, 'ai');
            }

            const token = localStorage.getItem('agc_access_token');
            if (token) {
                fetchYouTubeChannelData(token);
            } else {
                console.warn("agc_access_token is missing in localStorage. YouTube features may fail.");
            }
        } else {
            if (!window.location.href.includes('index.html')) {
                window.location.href = 'index.html';
            }
        }
    });

    // Logout Functionality
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).then(() => {
                localStorage.removeItem('agc_access_token');
                window.location.href = 'index.html';
            }).catch((error) => {
                console.error("Logout Error:", error);
            });
        });
    }

} catch (err) {
    console.error("Firebase Setup Error:", err);
}

// Sidebar toggle logic and click-outside handler
const menuToggleBtn = document.getElementById('menuToggleBtn');
const sidebar = document.getElementById('sidebar');

if (menuToggleBtn && sidebar) {
    menuToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && !menuToggleBtn.contains(e.target)) {
            sidebar.classList.remove('active');
        }
    });
}

// Direct popup login (with YouTube Scope)
const handleYouTubePopupLogin = async () => {
    try {
        const provider = new GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/youtube.readonly');
        provider.setCustomParameters({ prompt: 'select_account' });
        
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        
        if (credential && credential.accessToken) {
            localStorage.setItem('agc_access_token', credential.accessToken);
            fetchYouTubeChannelData(credential.accessToken);
            window.location.reload();
        } else {
            console.error("OAuth Access Token missing.");
        }
    } catch (error) {
        console.error("Popup Login Error:", error);
    }
};

const switchBtn = document.getElementById('switchChannelBtn');
if (switchBtn) {
    switchBtn.addEventListener('click', handleYouTubePopupLogin);
}

const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
    loginBtn.addEventListener('click', handleYouTubePopupLogin);
}

// Loader text rotation function
function startLoaderTextRotation() {
    if (loaderInterval) clearInterval(loaderInterval);
    
    let msgIndex = 0;
    
    loaderInterval = setInterval(() => {
        const textElement = document.getElementById('loader-text');
        if (!textElement) return;

        msgIndex = (msgIndex + 1) % loaderMessages.length;
        
        textElement.style.opacity = 0;
        
        setTimeout(() => {
            const el = document.getElementById('loader-text');
            if (el) {
                el.textContent = loaderMessages[msgIndex];
                el.style.opacity = 1;
            }
        }, 250);

    }, 2500);
}

// ==========================================
// AI Chat Box Logic (Google Gemini API - Free)
// ==========================================
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

if (sendChatBtn && chatInput && chatMessages) {
    const handleSendMessage = async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        appendMessage(text, 'user');
        chatInput.value = '';

        let geminiKey = localStorage.getItem('gemini_api_key');
        
        if (!geminiKey) {
            geminiKey = prompt("कृपया अपनी Google Gemini API Key दर्ज करें (यह आपके ब्राउज़र में सुरक्षित रहेगी):");
            if (geminiKey) {
                geminiKey = geminiKey.trim();
                localStorage.setItem('gemini_api_key', geminiKey);
            } else {
                appendMessage("⚠️ Google Gemini API Key न मिलने के कारण चैट प्रोसेस नहीं हो सकी।", 'ai');
                return;
            }
        }

        const loadingMsg = document.createElement('div');
        loadingMsg.className = 'ai-loader chat-inline-loader';
        loadingMsg.innerHTML = `
            <div class="ai-loader__ambient-glow"></div>
            <div class="ai-loader__main-composition">
                <div class="ai-loader__orbits-container">
                    <svg class="ai-loader__svg-ring outer-ring-svg" viewBox="0 0 200 200" aria-hidden="true">
                        <circle class="track-ring" cx="100" cy="100" r="86" />
                        <circle class="segmented-arc outer-arc" cx="100" cy="100" r="86" />
                    </svg>
                    <svg class="ai-loader__svg-ring inner-ring-svg" viewBox="0 0 200 200" aria-hidden="true">
                        <circle class="track-ring" cx="100" cy="100" r="70" />
                        <circle class="segmented-arc inner-arc" cx="100" cy="100" r="70" />
                    </svg>
                </div>
                <div class="ai-loader__inner-disc"></div>
                <div class="ai-loader__logo">
                    <img src="assets/logo.png" class="ai-logo-center" alt="AGC AI Core Logo">
                </div>
            </div>
            <div class="ai-loader__status-pill">
                <div class="ai-loader__dots" aria-hidden="true">
                    <span class="ai-loader__dot ai-loader__dot--1"></span>
                    <span class="ai-loader__dot ai-loader__dot--2"></span>
                    <span class="ai-loader__dot ai-loader__dot--3"></span>
                </div>
                <span class="ai-loader__text" id="loader-text">Thinking...</span>
            </div>
        `;
        chatMessages.appendChild(loadingMsg);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        startLoaderTextRotation();

        try {
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    system_instruction: {
                        parts: [{ text: "You are AGC.AI, an advanced automation and assistant core." }]
                    },
                    contents: [
                        {
                            role: "user",
                            parts: [{ text: text }]
                        }
                    ]
                })
            });

            const data = await response.json();
            
            if (loaderInterval) clearInterval(loaderInterval);
            if (chatMessages.contains(loadingMsg)) {
                chatMessages.removeChild(loadingMsg);
            }

            if (data.candidates && data.candidates.length > 0 && data.candidates[0].content?.parts?.length > 0) {
                const aiReply = data.candidates[0].content.parts[0].text;
                appendMessage(aiReply, 'ai');
            } else if (data.error) {
                if (data.error.code === 400 || data.error.status === "INVALID_ARGUMENT") {
                    localStorage.removeItem('gemini_api_key');
                }
                throw new Error(data.error.message || "Google Gemini API Error");
            } else {
                throw new Error("Invalid response received from Gemini API");
            }
        } catch (error) {
            console.error("AI Error:", error);
            
            if (loaderInterval) clearInterval(loaderInterval);
            if (chatMessages.contains(loadingMsg)) {
                chatMessages.removeChild(loadingMsg);
            }
            
            appendMessage(`❌ एरर: ${error.message}`, 'ai');
        }

        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    sendChatBtn.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSendMessage();
        }
    });

    // Listen for Auto-Schedule triggers from master-settings iframe
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'AUTO_TRIGGER_PROMPT') {
            chatInput.value = event.data.prompt;
            handleSendMessage();
        }
    });
}

// ==========================================
// Master Setting Modal Control Logic
// ==========================================
const openSettingsBtn = document.getElementById('openMasterSettings');
const settingsModal = document.getElementById('masterSettingsModal');
const closeSettingsBtn = document.getElementById('closeModalBtn');

if (openSettingsBtn && settingsModal) {
    openSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'flex';
    });
}

if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.style.display = 'none';
    });
}

window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
    }
});
