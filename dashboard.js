// ==========================================
// AGC.AI Dashboard & Chat JavaScript Logic
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { CONFIG } from './config.js';

let auth;
let loaderInterval = null;
let currentProcessPhase = 'idle'; // 🕵️ जासूस ट्रैकर: चेक करेगा कि AI अभी क्या बना रहा है

const loaderMessages = [
    "Thinking...",
    "Reading data...",
    "Processing...",
    "Analyzing...",
    "Almost ready..."
];

function appendMessage(text, sender) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`;
    msgDiv.innerText = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

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

    onAuthStateChanged(auth, (user) => {
        if (user) {
            const emailElem = document.getElementById('user-email');
            const nameElem = document.getElementById('channel-name');
            const logoElem = document.getElementById('channel-logo');

            if (emailElem) emailElem.innerText = user.email || "Connected User";
            if (nameElem && user.displayName) nameElem.innerText = user.displayName;
            if (logoElem && user.photoURL) logoElem.src = user.photoURL;

            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages && chatMessages.children.length === 0) {
                const userName = user.displayName ? user.displayName.split(' ')[0] : 'Commander';
                appendMessage(`Hi ${userName}! बताइए आज कौन सा ऑटोमेशन या कंटेंट तैयार करना है?`, 'ai');
            }

            const token = localStorage.getItem('agc_access_token');
            if (token) fetchYouTubeChannelData(token);
        } else {
            if (!window.location.href.includes('index.html')) {
                window.location.href = 'index.html';
            }
        }
    });

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).then(() => {
                localStorage.removeItem('agc_access_token');
                window.location.href = 'index.html';
            });
        });
    }
} catch (err) {
    console.error("Firebase Setup Error:", err);
}

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
        }
    } catch (error) {
        console.error("Popup Login Error:", error);
    }
};

const switchBtn = document.getElementById('switchChannelBtn');
const loginBtn = document.getElementById('loginBtn');
if (switchBtn) switchBtn.addEventListener('click', handleYouTubePopupLogin);
if (loginBtn) loginBtn.addEventListener('click', handleYouTubePopupLogin);

function startLoaderTextRotation() {
    if (loaderInterval) clearInterval(loaderInterval);
    let msgIndex = 0;
    loaderInterval = setInterval(() => {
        const textElement = document.getElementById('loader-text');
        if (!textElement) return;
        msgIndex = (msgIndex + 1) % loaderMessages.length;
        textElement.style.opacity = '0';
        setTimeout(() => {
            if (textElement) {
                textElement.textContent = loaderMessages[msgIndex];
                textElement.style.opacity = '1';
            }
        }, 250);
    }, 2500);
}

function askForApiKey() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(5px);';

        const modal = document.createElement('div');
        modal.style.cssText = 'background:#1a1a24;padding:25px;border-radius:12px;width:320px;text-align:center;color:#fff;font-family:sans-serif;box-shadow: 0 8px 30px rgba(0,0,0,0.6);border: 1px solid #333;';

        modal.innerHTML = `
            <h3 style="margin-top:0; margin-bottom:10px; color:#58a6ff;">API Setup Required</h3>
            <p style="font-size:13px;color:#aaa;margin-bottom:20px;">Please enter your AI Gateway details (Velona, AICredits, etc.) to continue.</p>
            
            <div style="text-align:left; margin-bottom: 15px;">
                <label style="font-size:12px; color:#888; margin-bottom:5px; display:block;">Base URL</label>
                <input type="text" id="popupBaseUrl" value="https://auto-generati-ai-1.onrender.com/api/chat" style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#101018;color:#fff;box-sizing:border-box;outline:none;">
            </div>
            
            <div style="text-align:left; margin-bottom: 20px;">
                <label style="font-size:12px; color:#888; margin-bottom:5px; display:block;">API Key</label>
                <input type="password" id="popupApiKey" placeholder="sk-..." style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#101018;color:#fff;box-sizing:border-box;outline:none;">
            </div>

            <button id="saveApiBtn" style="background:#58a6ff;color:#fff;border:none;padding:12px 20px;border-radius:6px;cursor:pointer;width:100%;font-weight:bold;margin-bottom:10px;transition:0.3s;">Save Settings</button>
            <button id="cancelApiBtn" style="background:transparent;color:#aaa;border:1px solid #444;padding:10px 20px;border-radius:6px;cursor:pointer;width:100%;transition:0.3s;">Cancel</button>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        document.getElementById('saveApiBtn').addEventListener('click', () => {
            const key = document.getElementById('popupApiKey').value.trim();
            const url = document.getElementById('popupBaseUrl').value.trim();
            if (key && url) {
                localStorage.setItem('apiKey', key);
                localStorage.setItem('baseUrl', url);
                document.body.removeChild(overlay);
                resolve(true);
            } else {
                alert('कृपया Base URL और API Key दोनों दर्ज करें।');
            }
        });

        document.getElementById('cancelApiBtn').addEventListener('click', () => {
            document.body.removeChild(overlay);
            resolve(false);
        });
    });
}

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendChatBtn = document.getElementById('sendChatBtn');

if (sendChatBtn && chatInput && chatMessages) {
    const handleSendMessage = async () => {
        const text = chatInput.value.trim();
        if (!text) return;

        appendMessage(text, 'user');
        chatInput.value = '';

        let apiKey = localStorage.getItem('apiKey');
        let baseUrl = localStorage.getItem('baseUrl');
        
        if (!apiKey || !baseUrl) {
            const isSaved = await askForApiKey();
            if (!isSaved) {
                appendMessage("⚠️ API Key न मिलने के कारण जनरेशन रोक दिया गया।", 'ai');
                return;
            }
            apiKey = localStorage.getItem('apiKey');
            baseUrl = localStorage.getItem('baseUrl');
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

        const modelsToTry = ['gpt-3.5-turbo', 'gpt-4o-mini'];

        let finalResponse = null;
        let lastError = null;

        for (const model of modelsToTry) {
            for (let attempt = 1; attempt <= 2; attempt++) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 60000); 

                try {
                    const response = await fetch(baseUrl, {
                        method: 'POST',
                        signal: controller.signal,
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: [
                                { role: "system", content: "You are AGC.AI Core, an expert YouTube scriptwriter. Write complete, detailed, and highly engaging scripts with full character dialogues in HINDI." },
                                { role: "user", content: text }
                            ],
                            temperature: 0.7,
                            max_tokens: 3000
                        })
                    });

                    clearTimeout(timeoutId);
                    const data = await response.json();

                    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                        finalResponse = data.choices[0].message.content;
                        break;
                    } else if (data.error) {
                        lastError = data.error.message;
                        if (response.status === 429 || response.status === 503) {
                            await new Promise(res => setTimeout(res, 1200));
                            continue;
                        } else {
                            break; 
                        }
                    }
                } catch (err) {
                    clearTimeout(timeoutId);
                    lastError = err.message;
                    break;
                }
            }
            if (finalResponse) break; 
        }

        if (loaderInterval) clearInterval(loaderInterval);
        if (loadingMsg.parentNode) {
            loadingMsg.parentNode.removeChild(loadingMsg);
        }

        // ==========================================
        // 🕵️ जासूस कोड और टेम्परेरी स्टोरेज लॉजिक
        // ==========================================
        if (finalResponse) {
            appendMessage(finalResponse, 'ai');

            const isSplitterON = localStorage.getItem('agc_auto_split_active') === 'true';

            // फेज़ 1: अगर कहानी जनरेट हुई है और बटन ON है
            if (currentProcessPhase === 'story_generation' && isSplitterON) {
                currentProcessPhase = 'scene_splitting'; 
                
                setTimeout(() => {
                    const splitPrompt = `[AUTO_SCENE_SPLITTER]: आपने जो ऊपर कहानी जनरेट की है, उसे सीन-बाय-सीन (Scene 1, Scene 2) में तोड़ो। 
हर सीन के लिए मुझे यह 3 चीज़ें स्पष्ट HINDI में चाहिए:
1. Setting (सीन कहाँ का है)
2. Character Action & Attire (हीरो क्या कर रहा है और क्या पहना है)
3. Voiceover/Dialogue (सीन का डायलॉग)
ध्यान रहे, पूरा आउटपुट सिर्फ HINDI भाषा में हो।`;
                    
                    chatInput.value = splitPrompt;
                    const sendBtn = document.getElementById('sendChatBtn');
                    if(sendBtn) sendBtn.click(); // ऑटोमैटिक सेंड
                }, 3000); // 3 सेकंड का ब्रेक ताकि ब्राउज़र हैंग न हो
            } 
            // फेज़ 2: अगर सीन-बाय-सीन भी टूट कर आ गया है (टेंपरेरी सेव)
            else if (currentProcessPhase === 'scene_splitting') {
                currentProcessPhase = 'idle'; 
                
                const timestamp = new Date().toLocaleString();
                const projectData = {
                    time: timestamp,
                    script: finalResponse
                };
                
                // लोकल स्टोरेज में सेव 
                localStorage.setItem('agc_recent_project_' + Date.now(), JSON.stringify(projectData));
                
                // स्क्रीन पर अलर्ट
                setTimeout(() => {
                    appendMessage("✅ सीन-बाय-सीन डेटा टेम्परेरी स्टोरेज (Recent Projects) में सेव कर लिया गया है।", 'ai');
                }, 1000);
            }
            else {
                currentProcessPhase = 'idle'; // नार्मल चैट मोड
            }

        } else {
            appendMessage(`⚠️ सर्वर लोड: ${lastError || "अस्थायी रूप से सर्वर पर लोड है। कृपया दोबारा प्रयास करें।"}`, 'ai');
            currentProcessPhase = 'idle';
        }

        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    sendChatBtn.addEventListener('click', handleSendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSendMessage();
        }
    });
}

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

// ==========================================
// Event Listener for Automation Triggers
// ==========================================
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'AUTO_TRIGGER_PROMPT') {
        currentProcessPhase = 'story_generation'; // 🕵️ ट्रैक किया कि लॉन्ग स्टोरी बन रही है
        chatInput.value = event.data.prompt;
        const sendChatBtn = document.getElementById('sendChatBtn');
        if (sendChatBtn) {
            sendChatBtn.click();
        }
    }
    else if (event.data && event.data.type === 'AUTO_TRIGGER_PROMPT_SHORT') {
        currentProcessPhase = 'idle'; // 🕵️ शॉर्ट्स को स्प्लिट नहीं करेंगे
        chatInput.value = event.data.prompt;
        const sendChatBtn = document.getElementById('sendChatBtn');
        if (sendChatBtn) {
            sendChatBtn.click();
        }
    }
});
