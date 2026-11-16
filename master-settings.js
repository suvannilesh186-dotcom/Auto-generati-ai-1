let autoStoryInterval = null;
let autoShortStoryInterval = null;
let isLongVideoActive = false;
let isShortVideoActive = false;
let currentSetupMode = null; 

// 1. Restore saved state on load
document.addEventListener("DOMContentLoaded", () => {
  // Long Video State Restore
  const savedTime = localStorage.getItem('agc_target_time');
  if (savedTime) {
    isLongVideoActive = true;
    const btn = document.getElementById('longVideoBtn');
    const label = document.getElementById('longVideoLabel');
    if (btn) btn.classList.add('active');
    if (label) label.innerText = "Active Schedule: " + savedTime;
    startStoryTimer(savedTime);
  }

  // Short Video State Restore
  const savedShortTime = localStorage.getItem('agc_short_target_time');
  if (savedShortTime) {
    isShortVideoActive = true;
    const btn = document.getElementById('shortVideoBtn');
    const label = document.getElementById('shortVideoLabel'); 
    if (btn) btn.classList.add('active');
    if (label) label.innerText = "Active Schedule: " + savedShortTime;
    startShortStoryTimer(savedShortTime);
  }
});

// 2. Toggle Short Video Mode
function toggleShortMode() {
  const btn = document.getElementById('shortVideoBtn');
  
  if (!isShortVideoActive) {
    currentSetupMode = 'short'; 
    document.getElementById('timingSetupModal').style.display = 'flex';
  } else {
    isShortVideoActive = false;
    btn.classList.remove('active');
    if (autoShortStoryInterval) clearInterval(autoShortStoryInterval);
    
    const label = document.getElementById('shortVideoLabel');
    if (label) label.innerText = "Enable Shorts Mode";
    localStorage.removeItem('agc_short_target_time');
  }
}

// 3. Toggle Long Video Mode
function toggleLongMode() {
  const btn = document.getElementById('longVideoBtn');
  
  if (!isLongVideoActive) {
    currentSetupMode = 'long'; 
    document.getElementById('timingSetupModal').style.display = 'flex';
  } else {
    isLongVideoActive = false;
    btn.classList.remove('active');
    if (autoStoryInterval) clearInterval(autoStoryInterval);
    
    document.getElementById('longVideoLabel').innerText = "Auto-Story Generator on Schedule";
    localStorage.removeItem('agc_target_time');
  }
}

// 4. Cancel Timing Setup
function cancelTimingSetup() {
  document.getElementById('timingSetupModal').style.display = 'none';
  
  if (currentSetupMode === 'long') {
    const btn = document.getElementById('longVideoBtn');
    if (btn) btn.classList.remove('active');
    isLongVideoActive = false;
  } else if (currentSetupMode === 'short') {
    const btn = document.getElementById('shortVideoBtn');
    if (btn) btn.classList.remove('active');
    isShortVideoActive = false;
  }
  
  currentSetupMode = null;
}

// 5. Save Timing and Start Interval
function saveTimingSetup() {
  const selectedTime = document.getElementById('scheduledTime').value;

  if (!selectedTime) {
    alert("Please select a valid time.");
    return;
  }

  document.getElementById('timingSetupModal').style.display = 'none';

  if (currentSetupMode === 'long') {
    isLongVideoActive = true;
    const btn = document.getElementById('longVideoBtn');
    if (btn) btn.classList.add('active');

    localStorage.setItem('agc_target_time', selectedTime);
    const label = document.getElementById('longVideoLabel');
    if (label) label.innerText = "Active Schedule: " + selectedTime;

    startStoryTimer(selectedTime);

  } else if (currentSetupMode === 'short') {
    isShortVideoActive = true;
    const btn = document.getElementById('shortVideoBtn');
    if (btn) btn.classList.add('active');

    localStorage.setItem('agc_short_target_time', selectedTime);
    const label = document.getElementById('shortVideoLabel');
    if (label) label.innerText = "Active Schedule: " + selectedTime;

    startShortStoryTimer(selectedTime);
  }

  currentSetupMode = null;
}

// 6. Background Timer Watcher (Long Video)
function startStoryTimer(targetTime) {
  if (autoStoryInterval) clearInterval(autoStoryInterval);

  autoStoryInterval = setInterval(() => {
    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0');

    if (currentTime === targetTime) {
      clearInterval(autoStoryInterval);
      callStoryGenerator();
    }
  }, 1000);
}

// 6b. Background Timer Watcher (Short Video)
function startShortStoryTimer(targetTime) {
  if (autoShortStoryInterval) clearInterval(autoShortStoryInterval);

  autoShortStoryInterval = setInterval(() => {
    const now = new Date();
    const currentTime = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0');

    if (currentTime === targetTime) {
      clearInterval(autoShortStoryInterval);
      callShortStoryGenerator();
    }
  }, 1000);
}

// 7. Dispatch Prompt (Long Video) (UPDATED)
function callStoryGenerator() {
  let analyticsSummary = { views: "350+", watchTime: "14.2 hours", avgDuration: "2:45 min", hookPoint: "90% strong", ctr: "5.5%" };
  const storedAnalytics = localStorage.getItem('agc_latest_analytics');
  if (storedAnalytics) { try { analyticsSummary = JSON.parse(storedAnalytics); } catch (e) {} }

  const promptText = `[AUTO_SCHEDULE_TRIGGER]: Analyze previous video performance and generate a new long-form video story.
- Analytics Context: ${analyticsSummary.views} views, ${analyticsSummary.watchTime} watch time, Hook Retention: ${analyticsSummary.hookPoint}, CTR: ${analyticsSummary.ctr}.
- Instructions:
1. Maintain the high hook point demonstrated in the analytics.
2. Develop an engaging multi-character storyline suitable for a long video (10-20 mins).
3. Provide character dialogue, rising action, and clear pacing.`;

  window.postMessage({ type: 'AUTO_TRIGGER_PROMPT', prompt: promptText }, '*');
  if (window.parent !== window) {
      window.parent.postMessage({ type: 'AUTO_TRIGGER_PROMPT', prompt: promptText }, '*');
  }
}

// 7b. Dispatch Prompt (Short Video) (UPDATED)
function callShortStoryGenerator() {
  const promptText = `[AUTO_SCHEDULE_TRIGGER_SHORT]: Generate a new YouTube Short.
- Instructions:
1. Create a fast-paced, highly engaging 60-second storyline.
2. Hook the viewer in the first 3 seconds.
3. End with a strong call to action (CTA) for subscribing.`;

  window.postMessage({ type: 'AUTO_TRIGGER_PROMPT_SHORT', prompt: promptText }, '*');
  if (window.parent !== window) {
      window.parent.postMessage({ type: 'AUTO_TRIGGER_PROMPT_SHORT', prompt: promptText }, '*');
  }
}
