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
const LAB1_STATE_KEY = 'agc_gpu_lab1_state_48h';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

const loaderMessages = [
    "Thinking...",
    "Reading data...",
    "Processing...",
    "Analyzing...",
    "Almost ready..."
];

// ==========================================
// 💾 48h Full Chat Saver & Sidebar List
// ==========================================
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

function renderSavedSessionIntoChat(sessionObj) {
    const chatBox = document.getElementById('chatMessages');
    if (!chatBox || !sessionObj || !Array.isArray(sessionObj.messages)) return;

    activeSessionId = sessionObj.sessionId || ('session_' + Date.now());
    currentSessionMessages = [...sessionObj.messages];
    chatBox.innerHTML = '';

    sessionObj.messages.forEach((m) => {
        if (!m || !m.text) return;
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${m.sender === 'user' ? 'user-message' : 'ai-message'}`;

        const textSpan = document.createElement('div');
        textSpan.innerText = m.text;
        msgDiv.appendChild(textSpan);

        if (m.sender === 'ai') {
            const copyBtn = document.createElement('button');
            copyBtn.innerText = '📋 Copy Script';
            copyBtn.className = 'copy-msg-btn';
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(m.text).then(() => {
                    copyBtn.innerText = '✅ Copied!';
                    setTimeout(() => { copyBtn.innerText = '📋 Copy Script'; }, 2000);
                });
            };
            msgDiv.appendChild(copyBtn);
        }

        chatBox.appendChild(msgDiv);
    });

    chatBox.scrollTop = chatBox.scrollHeight;
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('active');
}

function updateSidebarList() {
    const listEl = document.getElementById('recentProjectsList');
    if (!listEl) return;

    const historyMap = getFullChatHistoryMap();
    const sessions = Object.values(historyMap).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    listEl.innerHTML = '';
    if (!sessions.length) {
        const emptyLi = document.createElement('li');
        emptyLi.innerText = 'कोई सेव चैट नहीं (48h)';
        emptyLi.style.color = '#8b949e';
        emptyLi.style.cursor = 'default';
        listEl.appendChild(emptyLi);
        return;
    }

    sessions.forEach((sess) => {
        const firstUserMsg = (sess.messages || []).find((m) => m.sender === 'user');
        const preview = firstUserMsg ? firstUserMsg.text.replace(/\s+/g, ' ').slice(0, 28) : 'Saved Chat';
        const li = document.createElement('li');
        li.innerText = `${sess.timeLabel || ''} • ${preview}`;
        li.title = sess.fullTranscript || preview;
        li.addEventListener('click', () => renderSavedSessionIntoChat(sess));
        listEl.appendChild(li);
    });
}
window.updateSidebarList = updateSidebarList;

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

    const nowTs = Date.now();
    const sessionRecord = {
        ...existing,
        sessionId: activeSessionId,
        updatedAt: nowTs,
        timeLabel: existing.timeLabel || new Date().toLocaleString(),
        messages: currentSessionMessages,
        fullTranscript: transcript
    };

    historyMap[activeSessionId] = sessionRecord;

    try {
        localStorage.setItem(FULL_CHAT_ARCHIVE_KEY, JSON.stringify(historyMap));
        localStorage.setItem('agc_recent_project_' + activeSessionId, JSON.stringify({
            sessionId: activeSessionId,
            updatedAt: nowTs,
            time: sessionRecord.timeLabel,
            script: latestSplitScenesText || text,
            fullChat: transcript,
            messages: currentSessionMessages
        }));
        updateSidebarList();
    } catch (e) {
        console.error('48h chat save error:', e);
    }
}

// ==========================================
// ⚙️ Master Setting Toggle for Character Ref & Scene Video Prompts
// ==========================================
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

// ==========================================
// 📝 Prompt Builders (English Prompts + Hindi Story/Dialogue Context)
// ==========================================
function buildCharacterReferencePrompt(sceneSplitText) {
    return `[AUTO_CHARACTER_REF_PROMPT]
CRITICAL LANGUAGE RULE: Every image reference prompt MUST be 100% in ENGLISH.

Task:
Analyze the scene-by-scene script below, identify every character/role (Hero / Villain / Supporting / Animal), and create ONE Single Master Reference Photo prompt per valid character/role so the same reference image keeps character identity consistent across scenes.

Rules:
1. Skip any role with no character (e.g. "None").
2. Hero / Lead: Sharp facial clarity, expressive and charismatic look, clean lighting, consistent outfit and hairstyle, high-detail reference photo.
3. Villain / Antagonist: Distinct, sharp or intimidating expression, memorable look and outfit, high-detail reference photo.
4. Supporting: Natural, clear, consistent appearance and clothing matching the story.
5. Animal: Accurate species/breed, fur or skin texture, body proportions, and distinctive visual traits in crisp detail.
6. Write EVERY reference photo prompt strictly in ENGLISH.

Scene-by-Scene Script:
${sceneSplitText}`;
}

function buildDynamicSceneVideoPrompts(sceneSplitText, charRefPromptsText) {
    return `[AUTO_SCENE_VIDEO_PROMPTS]
CRITICAL LANGUAGE RULE:
- Keep Scene heading, Scene summary, and Character Dialogue/Voiceover in HINDI.
- Write EVERY Video Prompt (and every Step prompt inside a scene) 100% in ENGLISH.

Task:
Group prompts scene by scene (Scene 1 -> Step 1, Step 2...; Scene 2 -> Step 1, Step 2...; and so on) so each scene's reference image can be animated step by step into video clips.

Rules:
1. NO fixed prompt count: Automatically create as many sequential steps (Step 1, Step 2, Step 3, ...) per scene as needed for the full scene duration, dialogue, and action.
2. Under each Scene, keep Hindi context/dialogue clear, and write each Step video prompt in ENGLISH with character consistency, action, expression, and camera movement.

Scene-by-Scene Script:
${sceneSplitText}

Character Reference Prompts:
${charRefPromptsText}`;
}

// ==========================================
// 📋 Individual Prompt Cards with Separate Copy Buttons
// ==========================================
function extractCleanPromptOnly(blockText) {
    return (blockText || '')
        .replace(/^#+\s*.*$/gm, '')
        .replace(/^(?:Scene\s*\d+.*|सीन\s*\d+.*|Setting:.*|Character Action.*|Voiceover\/Dialogue.*|संवाद.*):?.*$/gim, '')
        .replace(/^(?:-\s*)?\*\*?(?:Step\s*\d+|Prompt\s*\d+|प्रॉम्प्ट\s*\d+)\*\*?\s*:?\s*/gim, '')
        .replace(/^["“”]+|["“”]+$/g, '')
        .trim();
}

function isNotApplicablePrompt(text) {
    const t = (text || '').trim().toLowerCase();
    return (
        !t ||
        t === 'none' ||
        t.startsWith('n/a') ||
        t.includes('no villain character') ||
        t.includes('no supporting characters') ||
        t.includes('no animal characters') ||
        t.includes('no reference photo is needed') ||
        t.includes('कोई विशिष्ट किरदार नहीं')
    );
}

function parsePromptBlocks(rawAiText) {
    const lines = (rawAiText || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const blocks = [];
    let currentLabel = '';
    let currentText = '';

    const pushBlock = () => {
        const clean = extractCleanPromptOnly(currentText);
        if (!isNotApplicablePrompt(clean)) {
            blocks.push({
                label: currentLabel || `Prompt #${blocks.length + 1}`,
                prompt: clean
            });
        }
        currentLabel = '';
        currentText = '';
    };

    lines.forEach((line) => {
        const charHeader = line.match(/^(?:\d+[\.\)]\s*)?\*\*?(Hero\s*\/\s*Lead|Villain\s*\/\s*Antagonist|Supporting|Animal|Character(?:\s*\d+)?)\b[^*]*\*?\*?\s*:?\s*(.*)$/i);
        const stepLine = line.match(/^(?:-\s*)?\*\*?(Step\s*\d+|Prompt\s*\d+|प्रॉम्प्ट\s*\d+)\*\*?\s*:?\s*(.*)$/i);
        const quotedLine = line.match(/^["“](.+)["”]$/);

        if (charHeader) {
            if (currentText) pushBlock();
            currentLabel = line.replace(/^\d+[\.\)]\s*|\*+/g, '').replace(/:$/, '').trim();
            if (charHeader[2] && charHeader[2].trim()) {
                currentText = charHeader[2].trim();
            }
        } else if (stepLine) {
            if (currentText) pushBlock();
            currentLabel = stepLine[1].replace(/\*+/g, '').trim();
            currentText = stepLine[2] || '';
        } else if (quotedLine && !currentText) {
            currentText = quotedLine[1];
        } else if (currentText) {
            currentText += ' ' + line;
        }
    });

    if (currentText) pushBlock();
    return blocks;
}

function renderSeparatePromptCards(rawAiText, kind) {
    const chatBox = document.getElementById('chatMessages');
    if (!chatBox || !rawAiText) return;

    const blocks = parsePromptBlocks(rawAiText);
    blocks.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'message ai-message separate-prompt-card';
        card.style.cssText = 'margin:8px 0 12px 0;padding:12px 14px;border-radius:10px;border:1px solid #2b384e;background:#101622;';

        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:12px;color:#58a6ff;font-weight:700;margin-bottom:6px;';
        titleEl.textContent = `${kind === 'char' ? '🎭 Ref Prompt' : '🎬 Video Prompt'} ${idx + 1} — ${item.label}`;

        const bodyEl = document.createElement('div');
        bodyEl.style.cssText = 'font-size:13px;line-height:1.5;color:#f8fafc;white-space:pre-wrap;background:#090d14;padding:8px 10px;border-radius:8px;border:1px solid #1e293b;';
        bodyEl.textContent = item.prompt;

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy-msg-btn';
        copyBtn.style.marginTop = '8px';
        copyBtn.textContent = `📋 Copy Prompt ${idx + 1}`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(item.prompt).then(() => {
                copyBtn.textContent = `✅ Copied ${idx + 1}`;
                setTimeout(() => { copyBtn.textContent = `📋 Copy Prompt ${idx + 1}`; }, 1600);
            });
        };

        card.appendChild(titleEl);
        card.appendChild(bodyEl);
        card.appendChild(copyBtn);
        chatBox.appendChild(card);
    });

    chatBox.scrollTop = chatBox.scrollHeight;
}

// ==========================================
// 🔄 Auto-Populate Characters & Video Steps into 48h Lab1 State
// ==========================================
function loadLab1StateMap() {
    try {
        const raw = localStorage.getItem(LAB1_STATE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const now = Date.now();
        const cleaned = {};
        Object.keys(parsed).forEach((k) => {
            if (parsed[k] && parsed[k].updatedAt && (now - parsed[k].updatedAt) <= FORTY_EIGHT_HOURS_MS) {
                cleaned[k] = parsed[k];
            }
        });
        localStorage.setItem(LAB1_STATE_KEY, JSON.stringify(cleaned));
        return cleaned;
    } catch (_) {
        return {};
    }
}

function saveLab1AutoItems(sessionKey, { characters = null, scenes = null }) {
    const map = loadLab1StateMap();
    const activeKey = sessionKey || 'default_gpu_session';
    const current = map[activeKey]?.data || { characters: [], scenes: [] };

    const nextData = {
        characters: Array.isArray(characters) ? characters : current.characters,
        scenes: Array.isArray(scenes) ? scenes : current.scenes
    };

    map[activeKey] = {
        sessionId: activeKey,
        updatedAt: Date.now(),
        data: nextData
    };
    localStorage.setItem(LAB1_STATE_KEY, JSON.stringify(map));
}

function syncCharactersToLab1(charRefText, sessionKey) {
    const parsedChars = parsePromptBlocks(charRefText);
    if (!parsedChars.length) return;

    const map = loadLab1StateMap();
    const prevChars = map[sessionKey]?.data?.characters || [];

    const nextChars = parsedChars.map((c, i) => {
        const old = prevChars[i] || {};
        const changed = old.prompt !== c.prompt;
        return {
            id: old.id || `char_${i + 1}`,
            label: c.label || `Character ${i + 1}`,
            prompt: c.prompt,
            imageUrl: changed ? '' : (old.imageUrl || ''),
            status: changed ? 'idle' : (old.status || 'idle'),
            errorMsg: ''
        };
    });

    saveLab1AutoItems(sessionKey, { characters: nextChars });
}

function syncSceneStepsToLab1(sceneVideoText, sessionKey) {
    const parsedSteps = parsePromptBlocks(sceneVideoText);
    if (!parsedSteps.length) return;

    const map = loadLab1StateMap();
    const prevScenes = map[sessionKey]?.data?.scenes || [];

    const nextScenes = parsedSteps.map((st, i) => {
        const old = prevScenes[i] || {};
        const changed = old.prompt !== st.prompt;
        return {
            id: old.id || `scene_step_${i + 1}`,
            label: st.label || `Step ${i + 1}`,
            refIndex: i,
            prompt: st.prompt,
            imageUrl: changed ? '' : (old.imageUrl || ''),
            status: changed ? 'idle' : (old.status || 'idle'),
            errorMsg: ''
        };
    });

    saveLab1AutoItems(sessionKey, { scenes: nextScenes });
}

function appendMessage(text, sender, showCopyBtn = true, phaseTag = '', persistToHistory = true) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    if (persistToHistory) {
        saveFullChatTurn(sender, text, phaseTag);
    }

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

            ensureCharacterRefMasterSettingToggle();
            updateSidebarList();

            const chatMessages = document.getElementById('chatMessages');
            if (chatMessages && chatMessages.children.length === 0) {
                const userName = user.displayName ? user.displayName.split(' ')[0] : 'Commander';
                appendMessage(`Hi ${userName}! आज मैं आपकी क्या सहायता कर सकूं?`, 'ai', false, 'welcome', false);
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
    openGpuLabBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.assign('lab1.html');
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

    appendMessage(text, 'user', true, phaseWhenSent, true);
    if (!overrideText) chatInput.value = '';

    let apiKey = localStorage.getItem('apiKey');
    let baseUrl = localStorage.getItem('baseUrl');

    if (!apiKey || !baseUrl) {
        const isSaved = await askForApiKey();
        if (!isSaved) {
            appendMessage("⚠️ API Key न मिलने के कारण जनरेशन रोक दिया गया।", 'ai', true, 'error', true);
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

    const isPromptPhase =
        phaseWhenSent === 'character_ref_prompt' ||
        phaseWhenSent === 'scene_video_prompts';

    const systemInstruction = isPromptPhase
        ? "You are AGC.AI Core. Keep story/scene context and dialogues in HINDI if requested, and write EVERY image reference prompt and EVERY video prompt strictly in natural, detailed ENGLISH."
        : "You are AGC.AI Core, an expert YouTube scriptwriter. Write complete, detailed, and engaging scripts with character dialogues in HINDI.";

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
                            { role: "system", content: systemInstruction },
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
        const isPromptOutput =
            phaseWhenSent === 'character_ref_prompt' ||
            phaseWhenSent === 'scene_video_prompts';

        appendMessage(finalResponse, 'ai', !isPromptOutput, phaseWhenSent, true);

        if (phaseWhenSent === 'character_ref_prompt') {
            renderSeparatePromptCards(finalResponse, 'char');
        } else if (phaseWhenSent === 'scene_video_prompts') {
            renderSeparatePromptCards(finalResponse, 'video');
        }

        const isSplitterON = localStorage.getItem('agc_auto_split_active') === 'true';
        const isCharRefToggleON = localStorage.getItem(CHAR_REF_TOGGLE_KEY) === 'true';

        if (phaseWhenSent === 'story_generation' && isSplitterON) {
            const splitPrompt = `[AUTO_SCENE_SPLITTER]: नीचे दी गई स्क्रिप्ट को Scene 1, Scene 2, Scene 3... में अलग-अलग तोड़ें:

---
${finalResponse}
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
            syncCharactersToLab1(latestCharRefPromptsText, activeSessionId);

            if (isCharRefToggleON) {
                setTimeout(() => {
                    executePromptTurn(buildDynamicSceneVideoPrompts(latestSplitScenesText, latestCharRefPromptsText), 'scene_video_prompts');
                }, 1500);
            } else {
                currentProcessPhase = 'idle';
            }
        } else if (phaseWhenSent === 'scene_video_prompts') {
            syncSceneStepsToLab1(finalResponse, activeSessionId);
            currentProcessPhase = 'idle';
        } else {
            currentProcessPhase = 'idle';
        }
    } else {
        appendMessage(`⚠️ सर्वर लोड: ${lastError || "अस्थायी रूप से सर्वर पर लोड है।"}`, 'ai', true, 'error', true);
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
