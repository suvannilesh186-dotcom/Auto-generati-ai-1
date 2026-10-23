async function fetchLastVideoAnalytics() {
    const accessToken = localStorage.getItem('agc_access_token');
    const titleElem = document.getElementById('vid-title');
    const statsElem = document.getElementById('vid-stats');
    const insightsElem = document.getElementById('vid-insights');

    if (!accessToken) {
        titleElem.innerText = "ऑथेंटिकेशन एरर";
        statsElem.innerText = "कृपया डैशबोर्ड से दोबारा लॉगिन करें (एक्सेस टोकन नहीं मिला)।";
        return;
    }

    try {
        const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const channelData = await channelRes.json();
        
        if (!channelData.items || channelData.items.length === 0) {
            throw new Error("यूट्यूब चैनल डेटा नहीं मिला।");
        }

        const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

        const playlistRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=1`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const playlistData = await playlistRes.json();

        if (!playlistData.items || playlistData.items.length === 0) {
            throw new Error("कोई वीडियो नहीं मिला।");
        }

        const latestVideo = playlistData.items[0].snippet;
        const videoId = latestVideo.resourceId.videoId;
        const videoTitle = latestVideo.title;

        const statsRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const statsData = await statsRes.json();

        if (statsData.items && statsData.items.length > 0) {
            const stats = statsData.items[0].statistics;
            
            titleElem.innerText = videoTitle;
            statsElem.innerHTML = `👁️ <b>व्यूज:</b> ${stats.viewCount || 0} &nbsp;&nbsp;|&nbsp;&nbsp; 👍 <b>लाइक्स:</b> ${stats.likeCount || 0} &nbsp;&nbsp;|&nbsp;&nbsp; 💬 <b>कमेंट्स:</b> ${stats.commentCount || 0}`;
            insightsElem.innerText = `आपका यह आखिरी वीडियो लाइव डेटा के अनुसार ट्रैक हो गया है। व्यूज और एंगेजमेंट बेहतर तरीके से काम कर रहे हैं।`;
        }
    } catch (error) {
        console.error("Analytics Error:", error);
        titleElem.innerText = "डेटा लोड करने में विफल";
        statsElem.innerText = `एरर: ${error.message}`;
    }
}

window.onload = fetchLastVideoAnalytics;
