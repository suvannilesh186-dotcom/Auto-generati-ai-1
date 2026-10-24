let autoStoryInterval = null;

// Handle Long Video toggle switch
function onLongVideoToggle(checkbox) {
  if (checkbox.checked) {
    // Open timing popup when toggle is turned ON
    document.getElementById('timingSetupModal').classList.remove('hidden');
  } else {
    // Clear timer and storage when turned OFF
    if (autoStoryInterval) clearInterval(autoStoryInterval);
    document.getElementById('longVideoLabel').innerText = "Auto-Story Generator on Schedule";
    localStorage.removeItem('agc_target_time');
  }
}

// Cancel timing setup and revert toggle
function cancelTimingSetup() {
  document.getElementById('timingSetupModal').classList.add('hidden');
  document.getElementById('longVideoToggle').checked = false;
}

// Save schedule and start watcher
function saveTimingSetup() {
  const selectedTime = document.getElementById('scheduledTime').value;

  if (!selectedTime) {
    alert("Please select a valid time.");
    return;
  }

  // Save timing in localStorage
  localStorage.setItem('agc_target_time', selectedTime);
  document.getElementById('timingSetupModal').classList.add('hidden');
  document.getElementById('longVideoLabel').innerText = `Active Schedule: ${selectedTime}`;

  // Start background checker
  startStoryTimer(selectedTime);
}

// Watch current time every second
function startStoryTimer(targetTime) {
  if (autoStoryInterval) clearInterval(autoStoryInterval);

  autoStoryInterval = setInterval(() => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;

    // Trigger action when time matches
    if (currentTime === targetTime) {
      clearInterval(autoStoryInterval);
      callStoryGenerator();
    }
  }, 1000);
}

// Send analytics context to AI chatbot input
function callStoryGenerator() {
  const analyticsSummary = {
    views: "338",
    watchTime: "12.8 hours",
    avgDuration: "2:10 min",
    hookPoint: "92% strong",
    ctr: "5.2%"
  };

  // Structured prompt for AI chatbot
  const promptText = `
[AUTO_SCHEDULE_TRIGGER]: Analyze previous video performance and generate a new long-form video story.
- Analytics Context: ${analyticsSummary.views} views, ${analyticsSummary.watchTime} watch time, Hook Retention: ${analyticsSummary.hookPoint}, CTR: ${analyticsSummary.ctr}.
- Instructions:
1. Maintain the high hook point (92%) demonstrated in the analytics.
2. Develop an engaging multi-character storyline suitable for a long video (10-20 mins).
3. Provide character dialogue, rising action, and clear pacing.
  `.trim();

  // Find chat input and submit button
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
