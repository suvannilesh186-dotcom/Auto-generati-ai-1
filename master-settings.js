let autoStoryInterval = null;
let isLongVideoActive = false;
let isShortVideoActive = false;

// Toggle Short Video Mode
function toggleShortMode() {
  const btn = document.getElementById('shortVideoBtn');
  isShortVideoActive = !isShortVideoActive;
  btn.classList.toggle('active', isShortVideoActive);
}

// Toggle Long Video Mode and open Timing Modal
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

// Cancel Timing Setup
function cancelTimingSetup() {
  document.getElementById('timingSetupModal').style.display = 'none';
  const btn = document.getElementById('longVideoBtn');
  if (btn) btn.classList.remove('active');
  isLongVideoActive = false;
}

// Save Timing and Start Interval
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

// Background Timer Watcher
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

// Dispatch Prompt to Chatbot
function callStoryGenerator() {
  const analyticsSummary = {
    views: "338",
    watchTime: "12.8 hours",
    avgDuration: "2:10 min",
    hookPoint: "92% strong",
    ctr: "5.2%"
  };

  const promptText = 
`[AUTO_SCHEDULE_TRIGGER]: Analyze previous video performance and generate a new long-form video story.
- Analytics Context: ` + analyticsSummary.views + ` views, ` + analyticsSummary.watchTime + ` watch time, Hook Retention: ` + analyticsSummary.hookPoint + `, CTR: ` + analyticsSummary.ctr + `.
- Instructions:
1. Maintain the high hook point (92%) demonstrated in the analytics.
2. Develop an engaging multi-character storyline suitable for a long video (10-20 mins).
3. Provide character dialogue, rising action, and clear pacing.`;

  const chatInput = document.querySelector('input[type="text"], textarea');
  const sendBtn = document.querySelector('button[type="submit"], #sendBtn, .send-button');

  if (chatInput) {
    chatInput.value = promptText;
    if (sendBtn) {
      sendBtn.click();
    }
  } else {
    console.log("Chatbot Prompt Dispatched:", promptText);
  }
}
