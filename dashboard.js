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
let latestStoryText = '';
let latestSplitScenesText = '';
let latestCharRefPromptsText = '';
let latestScenePhotoPromptsText = '';

const CHAR_REF_TOGGLE_KEY = 'agc_char_ref_prompts_active';
const FULL_CHAT_ARCHIVE_KEY = 'agc_full_chat_history_48h';
const LAB1_STATE_KEY = 'agc_gpu_lab1_state_48h';
const ACTIVE_SESSION_KEY = 'agc_active_session_id';
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

const loaderMessages = [
    "Thinking...",
    "Reading data...",
    "Processing...",
    "Analyzing...",
    "Almost ready..."
];

// ==========================================
// 🧠 Hidden Master Story, Visual & 10s Motion Rules
// ==========================================
const GEMINI_STYLE_MASTER_RULES = `
You are an expert AI Film Director, Story Architect & Visual Prompt Engineer.
Always enforce these mandatory rules internally (never echo these instructions or labels in user output):

1. STRICT NO-JUMP CONTINUOUS VISUAL STORY (SHORT & LONG):
   - Write a continuous, step-by-step visual story with ZERO skipped middle actions and ZERO sudden jumps.
   - Every transition must connect naturally: where the object is placed first (e.g., on a desk/table inside a 3D house), how the character enters, notices it, approaches it, and opens it, what happens step-by-step inside, how the character moves around after being surprised, how any character or ally enters logically (never teleporting friends or sudden conflicts out of nowhere), and how the return/ending happens smoothly.
   - Never skip intermediate steps even in short videos; keep the sequence connected from start to finish.

2. NO LABELS, NO "NARRATOR" TAGS, NO QUESTIONS:
   - Do NOT write tags/headers like "नरेटर:", "[INTRO...]", "[सीक्वेंस...]", or speaker prefixes unless explicitly asked. Write plain, flowing visual narrative lines.
   - Do NOT write question sentences or question marks ("?"). Express everything as clear visual actions and statements.

3. STORY STYLE & CHARACTER IDENTITY LOCK (ZERO MORPHING):
   - Lock ONE cohesive visual style across the entire story: either "3D Pixar-style animated film" (for fantasy/kids/cartoon/mythological stories) or "Natural photorealistic live-action human" (for realistic real-life stories).
   - Define every character's exact locked appearance once (exact age, face structure, hairstyle & color, skin tone, and exact outfit/colors) and repeat those exact details in EVERY scene photo and video prompt so characters never change age, face, or outfit mid-story.

4. CHARACTER TURNAROUND REFERENCE SHEETS:
   - Include ONLY valid characters present in the story (never write "None" or "N/A").
   - Describe a clean wide horizontal 16:9 turnaround sheet on a solid light grey studio background: top row showing separated full-body poses (Front, Side Profile, Back, Three-Quarter) spaced apart with no overlapping heads or stacked faces; bottom row showing separate expression portraits (Happy, Sad, Angry, Surprised).

5. SCENE PHOTO PROMPTS (USING LOCKED REFERENCE CHARACTERS):
   - Do NOT invent a new or different character face. Use ONLY the exact characters already defined in the Character Reference Sheet, keeping their exact face, hair, age, and clothing consistent while changing their pose, body action, facial expression, camera framing, and scene background for each scene.
   - 10-second video prompts must animate directly from each scene's photo with clear camera movement (slow push-in, pan, tilt, or pull-back) and smooth natural character movement, single face per character, accurate hands/fingers, no extra limbs, and no text or watermarks.
`.trim();

function isPromptRequestText(text) {
    const t = (text || '').trim().toLowerCase();
    if (!t) return false;
    return (
        t.includes('प्रॉम्प्ट') ||
        t.includes('prompt') ||
        t.includes('रेफरेंस') ||
        t.includes('reference') ||
        t.includes('सीन फोटो') ||
        t.includes('scene photo') ||
        t.includes('वीडियो प्रॉम्प्ट') ||
        t.includes('video prompt')
    );
}

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
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);

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
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);

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
            script: latestSplitScenesText || latestStoryText || text,
            fullChat: transcript,
            messages: currentSessionMessages
        }));
        updateSidebarList();
    } catch (e) {
        console.error('48h chat save error:', e);
    }
}

// ==========================================
// ⚙️ Master Setting Toggle for Character Ref, Scene Photo & Video Prompts
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
        <div style="font-size:13px;font-weight:700;color:#fff;">🎭 Auto Character Ref, Scene Photo & Video Prompts</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Scene Split के बाद Character Ref → Scene Photo → Scene Video प्रॉम्प्ट्स</div>
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
// 📝 Prompt Builders (Character Ref -> Scene Photo -> Scene Video)
// ==========================================
function buildCharacterReferencePrompt(sceneSplitText) {
    const sourceContext = (sceneSplitText || latestSplitScenesText || latestStoryText || '').trim();
    return `[AUTO_CHARACTER_REF_PROMPT]
Write ONLY valid main characters present in the story/script below. Do NOT write "None" or "N/A".
Lock the story's visual style (3D cartoon or natural human) and describe a clean wide horizontal 16:9 turnaround sheet on a solid light grey studio background: top row showing separated full-body poses (Front, Side Profile, Back, Three-Quarter) spaced apart with no overlapping heads or stacked faces; bottom row showing separate expression portraits (Happy, Sad, Angry, Surprised).
For each valid character, write in this EXACT format:

स्टेप 1: [Character Name]
Prompt: [Detailed 100% English 16:9 character turnaround sheet prompt with exact age, face, hair, outfit, separated top-row full-body views and bottom-row expression faces on a solid light grey studio background]

स्टेप 2: [Next Character Name]
Prompt: [Detailed 100% English 16:9 character turnaround sheet prompt]

Story / Script:
${sourceContext}`;
}

function buildScenePhotoPrompts(sceneSplitText, charRefPromptsText) {
    const sourceContext = (sceneSplitText || latestSplitScenesText || latestStoryText || '').trim();
    return `[AUTO_SCENE_PHOTO_PROMPTS]
Do NOT invent a new or different character face. Use ONLY the exact characters already defined in the Character Reference Sheet below, keeping their exact face, hair, age, and clothing consistent while changing their pose, body action, facial expression, camera framing, and scene background for each scene.

Write in this EXACT format:

फोटो 1 (सीन 1 - [Short Hindi Title])
Prompt: [Detailed 100% English 16:9 widescreen scene photo prompt using the exact character(s) from the reference sheet, placing them into the scene's exact background, pose, body action, matching expression, camera angle, and lighting, with zero character identity change]

फोटो 2 (सीन 2 - [Short Hindi Title])
Prompt: [Detailed 100% English 16:9 widescreen scene photo prompt]

Story / Script:
${sourceContext}

Character Reference Sheet:
${charRefPromptsText || ''}`;
}

function buildDynamicSceneVideoPrompts(sceneSplitText, charRefPromptsText, scenePhotoPromptsText) {
    const sourceContext = (sceneSplitText || latestSplitScenesText || latestStoryText || '').trim();
    return `[AUTO_SCENE_VIDEO_PROMPTS]
Using the story/script, locked character prompts, and scene photo prompts below, generate one 10-second Image-to-Video motion prompt per scene continuing directly from that scene's photo with clear camera movement (zoom-in, pan, tilt, or pull-back) and smooth natural character action, zero double faces, zero extra hands/fingers, and consistent age/outfit in this EXACT format:

सीन 1 वीडियो प्रॉम्प्ट
Prompt: [Detailed 10-second 100% English video motion prompt describing how the camera moves and how the character/scene animates smoothly from the photo for 10 seconds, consistent character design, single face, accurate hands]

सीन 2 वीडियो प्रॉम्प्ट
Prompt: [Detailed 10-second 100% English video motion prompt]

Story / Script:
${sourceContext}

Character Prompts:
${charRefPromptsText || ''}

Scene Photo Prompts:
${scenePhotoPromptsText || ''}`;
}

// ==========================================
// 📋 Individual Prompt Cards with Separate Copy Buttons
// ==========================================
function isNotApplicablePrompt(text) {
    const t = (text || '').trim().toLowerCase();
    return (
        !t ||
        t === 'none' ||
        t.startsWith('n/a') ||
        t.includes('no character to reference') ||
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
    let lastHeading = '';

    lines.forEach((line) => {
        const promptMatch = line.match(/^(?:-\s*|\*\s*)?(?:\*\*)?Prompt(?:\*\*)?\s*:\s*(.+)$/i);
        if (promptMatch) {
            const cleanPrompt = promptMatch[1].replace(/^["“”]+|["“”]+$/g, '').trim();
            if (!isNotApplicablePrompt(cleanPrompt)) {
                blocks.push({
                    label: lastHeading || `Prompt ${blocks.length + 1}`,
                    prompt: cleanPrompt
                });
            }
            lastHeading = '';
        } else if (!line.startsWith('[') && !line.startsWith('---')) {
            const candidateLabel = line.replace(/\*+/g, '').replace(/:$/, '').trim();
            if (candidateLabel && !isNotApplicablePrompt(candidateLabel) && !/^Character\s*:\s*None$/i.test(candidateLabel)) {
                lastHeading = candidateLabel;
            }
        }
    });

    if (blocks.length > 0) return blocks;

    let currentLabel = '';
    let currentText = '';
    const flush = () => {
        const clean = (currentText || '').replace(/^["“”]+|["“”]+$/g, '').trim();
        if (!isNotApplicablePrompt(clean) && /[a-zA-Z]{4,}/.test(clean)) {
            blocks.push({
                label: currentLabel || `Prompt ${blocks.length + 1}`,
                prompt: clean
            });
        }
        currentLabel = '';
        currentText = '';
    };

    lines.forEach((line) => {
        const stepLine = line.match(/^(?:-\s*)?\*\*?(Step\s*\d+|Prompt\s*\d+)\*\*?\s*:?\s*(.*)$/i);
        if (stepLine) {
            if (currentText) flush();
            currentLabel = stepLine[1].replace(/\*+/g, '').trim();
            currentText = stepLine[2] || '';
        } else if (currentText) {
            currentText += ' ' + line;
        }
    });
    if (currentText) flush();

    return blocks;
}

function renderSeparatePromptCards(rawAiText, kind) {
    const chatBox = document.getElementById('chatMessages');
    if (!chatBox || !rawAiText) return;

    const tagPrefix =
        kind === 'char' ? 'Character Prompt' :
        kind === 'photo' ? 'Photo Prompt' :
        'Video Prompt';

    const blocks = parsePromptBlocks(rawAiText);
    blocks.forEach((item, idx) => {
        const card = document.createElement('div');
        card.className = 'message ai-message separate-prompt-card';
        card.style.cssText = 'margin:8px 0 12px 0;padding:12px 14px;border-radius:10px;border:1px solid #2b384e;background:#101622;';

        const titleEl = document.createElement('div');
        titleEl.style.cssText = 'font-size:12px;color:#58a6ff;font-weight:700;margin-bottom:6px;';
        titleEl.textContent = `${tagPrefix} ${idx + 1} — ${item.label}`;

        const bodyEl = document.createElement('div');
        bodyEl.style.cssText = 'font-size:13px;line-height:1.5;color:#f8fafc;white-space:pre-wrap;background:#090d14;padding:8px 10px;border-radius:8px;border:1px solid #1e293b;';
        bodyEl.textContent = item.prompt;

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'copy-msg-btn';
        copyBtn.style.marginTop = '8px';
        copyBtn.textContent = `📋 Copy ${idx + 1}`;
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(item.prompt).then(() => {
                copyBtn.textContent = `✅ Copied ${idx + 1}`;
                setTimeout(() => { copyBtn.textContent = `📋 Copy ${idx + 1}`; }, 1600);
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

function saveLab1AutoItems(sessionKey, { characters = null, photos = null, scenes = null }) {
    const map = loadLab1StateMap();
    const activeKey = sessionKey || 'default_gpu_session';
    const current = map[activeKey]?.data || { characters: [], photos: [], scenes: [] };

    const nextData = {
        characters: Array.isArray(characters) ? characters : (current.characters || []),
        photos: Array.isArray(photos) ? photos : (current.photos || []),
        scenes: Array.isArray(scenes) ? scenes : (current.scenes || [])
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

    saveLab1AutoItems(sessionKey, { characters: nextChars, scenes: [] });
}

function syncScenePhotosToLab1(scenePhotoText, sessionKey) {
    const parsedPhotos = parsePromptBlocks(scenePhotoText);
    if (!parsedPhotos.length) return;

    const map = loadLab1StateMap();
    const prevPhotos = map[sessionKey]?.data?.photos || [];

    const nextPhotos = parsedPhotos.map((p, i) => {
        const old = prevPhotos[i] || {};
        const changed = old.prompt !== p.prompt;
        return {
            id: old.id || `scene_photo_${i + 1}`,
            label: p.label || `Scene Photo ${i + 1}`,
            refIndex: i,
            prompt: p.prompt,
            imageUrl: changed ? '' : (old.imageUrl || ''),
            status: changed ? 'idle' : (old.status || 'idle'),
            errorMsg: ''
        };
    });

    saveLab1AutoItems(sessionKey, { photos: nextPhotos, scenes: [] });
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
                localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
                saveLab1AutoItems(activeSessionId, { characters: [], photos: [], scenes: [] });
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
        localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
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

async function executePromptTurn(overrideText = '', forcedPhase = null, displayOverride = null) {
    if (!chatInput || !sendChatBtn || !chatMessages) return;

    const rawInput = (overrideText || chatInput.value).trim();
    if (!rawInput) return;

    const isInternalAutoStep = Boolean(overrideText);
    const isManualNormalChat = forcedPhase === 'normal_chat' && !isInternalAutoStep;
    const userRequestedPrompts = isManualNormalChat && isPromptRequestText(rawInput);

    let phaseWhenSent = forcedPhase || 'story_generation';
    if (userRequestedPrompts) {
        phaseWhenSent = 'character_ref_prompt';
    }
    currentProcessPhase = phaseWhenSent;

    const visibleChatText = displayOverride || (isInternalAutoStep ? '' : rawInput);
    if (visibleChatText) {
        appendMessage(visibleChatText, 'user', true, phaseWhenSent, true);
    }
    if (!isInternalAutoStep) chatInput.value = '';

    let apiUserContent = rawInput;
    if (userRequestedPrompts) {
        const storyCtx = (latestSplitScenesText || latestStoryText || '').trim();
        apiUserContent = `${buildCharacterReferencePrompt(storyCtx)}\n\nUser Message: ${rawInput}`;
    }

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
        phaseWhenSent === 'scene_photo_prompts' ||
        phaseWhenSent === 'scene_video_prompts';

    const systemInstruction = isPromptPhase
        ? `You are AGC.AI Core. ${GEMINI_STYLE_MASTER_RULES}\nWrite EVERY prompt strictly in clean, detailed ENGLISH without "None" or "N/A".`
        : phaseWhenSent === 'normal_chat'
            ? "You are AGC.AI Core, a helpful AI assistant. Reply naturally and concisely in HINDI (or the user's language)."
            : `You are AGC.AI Core, a master visual story architect. ${GEMINI_STYLE_MASTER_RULES}\nWrite a COMPLETE, NO-JUMP, STEP-BY-STEP VISUAL STORY in HINDI with zero speaker/narrator labels, zero question marks, and every transition connected smoothly from start to finish.`;

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
                            { role: "user", content: apiUserContent }
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
        if (phaseWhenSent === 'story_generation') {
            latestStoryText = finalResponse;
        }

        const isPromptOutput =
            phaseWhenSent === 'character_ref_prompt' ||
            phaseWhenSent === 'scene_photo_prompts' ||
            phaseWhenSent === 'scene_video_prompts';

        if (isPromptOutput) {
            saveFullChatTurn('ai', finalResponse, phaseWhenSent);
            renderSeparatePromptCards(
                finalResponse,
                phaseWhenSent === 'character_ref_prompt' ? 'char' :
                phaseWhenSent === 'scene_photo_prompts' ? 'photo' :
                'video'
            );
        } else {
            appendMessage(finalResponse, 'ai', phaseWhenSent !== 'normal_chat', phaseWhenSent, true);
        }

        const isSplitterON = localStorage.getItem('agc_auto_split_active') === 'true';
        const isCharRefToggleON = localStorage.getItem(CHAR_REF_TOGGLE_KEY) === 'true';

        if (phaseWhenSent === 'story_generation' && isSplitterON) {
            const splitPrompt = `[AUTO_SCENE_SPLITTER]: नीचे दी गई कहानी को बिना कोई बीच का दृश्य छोड़े या जंप मारे Scene 1, Scene 2, Scene 3... में क्रम से तोड़ें:

---
${finalResponse}
---

नियम:
- कोई जंप न हो; चौंकने, चलने, मिलने, या वापस आने के बीच के हर कदम को क्रम में रखें।
- "नरेटर:", "[सीक्वेंस...]" या प्रश्नवाचक वाक्य (?) न लिखें।
- हर सीन के लिए स्पष्ट HINDI में दें:
  1. Exact Location & Camera Action
  2. Character Appearance, Action & Attire (हर सीन में एक जैसा हुलिया)
  3. Story/Dialogue Line (बिना प्रश्नवाचक अंदाज़ के)`;

            setTimeout(() => {
                executePromptTurn(splitPrompt, 'scene_splitting');
            }, 3000);
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

            if (isCharRefToggleON || userRequestedPrompts) {
                setTimeout(() => {
                    executePromptTurn(
                        buildScenePhotoPrompts(latestSplitScenesText || latestStoryText, latestCharRefPromptsText),
                        'scene_photo_prompts'
                    );
                }, 1500);
            } else {
                currentProcessPhase = 'idle';
            }
        } else if (phaseWhenSent === 'scene_photo_prompts') {
            latestScenePhotoPromptsText = finalResponse;
            syncScenePhotosToLab1(latestScenePhotoPromptsText, activeSessionId);

            if (isCharRefToggleON || userRequestedPrompts) {
                setTimeout(() => {
                    executePromptTurn(
                        buildDynamicSceneVideoPrompts(
                            latestSplitScenesText || latestStoryText,
                            latestCharRefPromptsText,
                            latestScenePhotoPromptsText
                        ),
                        'scene_video_prompts'
                    );
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
    sendChatBtn.addEventListener('click', (e) => {
        const phase = e && e.isTrusted === false ? 'story_generation' : 'normal_chat';
        executePromptTurn('', phase);
    });
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const phase = e && e.isTrusted === false ? 'story_generation' : 'normal_chat';
            executePromptTurn('', phase);
        }
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

function startScheduledStoryPipeline(incomingPrompt = '', modeTag = 'scheduled') {
    const promptToRun = (incomingPrompt || '').trim() || (
        modeTag === 'short'
            ? 'एक मजेदार और भावनात्मक 1 मिनट की बिना जंप वाली, पूरी तरह जुड़ी हुई विज़ुअल कहानी लिखें। कोई सवालिया वाक्य, नरेटर टैग या बीच के दृश्य का जंप न हो।'
            : 'एक दमदार और रोचक बिना जंप वाली, पूरी तरह जुड़ी हुई विज़ुअल कहानी लिखें। कोई सवालिया वाक्य, नरेटर टैग या बीच के दृश्य का जंप न हो।'
    );

    activeSessionId = 'session_' + Date.now();
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    currentSessionMessages = [];
    latestStoryText = '';
    latestSplitScenesText = '';
    latestCharRefPromptsText = '';
    latestScenePhotoPromptsText = '';
    saveLab1AutoItems(activeSessionId, { characters: [], photos: [], scenes: [] });

    executePromptTurn(promptToRun, 'story_generation');
}

window.triggerAgcAutoStory = startScheduledStoryPipeline;

window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;

    if (
        data.type === 'AUTO_TRIGGER_PROMPT' ||
        data.type === 'AUTO_TRIGGER_PROMPT_SHORT' ||
        data.type === 'AUTO_TRIGGER_PROMPT_LONG'
    ) {
        const mode =
            data.type === 'AUTO_TRIGGER_PROMPT_SHORT' ? 'short' :
            data.type === 'AUTO_TRIGGER_PROMPT_LONG' ? 'long' : 'auto';
        startScheduledStoryPipeline(data.prompt || data.text || '', mode);
    }
});
