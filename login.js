import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { CONFIG } from './config.js';

let app, auth, googleProvider;

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
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    googleProvider.addScope('https://www.googleapis.com/auth/youtube.readonly');
    googleProvider.setCustomParameters({ prompt: 'select_account' });
} catch (e) {
    console.error("Firebase Init Error:", e);
}

// पेज पूरी तरह लोड होने के बाद ही बटन पर क्लिक बाइंड करें
document.addEventListener('DOMContentLoaded', () => {
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            try {
                const result = await signInWithPopup(auth, googleProvider);
                const credential = GoogleAuthProvider.credentialFromResult(result);
                if (credential && credential.accessToken) {
                    localStorage.setItem('agc_access_token', credential.accessToken);
                    setTimeout(() => {
                        window.location.href = 'dashboard.html';
                    }, 300);
                }
            } catch (error) {
                console.warn("Popup failed, trying redirect...", error);
                try {
                    await signInWithRedirect(auth, googleProvider);
                } catch (redirectError) {
                    console.error("Redirect Error:", redirectError);
                }
            }
        });
    }
});
