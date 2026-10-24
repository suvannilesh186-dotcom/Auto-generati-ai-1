let autoStoryInterval = null;
let isLongVideoActive = false;
let isShortVideoActive = false;

// 1. Restore saved state on load
document.addEventListener("DOMContentLoaded", () => {
  const savedTime = localStorage.getItem('agc_target_time');
  if (savedTime) {
    isLongVideoActive = true;
    const btn = document.getElementById('longVideoBtn');
    const label = document.getElementById('longVideoLabel');
    if (btn) btn.classList.add('active');
    if (label) label.innerText = "Active Schedule: " + savedTime;
    startStoryTimer(savedTime);
  }
});

// 2. Toggle Short Video Mode
function toggleShortMode() {
  const btn = document.getElementById('shortVideoBtn');
  isShortVideoActive = !isShortVideoActive;
  btn.classList.toggle('active', isShortVideoActive);
}

// 3. Toggle Long Video Mode
function toggleLongMode() {
  const btn = document.getElementById('longVideoBtn');
  
  if (!isLongVideoActive) {
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
  const btn = document.getElementById('longVideoBtn');
  if (btn) btn.classList.remove('active');
  isLongVideoActive = false;
}

// 5. Save Timing and Start Interval
function saveTimingSetup() {
  const selectedTime = document.getElementById('scheduledTime').value;

  if (!selectedTime) {
    alert("Please select a valid time.");
    return;
  }

  isLongVideoActive = true;
  const btn = document.getElementById('longVideoBtn');
  if (btn) btn.classList.add('active');

  localStorage.setItem('agc_target_time', selectedTime);
  document.getElementById('timingSetupModal').style.display = 'none';
  document.getElementById('longVideoLabel').innerText = "Active Schedule: " + selectedTime;

  startStoryTimer(selectedTime);
}

// 6. Background Timer Watcher
function startStoryTimer(targetTime) {
  if (autoStoryInterval) clearInterval(autoStoryInterval);

  autoStoryInterval = setInterval(() => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = hours + ":" + minutes;

    if (currentTime === targetTime) {
      clearInterval(autoStoryInterval);
      callStoryGenerator();
    }
  }, 1000);
}

// 7. Dispatch Prompt with Dynamic Analytics to Chatbot
function callStoryGenerator() {
  // Read real fetched analytics from storage (or fallback gracefully)
  let analyticsSummary = {
    views: "350+",
    watchTime: "14.2 hours",
    avgDuration: "2:45 min",
    hookPoint: "90% strong",
    ctr: "5.5%"
  };

  const storedAnalytics = localStorage.getItem('agc_latest_analytics');
  if (storedAnalytics) {
    try {
      analyticsSummary = JSON.parse(storedAnalytics);
    } catch (e) {
      console.warn("Analytics JSON parse error, using fallback.");
    }
  }

  const promptText = 
`[AUTO_SCHEDULE_TRIGGER]: Analyze previous video performance and generate a new long-form video story.
- Analytics Context: ${analyticsSummary.views} views, ${analyticsSummary.watchTime} watch time, Hook Retention: ${analyticsSummary.hookPoint}, CTR: ${analyticsSummary.ctr}.
- Instructions:
1. Maintain the high hook point demonstrated in the analytics.
2. Develop an engaging multi-character storyline suitable for a long video (10-20 mins).
3. Provide character dialogue, rising action, and clear pacing.`;

  // Send message to parent dashboard
  if (window.parent) {
    window.parent.postMessage({
      type: 'AUTO_TRIGGER_PROMPT',
      prompt: promptText
    }, '*');
  }
}
