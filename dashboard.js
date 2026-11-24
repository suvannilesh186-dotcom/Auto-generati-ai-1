// ==========================================
// AGC.AI Dashboard & Chat JavaScript Logic
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { CONFIG } from './config.js';

let auth;
let loaderInterval = null;
let currentProcessPhase = 'idle';
let activeSessionId = 'session_' + Date.now();
let currentSessionMessages = [];
let latestSplitScenesText = '';
let latestCharRefPromptsText = '';

const CHAR_REF_TOGGLE_KEY = 'agc_char_ref_prompts_active';
const FULL_CHAT_ARCHIVE_KEY = 'agc_full_chat_history_48h';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

const loaderMessages = [
    "Thinking...",
    "Reading data...",
    "Processing...",
    "Analyzing...",
    "Almost ready..."
];

function getFullChatHistoryMap() {
    try {
        const raw = localStorage.getItem(FULL_CHAT_ARCHIVE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const now = Date.now();
        const cleaned = {};

        Object.keys(parsed).forEach((key) => {
            const item = parsed[key];
            if (item && item.updatedAt && (now - item.updatedAt) <= FORTY_EIGHT_HOURS_MS) {
                cleaned[key] = item;
            }
        });

        localStorage.setItem(FULL_CHAT_ARCHIVE_KEY, JSON.stringify(cleaned));
        return cleaned;
    } catch (e) {
        console.error('48h chat read error:', e);
        return {};
    }
}

function saveFullChatTurn(sender, text, phaseTag = '') {
    if (!text) return;
    currentSessionMessages.push({
        sender,
        text,
        phase: phaseTag || currentProcessPhase,
        timestamp: new Date().toISOString()
    });

    const historyMap = getFullChatHistoryMap();
    const existing = historyMap[activeSessionId] || {};
    const transcript = currentSessionMessages
        .map((m, idx) => `[#${idx + 1} | ${m.sender.toUpperCase()} | ${m.phase}]\n${m.text}`)
        .join('\n\n------------------------------\n\n');

    historyMap[activeSessionId] = {
        ...existing,
        sessionId: activeSessionId,
        updatedAt: Date.now(),
        timeLabel: new Date().toLocaleString(),
        messages: currentSessionMessages,
        fullTranscript: transcript
    };

    try {
        localStorage.setItem(FULL_CHAT_ARCHIVE_KEY, JSON.stringify(historyMap));
        localStorage.setItem('agc_recent_project_' + activeSessionId, JSON.stringify({
            sessionId: activeSessionId,
            time: new Date().toLocaleString(),
            script: latestSplitScenesText || text,
            fullChat: transcript,
            messages: currentSessionMessages
        }));
        if (window.updateSidebarList) window.updateSidebarList();
    } catch (e) {
        console.error('48h chat save error:', e);
    }
}

function ensurePromptsNewTab() {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages || !chatMessages.parentElement) return null;

    let tabBar = document.getElementById('agcMainWorkspaceTabs');
    let promptsTabPanel = document.getElementById('agcPromptsNewTabPanel');

    if (!tabBar) {
        tabBar = document.createElement('div');
        tabBar.id = 'agcMainWorkspaceTabs';
        tabBar.style.cssText = 'display:flex;gap:8px;padding:8px 12px;background:#11131a;border-bottom:1px solid #262b3d;align-items:center;';

        const chatTabBtn = document.createElement('button');
        chatTabBtn.id = 'tabBtnChatWorkspace';
        chatTabBtn.type = 'button';
        chatTabBtn.innerText = '💬 Story & Scene Chat';
        chatTabBtn.style.cssText = 'padding:7px 14px;border-radius:8px;border:1px solid #3b82f6;background:#1d4ed8;color:#fff;font-size:12px;font-weight:600;cursor:pointer;';

        const promptsTabBtn = document.createElement('button');
        promptsTabBtn.id = 'tabBtnPromptsNewTab';
        promptsTabBtn.type = 'button';
        promptsTabBtn.innerText = '🎬 Character Ref & Video Prompts';
        promptsTabBtn.style.cssText = 'padding:7px 14px;border-radius:8px;border:1px solid #333b4f;background:#1a1f2e;color:#cbd5e1;font-size:12px;font-weight:600;cursor:pointer;';

        const switchToChat = () => {
            chatMessages.style.display = '';
            if (promptsTabPanel) promptsTabPanel.style.display = 'none';
            chatTabBtn.style.background = '#1d4ed8';
            chatTabBtn.style.borderColor = '#3b82f6';
            chatTabBtn.style.color = '#fff';
            promptsTabBtn.style.background = '#1a1f2e';
            promptsTabBtn.style.borderColor = '#333b4f';
            promptsTabBtn.style.color = '#cbd5e1';
        };

        const switchToPromptsTab = () => {
            chatMessages.style.display = 'none';
            if (promptsTabPanel) promptsTabPanel.style.display = 'block';
            promptsTabBtn.style.background = '#059669';
            promptsTabBtn.style.borderColor = '#10b981';
            promptsTabBtn.style.color = '#fff';
            chatTabBtn.style.background = '#1a1f2e';
            chatTabBtn.style.borderColor = '#333b4f';
            chatTabBtn.style.color = '#cbd5e1';
        };

        chatTabBtn.addEventListener('click', switchToChat);
        promptsTabBtn.addEventListener('click', switchToPromptsTab);

        tabBar.appendChild(chatTabBtn);
        tabBar.appendChild(promptsTabBtn);
        chatMessages.parentElement.insertBefore(tabBar, chatMessages);
    }

    if (!promptsTabPanel) {
        promptsTabPanel = document.createElement('div');
        promptsTabPanel.id = 'agcPromptsNewTabPanel';
        promptsTabPanel.style.cssText = 'display:none;flex:1;overflow-y:auto;padding:14px;background:#0d1017;color:#f1f5f9;';
        promptsTabPanel.innerHTML = `
            <div id="agcCharRefPromptList" style="margin-bottom:20px;"></div>
            <div id="agcSceneVideoPromptList"></div>
        `;
        chatMessages.parentElement.insertBefore(promptsTabPanel, chatMessages.nextSibling);
    }

    return {
        promptsTabPanel,
        charRefList: document.getElementById('agcCharRefPromptList'),
        videoPromptList: document.getElementById('agcSceneVideoPromptList'),
        openPromptsTab: () => {
            const btn = document.getElementById('tabBtnPromptsNewTab');
            if (btn) btn.click();
        }
    };
}

function createPromptCardWithCopy(titleText, bodyText, badgeColor = '#38bdf8') {
    const card = document.createElement('div');
    card.style.cssText = 'background:#151a24;border:1px solid #262f42;border-radius:10px;padding:12px;margin-bottom:12px;';

    const header = document.createElement('div');
    header.style.cssText = `font-size:12px;font-weight:700;color:${badgeColor};margin-bottom:8px;`;
    header.innerText = titleText;

    const pre = document.createElement('div');
    pre.style.cssText = 'white-space:pre-wrap;font-size:13px;line-height:1.5;color:#e2e8f0;margin-bottom:10px;';
    pre.innerText = bodyText;

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-msg-btn single-prompt-copy-btn';
    copyBtn.innerText = '📋 Copy Prompt';
    copyBtn.style.cssText = 'padding:6px 12px;border-radius:6px;border:1px solid #3b82f6;background:#1e293b;color:#fff;font-size:12px;cursor:pointer;';

    copyBtn.onclick = () => {
        navigator.clipboard.writeText(bodyText).then(() => {
            copyBtn.innerText = '✅ Copied!';
            setTimeout(() => { copyBtn.innerText = '📋 Copy Prompt'; }, 2000);
        });
    };

    card.appendChild(header);
    card.appendChild(pre);
    card.appendChild(copyBtn);
    return card;
}

function splitIntoPromptBlocks(rawText) {
    const cleaned = (rawText || '').trim();
    if (!cleaned) return [];
    const blocks = cleaned
        .split(/\n{2,}(?=(?:#+\s*|\*\*|\[?(?:CHARACTER|HERO|VILLAIN|SUPPORTING|ANIMAL|SCENE|SHOT|PROMPT|प्रॉम्प्ट|सीन|किरदार)\b|\d+[\.\)]))/i)
        .map((b) => b.trim())
        .filter(Boolean);
    return blocks.length ? blocks : [cleaned];
}

function renderPromptsIntoNewTab(sectionType, rawContent) {
    const ui = ensurePromptsNewTab();
    if (!ui) return;

    const blocks = splitIntoPromptBlocks(rawContent);
    if (sectionType === 'char_ref' && ui.charRefList) {
        ui.charRefList.innerHTML = `<h4 style="margin:0 0 10px 0;color:#60a5fa;font-size:14px;">🎭 Character-Wise Reference Photo Prompts</h4>`;
        blocks.forEach((block, idx) => {
            ui.charRefList.appendChild(
                createPromptCardWithCopy(`Character Reference Prompt #${idx + 1}`, block, '#60a5fa')
            );
        });
        ui.openPromptsTab();
    } else if (sectionType === 'scene_video' && ui.videoPromptList) {
        ui.videoPromptList.innerHTML = `<h4 style="margin:0 0 10px 0;color:#34d399;font-size:14px;">🎥 Scene-Wise Dynamic Video Prompts</h4>`;
        blocks.forEach((block, idx) => {
            ui.videoPromptList.appendChild(
                createPromptCardWithCopy(`Scene Video Prompt #${idx + 1}`, block, '#34d399')
            );
        });
        ui.openPromptsTab();
    }
}

function ensureCharacterRefMasterSettingToggle() {
    const settingsModal = document.getElementById('masterSettingsModal');
    if (!settingsModal || document.getElementById('agcCharRefToggleRow')) return;

    const currentActive = localStorage.getItem(CHAR_REF_TOGGLE_KEY) === 'true';

    const row = document.createElement('div');
    row.id = 'agcCharRefToggleRow';
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;margin-top:10px;border-radius:10px;background:#161b28;border:1px solid #2b354d;color:#fff;';

    const labelBox = document.createElement('div');
    labelBox.innerHTML = `
        <div style="font-size:13px;font-weight:700;color:#fff;">🎭 Auto Character Ref & Video Prompts</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Scene Split के बाद Character Ref व Scene Video प्रॉम्प्ट्स</div>
    `;

    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'agcCharRefToggleBtn';
    toggleBtn.type = 'button';

    const paintBtn = (isOn) => {
        toggleBtn.innerText = isOn ? 'ON' : 'OFF';
        toggleBtn.style.cssText = `min-width:64px;padding:8px 12px;border-radius:8px;border:none;font-weight:700;font-size:12px;cursor:pointer;background:${isOn ? '#10b981' : '#334155'};color:#fff;`;
    };

    paintBtn(currentActive);

    toggleBtn.addEventListener('click', () => {
        const nextState = localStorage.getItem(CHAR_REF_TOGGLE_KEY) !== 'true';
        localStorage.setItem(CHAR_REF_TOGGLE_KEY, String(nextState));
        paintBtn(nextState);
    });

    row.appendChild(labelBox);
    row.appendChild(toggleBtn);

    const targetContainer =
        settingsModal.querySelector('.master-modal-body') ||
        settingsModal.querySelector('div > div') ||
        settingsModal;

    targetContainer.appendChild(row);
}

function buildCharacterReferencePrompt(sceneSplitText) {
    return `[AUTO_CHARACTER_REF_PROMPT]: नीचे दी गई सीन-बाय-सीन स्क्रिप्ट के सभी किरदारों की श्रेणी पहचानकर (Hero / Villain / Supporting / Animal) प्रत्येक किरदार के लिए 4–5 अलग-अलग फ़ोटो के बजाय केवल **एक मुख्य रेफरेंस फ़ोटो (Single Master Reference Photo)** का प्रॉम्प्ट तैयार करें।

नियम:
- Hero / Lead: स्पष्ट, दमदार और उच्च-गुणवत्ता (sharp facial clarity, consistent look & outfit) वाली 1 रेफरेंस फ़ोटो।
- Villain / Antagonist: तीखे एक्सप्रेशन और विशिष्ट लुक/पहनावे के साथ 1 हाई-क्वालिटी रेफरेंस फ़ोटो।
- Supporting: सुसंगत लुक व कपड़ों के साथ 1 रेफरेंस फ़ोटो।
- Animal: प्रजाति/नस्ल, रंग, फर/त्वचा की बनावट और आकार स्पष्ट रखते हुए 1 रेफरेंस फ़ोटो।
- पूरा आउटपुट स्पष्ट HINDI में हो।

---
${sceneSplitText}
---`;
}

function buildDynamicSceneVideoPrompts(sceneSplitText, charRefPromptsText) {
    return `[AUTO_SCENE_VIDEO_PROMPTS]: नीचे दी गई सीन-बाय-सीन स्क्रिप्ट और कैरेक्टर रेफरेंस प्रॉम्प्ट्स के आधार पर, प्रत्येक सीन की रेफरेंस फ़ोटो से आगे का वीडियो बनाने के लिए सीन-वाइज वीडियो प्रॉम्प्ट्स तैयार करें।

नियम:
- कोई फिक्स्ड संख्या नहीं रखनी है। हर सीन की लंबाई, डायलॉग्स और एक्शन के हिसाब से AI खुद तय करे कि कितने प्रॉम्प्ट्स (जैसे 1, 2, 3, 10, 15, 20, 30 या अधिक) बनाने हैं।
- लंबे सीन या अधिक डायलॉग्स में उसी रेफरेंस फ़ोटो से आगे बढ़ाते हुए क्रमिक प्रॉम्प्ट्स बनाएं।
- हर प्रॉम्प्ट में सीन नंबर, डायलॉग/क्रम, कैरेक्टर कंसिस्टेंसी, कैमरा मूवमेंट और सिंगल एक्शन स्पष्ट HINDI में लिखें।

---
सीन स्क्रिप्ट:
${sceneSplitText}

कैरेक्टर रेफरेंस प्रॉम्प्ट्स:
${charRefPromptsText}
---`;
}

function appendMessage(text, sender, showCopyBtn = true, phaseTag = '') {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    saveFullChatTurn(sender, text, phaseTag);

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender === 'user' ? 'user-message' : 'ai-message'}`;

    const textSpan = document.createElement('div');
    textSpan.innerText = text;
    msgDiv.appendChild(textSpan);

    if (sender === 'ai' && showCopyBtn) {
        const copyBtn = document.createElement('button');
        copyBtn.innerText = '📋 Copy Script';
        copyBtn.className = 'copy-msg-btn';

        copyBtn.onclick = () => {
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.innerText = '✅ Copied!';
                setTimeout(() => { copyBtn.innerText = '📋 Copy Script'; }, 2000);
            });
        };

        msgDiv.appendChild(copyBtn);
    }

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function fetchYouTubeChannelData(accessToken) {
    try {
        const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const data = await response.json();

        if (data.items && data.items.length > 0) {
            const channel = data.items[0];
            const nameElem = document.getElementById('channel-name');
            const logoElem = document.getElementById('channel-logo');

            if (nameElem) nameElem.innerText = channel.snippet.title;
            if (logoElem) logoElem.src = channel.snippet.thumbnails.default.url;

            const profileInfo = document.querySelector('.profile-info');
            if (profileInfo) {
                let subSpan = document.getElementById('subCount');
                if (!subSpan) {
                    subSpan = document.createElement('span');
                    subSpan.id = 'subCount';
                    subSpan.style.cssText = 'display:block;font-size:11px;color:#58a6ff;margin-top:2px;';
                    profileInfo.appendChild(subSpan);
                }
                subSpan.innerText = `Subscribers: ${channel.statistics.subscriberCount}`;
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

            ensurePromptsNewTab();
            ensureCharacterRefMasterSettingToggle();
            getFullChatHistoryMap();

            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages && chatMessages.children.length === 0) {
                const userName = user.displayName ? user.displayName.split(' ')[0] : 'Commander';
                appendMessage(`Hi ${userName}! बताइए आज कौन सा ऑटोमेशन या कंटेंट तैयार करना है?`, 'ai', false, 'welcome');
            }

            const token = localStorage.getItem('agc_access_token');
            if (token) fetchYouTubeChannelData(token);
        } else if (!window.location.href.includes('index.html')) {
            window.location.href = 'index.html';
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

const openGpuLabBtn = document.getElementById('openGpuLabBtn');
if (openGpuLabBtn) {
    openGpuLabBtn.addEventListener('click', () => {
        window.location.href = 'lab1.html';
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
            <p style="font-size:13px;color:#aaa;margin-bottom:20px;">Please enter your AI Gateway details to continue.</p>
            <div style="text-align:left; margin-bottom: 15px;">
                <label style="font-size:12px; color:#888; margin-bottom:5px; display:block;">Base URL</label>
                <input type="text" id="popupBaseUrl" value="https://auto-generati-ai-1.onrender.com/api/chat" style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#101018;color:#fff;box-sizing:border-box;outline:none;">
            </div>
            <div style="text-align:left; margin-bottom: 20px;">
                <label style="font-size:12px; color:#888; margin-bottom:5px; display:block;">API Key</label>
                <input type="password" id="popupApiKey" placeholder="sk-..." style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#101018;color:#fff;box-sizing:border-box;outline:none;">
            </div>
            <button id="saveApiBtn" style="background:#58a6ff;color:#fff;border:none;padding:12px 20px;border-radius:6px;cursor:pointer;width:100%;font-weight:bold;margin-bottom:10px;">Save Settings</button>
            <button id="cancelApiBtn" style="background:transparent;color:#aaa;border:1px solid #444;padding:10px 20px;border-radius:6px;cursor:pointer;width:100%;">Cancel</button>
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

async function executePromptTurn(overrideText = '', forcedPhase = null) {
    if (!chatInput || !sendChatBtn || !chatMessages) return;

    const text = (overrideText || chatInput.value).trim();
    if (!text) return;

    const phaseWhenSent = forcedPhase || (currentProcessPhase === 'idle' ? 'story_generation' : currentProcessPhase);
    currentProcessPhase = phaseWhenSent;

    appendMessage(text, 'user', true, phaseWhenSent);
    if (!overrideText) chatInput.value = '';

    let apiKey = localStorage.getItem('apiKey');
    let baseUrl = localStorage.getItem('baseUrl');

    if (!apiKey || !baseUrl) {
        const isSaved = await askForApiKey();
        if (!isSaved) {
            appendMessage("⚠️ API Key न मिलने के कारण जनरेशन रोक दिया गया।", 'ai', true, 'error');
            currentProcessPhase = 'idle';
            return;
        }
        apiKey = localStorage.getItem('apiKey');
        baseUrl = localStorage.getItem('baseUrl');
    }

    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'ai-loader chat-inline-loader';
    loadingMsg.innerHTML = `
        <div class="ai-loader__main-composition">
            <div class="ai-loader__orbits-container">
                <svg class="ai-loader__svg-ring outer-ring-svg" viewBox="0 0 36 36">
                    <circle class="track-ring" cx="18" cy="18" r="16"></circle>
                    <circle class="outer-arc" cx="18" cy="18" r="16"></circle>
                </svg>
                <svg class="ai-loader__svg-ring inner-ring-svg" viewBox="0 0 36 36">
                    <circle class="inner-arc" cx="18" cy="18" r="11"></circle>
                </svg>
            </div>
            <div class="ai-loader__inner-disc"></div>
            <div class="ai-loader__logo">
                <img src="logo.png" alt="AI" class="ai-logo-center" onerror="this.style.display='none'">
            </div>
        </div>
        <div class="ai-loader__status-pill">
            <span class="ai-loader__text" id="loader-text">Thinking...</span>
            <div class="ai-loader__dots">
                <span class="ai-loader__dot ai-loader__dot--1"></span>
                <span class="ai-loader__dot ai-loader__dot--2"></span>
                <span class="ai-loader__dot ai-loader__dot--3"></span>
            </div>
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
                    } else { break; }
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
    if (loadingMsg.parentNode) loadingMsg.parentNode.removeChild(loadingMsg);

    if (finalResponse) {
        appendMessage(finalResponse, 'ai', true, phaseWhenSent);

        const isSplitterON = localStorage.getItem('agc_auto_split_active') === 'true';
        const isCharRefToggleON = localStorage.getItem(CHAR_REF_TOGGLE_KEY) === 'true';

        if (phaseWhenSent === 'story_generation' && isSplitterON) {
            const generatedStory = finalResponse;
            const splitPrompt = `[AUTO_SCENE_SPLITTER]: नीचे दी गई स्क्रिप्ट को Scene 1, Scene 2, Scene 3... में अलग-अलग तोड़ें:

---
${generatedStory}
---

नियम:
- एक सीन में केवल एक ही सिंगल एक्शन हो।
- हर सीन के लिए स्पष्ट HINDI में दें:
  1. Setting
  2. Character Action & Attire
  3. Voiceover/Dialogue`;

            setTimeout(() => {
                executePromptTurn(splitPrompt, 'scene_splitting');
            }, 1500);
        } else if (phaseWhenSent === 'scene_splitting') {
            latestSplitScenesText = finalResponse;
            saveFullChatTurn('system', 'Scene split saved to 48h history.', 'scene_splitting_saved');

            if (isCharRefToggleON) {
                setTimeout(() => {
                    executePromptTurn(buildCharacterReferencePrompt(latestSplitScenesText), 'character_ref_prompt');
                }, 1500);
            } else {
                currentProcessPhase = 'idle';
            }
        } else if (phaseWhenSent === 'character_ref_prompt') {
            latestCharRefPromptsText = finalResponse;
            renderPromptsIntoNewTab('char_ref', finalResponse);

            const historyMap = getFullChatHistoryMap();
            if (historyMap[activeSessionId]) {
                historyMap[activeSessionId].charRefPrompts = finalResponse;
                historyMap[activeSessionId].updatedAt = Date.now();
                localStorage.setItem(FULL_CHAT_ARCHIVE_KEY, JSON.stringify(historyMap));
            }

            if (isCharRefToggleON) {
                setTimeout(() => {
                    executePromptTurn(buildDynamicSceneVideoPrompts(latestSplitScenesText, latestCharRefPromptsText), 'scene_video_prompts');
                }, 1500);
            } else {
                currentProcessPhase = 'idle';
            }
        } else if (phaseWhenSent === 'scene_video_prompts') {
            renderPromptsIntoNewTab('scene_video', finalResponse);

            const historyMap = getFullChatHistoryMap();
            if (historyMap[activeSessionId]) {
                historyMap[activeSessionId].sceneVideoPrompts = finalResponse;
                historyMap[activeSessionId].updatedAt = Date.now();
                localStorage.setItem(FULL_CHAT_ARCHIVE_KEY, JSON.stringify(historyMap));
            }

            currentProcessPhase = 'idle';
        } else {
            currentProcessPhase = 'idle';
        }
    } else {
        appendMessage(`⚠️ सर्वर लोड: ${lastError || "अस्थायी रूप से सर्वर पर लोड है।"}`, 'ai', true, 'error');
        currentProcessPhase = 'idle';
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

if (sendChatBtn && chatInput && chatMessages) {
    sendChatBtn.addEventListener('click', () => executePromptTurn('', currentProcessPhase === 'idle' ? 'story_generation' : currentProcessPhase));
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') executePromptTurn('', currentProcessPhase === 'idle' ? 'story_generation' : currentProcessPhase);
    });
}

const openSettingsBtn = document.getElementById('openMasterSettings');
const settingsModal = document.getElementById('masterSettingsModal');
const closeSettingsBtn = document.getElementById('closeModalBtn');

if (openSettingsBtn && settingsModal) {
    openSettingsBtn.addEventListener('click', () => {
        ensureCharacterRefMasterSettingToggle();
        settingsModal.style.display = 'flex';
    });
}
if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => { settingsModal.style.display = 'none'; });
}
window.addEventListener('click', (e) => {
    if (e.target === settingsModal) { settingsModal.style.display = 'none'; }
});

window.addEventListener('message', (event) => {
    if (
        event.data &&
        (
            event.data.type === 'AUTO_TRIGGER_PROMPT' ||
            event.data.type === 'AUTO_TRIGGER_PROMPT_SHORT' ||
            event.data.type === 'AUTO_TRIGGER_PROMPT_LONG'
        )
    ) {
        activeSessionId = 'session_' + Date.now();
        currentSessionMessages = [];
        latestSplitScenesText = '';
        latestCharRefPromptsText = '';
        executePromptTurn(event.data.prompt, 'story_generation');
    }
});
