async function fetchLastVideoAnalytics() {
    const accessToken = localStorage.getItem('agc_access_token');
    const titleElem = document.getElementById('vid-main-title');
    const viewsElem = document.getElementById('stat-views');
    const watchTimeElem = document.getElementById('stat-watchtime');
    const likesElem = document.getElementById('map-likes');
    const commentsElem = document.getElementById('map-comments');
    const insightsElem = document.getElementById('ai-insights-text');

    if (!accessToken) {
        if (titleElem) titleElem.innerText = "ऑथेंटिकेशन एरर - कृपया दोबारा लॉगिन करें";
        return;
    }

    try {
        // 1. Get Channel Uploads Playlist
        const channelRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const channelData = await channelRes.json();
        
        if (!channelData.items || channelData.items.length === 0) {
            throw new Error("यूट्यूब चैनल डेटा नहीं मिला।");
        }

        const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

        // 2. Get Last Uploaded Video
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

        // 3. Get Real Statistics
        const statsRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const statsData = await statsRes.json();

        if (statsData.items && statsData.items.length > 0) {
            const stats = statsData.items[0].statistics;
            const views = parseInt(stats.viewCount || 0);
            const likes = parseInt(stats.likeCount || 0);
            const comments = parseInt(stats.commentCount || 0);
            const estimatedWatchTime = Math.round((views * 2.2) / 60); // Estimated watch hours calculation

            // Populate UI Elements
            if (titleElem) titleElem.innerText = videoTitle;
            if (viewsElem) viewsElem.innerText = views.toLocaleString();
            if (watchTimeElem) watchTimeElem.innerText = `${estimatedWatchTime} घंटे`;
            if (likesElem) likesElem.innerText = likes.toLocaleString();
            if (commentsElem) commentsElem.innerText = comments.toLocaleString();

            // AI Actionable Insights Engine Logic
            let aiText = `विश्लेषण पूर्ण ("${videoTitle}"): `;
            if (views > 200) {
                aiText += `आपके वीडियो को ${views} व्यूज मिले हैं जो कि अच्छे संकेत हैं। ऑडियंस हुक प्रभावी रहा है। अगले वीडियो के लिए सुझाव: वीडियो के मध्य भाग (mid-roll) में दर्शकों को सब्सक्राइब करने के लिए एक विजुअल प्रॉम्प्ट जोड़ें ताकि एंगेजमेंट और बढ़े।`;
            } else {
                aiText += `शुरुआती व्यूज (${views}) थोड़े धीमे हैं। एआई सुझाव: थंबनेल का कलर कंट्रास्ट और टेक्स्ट साइज बड़ा करें, तथा पहले 10 सेकंड में बैकग्राउंड म्यूजिक को अधिक एनर्जेटिक बनाएं।`;
            }
            if (insightsElem) insightsElem.innerText = aiText;
        }
    } catch (error) {
        console.error("Analytics Error:", error);
        if (insightsElem) insightsElem.innerText = `⚠️ डेटा फेच करने में एरर: ${error.message}`;
    }
}

window.onload = fetchLastVideoAnalytics;
