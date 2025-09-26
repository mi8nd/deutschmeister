import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, getDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getStorage, ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-storage.js";
import { auth, db } from './firebase.js';
import { handleSignUp, handleLogin, handleLogout, handleLogoutAndReset, handleDeleteAccount, handlePasswordReset, handleVerifyPasswordResetCode, handleConfirmPasswordReset, handleChangePassword, handleUpdateProfileName } from './auth.js';
import { fetchPlaylistVideoCounts, fetchAndCacheAllVideos, PLAYLISTS } from './youtube.js';
import { quizData } from './quiz.js';
import { translations } from './translations.js';

// --- START: Robust YouTube API Loading ---
const loadYouTubeAPI = () => {
    return new Promise((resolve) => {
        if (window.YT && window.YT.Player) {
            return resolve();
        }
        if (window.onYouTubeIframeAPIReady) {
            const originalCallback = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                originalCallback();
                resolve();
            };
            return;
        }
        window.onYouTubeIframeAPIReady = resolve;
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        // Append to head or documentElement for safety, works even if no <script> tag exists.
        (document.head || document.documentElement).appendChild(tag);
    });
};

const ytApiLoaded = loadYouTubeAPI();
// --- END: Robust YouTube API Loading ---


// Global State & Data
let courseData = {}, currentUser = null, userProgress = {}, currentLevel = null;
let currentPlaylist = [], currentQuiz = [], currentQuestionIndex = 0, score = 0;
let player, timestampInterval;
const elements = {};
let oobCode = null;
let allVideosData = {};
let isDataLoading = false;
let deferredInstallPrompt = null;

const grammarData = [
    { id: 'g-a1', level: 'A1', pages: 32, file: 'a1_skript_gr.pdf' },
    { id: 'g-a2', level: 'A2', pages: 33, file: 'a2_skript_gr.pdf' },
    { id: 'g-b1', level: 'B1', pages: 39, file: 'b1_skript_gr.pdf' },
    { id: 'g-b2', level: 'B2', pages: 35, file: 'b2_skript_gr.pdf' },
    { id: 'g-c1', level: 'C1', pages: 38, file: 'c1_skript_gr.pdf' }
];

const vocabData = [
    { id: 'v-a1', level: 'A1', pages: 29, file: 'A1.pdf' },
    { id: 'v-a2', level: 'A2', pages: 32, file: 'A2.pdf' },
    { id: 'v-b1', level: 'B1', pages: 104, file: 'B1.pdf' },
    { id: 'v-b2', level: 'B2', pages: 26, file: 'B2.pdf' },
    { id: 'v-c1', level: 'C1', pages: 36, file: 'C1.pdf' },
    { id: 'v-ex', level: 'Extras', pages: 2, file: 'Extras/100 Exclamations Vocabulary.pdf', titleKey: 'vocabExtrasTitle', descKey: 'vocabExtrasDesc' }
];


// Helper Functions
const getTranslations = () => {
    const lang = localStorage.getItem('language') || 'en';
    return translations[lang] || translations['en'];
};

const getYouTubeIdFromUrl = (url) => {
    if (!url) return null;
    let videoId = null;
    try {
        const urlObj = new URL(url);
        if (urlObj.hostname === 'youtu.be') {
            videoId = urlObj.pathname.slice(1);
        } else if (urlObj.hostname.includes('youtube.com')) {
            videoId = urlObj.searchParams.get('v');
            if (!videoId && (urlObj.pathname.startsWith('/embed/') || urlObj.pathname.startsWith('/v/'))) {
                videoId = urlObj.pathname.split('/').pop();
            }
        }
    } catch (e) {
        console.error("Invalid URL for YouTube ID parsing:", url, e);
        return null;
    }
    return videoId ? videoId.split('?')[0].split('&')[0] : null;
};


async function getInitialLanguage() {
    // 1. Check for a manually set language in localStorage
    const savedLang = localStorage.getItem('language');
    if (savedLang) {
        return savedLang;
    }

    // 2. Try to determine language from IP geolocation
    try {
        // Use a timeout to prevent long waits if the API is slow
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2-second timeout

        const response = await fetch('https://ipapi.co/json/', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`IP API request failed with status ${response.status}`);
        }
        const data = await response.json();
        const countryCode = data.country_code;
        // List of primary German-speaking country codes
        const germanSpeakingCountries = ['DE', 'AT', 'CH', 'LI', 'LU']; // Germany, Austria, Switzerland, Liechtenstein, Luxembourg

        if (germanSpeakingCountries.includes(countryCode)) {
            return 'de';
        }
        // For any other country, default to English
        return 'en';
    } catch (error) {
        console.warn("IP Geolocation failed, falling back to browser language. Error:", error.name === 'AbortError' ? 'Request timed out' : error.message);

        // 3. Fallback to browser's language settings
        const browserLangs = navigator.languages || [navigator.language];
        if (browserLangs.some(lang => lang.toLowerCase().startsWith('de'))) {
            return 'de';
        }

        // 4. Final fallback to English
        return 'en';
    }
}

const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    if (elements.toastContainer) elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
};

const showGlobalLoader = () => elements.globalLoaderOverlay?.classList.remove('hidden');
const hideGlobalLoader = () => elements.globalLoaderOverlay?.classList.add('hidden');

const applyTheme = (theme) => {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    const toggleIcon = document.querySelector('#dark-mode-toggle .material-symbols-outlined');
    if (toggleIcon) toggleIcon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
};

const updateOnlineStatus = () => {
    if (elements.offlineBanner) {
        elements.offlineBanner.classList.toggle('hidden', navigator.onLine);
        document.body.classList.toggle('offline', !navigator.onLine);
    }
};

const resizeUI = () => {
    const width = window.innerWidth;
    const isDesktop = width >= 992;

    document.body.classList.toggle('desktop-layout', isDesktop);
    document.body.classList.toggle('mobile-layout', !isDesktop);
};

const setLanguage = async (lang) => {
    localStorage.setItem('language', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-translate-key]').forEach(el => {
        const key = el.dataset.translateKey;
        const translation = (translations[lang] || translations['en'])?.[key] || translations['en'][key];
        if (translation) el.textContent = translation;
    });

    if (!allVideosData[lang] || Object.keys(allVideosData[lang]).length === 0) {
        showGlobalLoader();
        try {
            allVideosData[lang] = await fetchAndCacheAllVideos(lang);
        } catch (error) {
            console.error("Failed to fetch video data in setLanguage:", error);
            showToast('Could not load course videos. Please check your connection.', 'error');
            // Do not set a permanent failure state; allow retries on next load/language change.
        } finally {
            hideGlobalLoader();
        }
    }

    if (currentUser) {
        renderUserDashboard();
        renderContinueWatching();
        renderAllCourses();
        renderQuizzesView();
        renderGrammarView();
        renderVocabView();
    }

    if (currentLevel) {
        currentPlaylist = getPlaylistFromCache(currentLevel);
        renderVideoList();
    }
};

const handleNavigation = (hash, updateHistory = true) => {
    hash = hash || '#'; // Guard against undefined/null hash
    const normalizeHash = (hashString) => {
        if (!hashString || hashString === '#' || hashString === '#?') {
            return '#';
        }
        try {
            const url = new URL(hashString, window.location.origin);
            url.searchParams.sort();
            return url.hash;
        } catch (e) {
            return '#';
        }
    };

    const currentNormalizedHash = normalizeHash(window.location.hash);
    const targetNormalizedHash = normalizeHash(hash);

    const defaultView = currentUser ? 'home' : 'auth';
    const [viewId, params] = (hash.substring(1) || defaultView).split('?');
    const urlParams = new URLSearchParams(params);
    const mainContent = document.querySelector('.main-content');

    const isPublicView = ['terms', 'privacy', 'faq', 'accessibility'].includes(viewId);

    if (!currentUser && !isPublicView) {
        elements.appContainer?.classList.add('hidden');
        elements.passwordResetView?.classList.add('hidden');
        elements.authContainer?.classList.remove('hidden');
        document.body.classList.remove('public-view-mode');
        if (window.location.hash && window.location.hash !== '#') {
            history.replaceState(null, '', window.location.pathname);
        }
        return;
    }

    elements.appContainer?.classList.remove('hidden');
    elements.authContainer?.classList.add('hidden');
    document.body.classList.toggle('public-view-mode', !currentUser && isPublicView);

    if (mainContent) mainContent.classList.toggle('in-video-player', viewId === 'video-player');
    if (document.querySelector('.view:not(.hidden)')?.id === 'video-player-view' && viewId !== 'video-player') {
        if (player?.destroy) player.destroy();
        player = null;
        clearInterval(timestampInterval);
    }

    document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
    const targetView = document.getElementById(`${viewId}-view`);

    if (targetView) {
        targetView.classList.remove('hidden');
    } else {
        if (currentUser) {
            document.getElementById('home-view')?.classList.remove('hidden');
        } else {
            elements.appContainer?.classList.add('hidden');
            elements.authContainer?.classList.remove('hidden');
            document.body.classList.remove('public-view-mode');
            return;
        }
    }

    if (currentUser && viewId === 'video-player') {
        const level = urlParams.get('level');
        const videoIdParam = urlParams.get('videoId');

        if (level && PLAYLISTS[level]) {
            currentLevel = level;
            const t = getTranslations();
            if (document.getElementById('video-view-title')) document.getElementById('video-view-title').textContent = `${t.levelPrefix}${currentLevel} Course`;
            if (elements.videoList) elements.videoList.innerHTML = '<div class="spinner"></div>';
            currentPlaylist = getPlaylistFromCache(currentLevel);

            if (currentPlaylist.length > 0) {
                renderVideoList();
                let videoToLoadId = videoIdParam;
                if (!videoToLoadId) {
                    const lastCompletedIndex = userProgress.progress?.[currentLevel] || 0;
                    const nextVideoIndex = Math.min(lastCompletedIndex, currentPlaylist.length - 1);
                    videoToLoadId = currentPlaylist[nextVideoIndex]?.videoId || currentPlaylist[0].videoId;
                }
                loadVideo(videoToLoadId);
            } else {
                if (elements.videoList) elements.videoList.innerHTML = ''; // Clear spinner
                showToast('Could not load videos for this course.', 'error');
                window.location.hash = '#courses';
            }
        } else {
            console.warn("No valid level specified for video player, redirecting to courses.");
            window.location.hash = '#courses';
        }
    }

    resizeUI();
    if (elements.sidebarNav) {
        elements.sidebarNav.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.getAttribute('href').startsWith(`#${viewId}`));
        });
    }

    if (updateHistory && currentNormalizedHash !== targetNormalizedHash) {
        history.pushState({ hash }, '', hash);
    }
};


const showView = (viewId, params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    handleNavigation(`#${viewId}${queryString ? `?${queryString}` : ''}`);
};

const showAuthForm = (isSignUp) => {
    if (elements.authPanelContainer) elements.authPanelContainer.classList.toggle("right-panel-active", isSignUp);
};

const getPlaylistFromCache = (level) => {
    const lang = localStorage.getItem('language') || 'en';
    const allVideosForLang = allVideosData[lang] || {};
    const videosForLevel = Object.values(allVideosForLang).filter(video => video.level === level);
    videosForLevel.sort((a, b) => a.index - b.index);
    return videosForLevel;
};

const toggleMobileMenu = () => {
    document.body.classList.toggle('sidebar-open');
};
const closeMobileMenu = () => {
    document.body.classList.remove('sidebar-open');
};


const generateInitialsAvatar = (displayName) => {
    if (!displayName) {
        const defaultAvatar = document.createElement('span');
        defaultAvatar.className = 'material-symbols-outlined';
        defaultAvatar.textContent = 'person';
        return defaultAvatar;
    }
    const names = displayName.split(' ');
    const initials = names.length > 1 ? `${names[0][0]}${names[names.length - 1][0]}` : names[0].substring(0, 2);
    let hash = 0;
    for (let i = 0; i < displayName.length; i++) {
        hash = displayName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const color = `hsl(${hash % 360}, 50%, 40%)`;
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'initials-avatar';
    avatarDiv.style.backgroundColor = color;
    avatarDiv.textContent = initials.toUpperCase();
    return avatarDiv;
};

async function handleProfilePictureUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentUser) return;
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image is too large. Please choose a file smaller than 5MB.', 'error');
        return;
    }

    showGlobalLoader();
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const targetSize = 256;
            canvas.width = targetSize;
            canvas.height = targetSize;
            const hRatio = canvas.width / img.width;
            const vRatio = canvas.height / img.height;
            const ratio = Math.max(hRatio, vRatio);
            const centerShift_x = (canvas.width - img.width * ratio) / 2;
            const centerShift_y = (canvas.height - img.height * ratio) / 2;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, img.width, img.height, centerShift_x, centerShift_y, img.width * ratio, img.height * ratio);
            const base64String = canvas.toDataURL('image/jpeg', 0.9);
            try {
                const storage = getStorage(auth?.app);
                const storageRef = ref(storage, `profilePictures/${currentUser.uid}.jpg`);
                await uploadString(storageRef, base64String, 'data_url');
                const downloadURL = await getDownloadURL(storageRef);

                const userDocRef = doc(db, "users", currentUser.uid);
                await updateDoc(userDocRef, { photoURL: downloadURL });

                userProgress.photoURL = downloadURL;
                renderProfileView();
                renderHeaderProfileAvatar();
                showToast('Profile picture updated!', 'success');
            } catch (error) {
                console.error("Profile picture upload failed:", error);
                showToast('Failed to update picture. Please try again.', 'error');
            } finally {
                hideGlobalLoader();
            }
        };
        img.onerror = () => {
            const t = getTranslations();
            showToast(t.invalidImageFormat, 'error');
            hideGlobalLoader();
        };
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

const startQuiz = async (level) => {
    currentLevel = level;
    const lang = localStorage.getItem('language') || 'en';
    const langQuizData = quizData[lang] || quizData['en'];
    currentQuiz = langQuizData[level] || [];

    if (!currentQuiz.length) { showToast("No quiz for this level yet.", "info"); return; }
    currentQuestionIndex = 0; score = 0;
    if (document.getElementById('quiz-results')) document.getElementById('quiz-results').classList.add('hidden');
    if (document.getElementById('quiz-content')) document.getElementById('quiz-content').classList.remove('hidden');
    const t = getTranslations();
    if (document.getElementById('quiz-title')) document.getElementById('quiz-title').textContent = `${t.levelPrefix}${level} Quiz`;
    displayQuestion();
    showView('quiz');
};

const displayQuestion = () => {
    const question = currentQuiz[currentQuestionIndex];
    if (!question) return;
    let optionsHTML;
    if (question.options.length === 2 && question.options.includes("True") && question.options.includes("False")) {
        const t = getTranslations();
        optionsHTML = `<button class="btn quiz-option-btn" data-index="0">${t.trueOption}</button>` +
            `<button class="btn quiz-option-btn" data-index="1">${t.falseOption}</button>`;
    } else {
        optionsHTML = question.options.map((opt, i) => `<button class="btn quiz-option-btn" data-index="${i}">${opt}</button>`).join('');
    }
    if (document.getElementById('quiz-content')) document.getElementById('quiz-content').innerHTML = `<h3 id="quiz-question">${question.question}</h3><div id="quiz-options">${optionsHTML}</div><div id="quiz-feedback"></div>`;
};

const handleAnswer = (selectedIndex) => {
    const question = currentQuiz[currentQuestionIndex];
    const options = document.querySelectorAll('.quiz-option-btn');
    if (!question || !Array.isArray(question.options) || !options[selectedIndex]) {
        console.error("Invalid answer attempt:", { selectedIndex, question });
        return;
    }
    if (question.correctAnswer == null || !options[question.correctAnswer]) {
        console.error("Invalid correctAnswer index:", question.correctAnswer);
        return;
    }

    options.forEach(btn => btn.disabled = true);
    const feedbackEl = document.getElementById('quiz-feedback');
    const t = getTranslations();

    if (selectedIndex === question.correctAnswer) {
        options[selectedIndex].classList.add('correct');
        score++;
    } else {
        options[selectedIndex].classList.add('incorrect');
        options[question.correctAnswer].classList.add('correct');
        const correctAnswerText = (question.options[question.correctAnswer] === "True" || question.options[question.correctAnswer] === "False") ?
            (question.options[question.correctAnswer] === "True" ? t.trueOption : t.falseOption) :
            question.options[question.correctAnswer];
        if (feedbackEl) feedbackEl.innerHTML = `${t.feedbackIncorrectPrefix}<strong>${correctAnswerText}</strong>. <br><em>${question.explanation || ''}</em>`;
    }
    setTimeout(() => {
        currentQuestionIndex++;
        if (currentQuestionIndex < currentQuiz.length) {
            displayQuestion();
        } else {
            showQuizResults();
        }
    }, 3000);
};

const showQuizResults = async () => {
    if (document.getElementById('quiz-content')) document.getElementById('quiz-content').classList.add('hidden');
    if (document.getElementById('quiz-results')) document.getElementById('quiz-results').classList.remove('hidden');
    if (document.getElementById('quiz-score')) document.getElementById('quiz-score').textContent = `You scored ${score} out of ${currentQuiz.length}`;

    if (currentUser) {
        const resultData = { score: score, total: currentQuiz.length };
        if (!userProgress.quizScores) userProgress.quizScores = {};
        userProgress.quizScores[currentLevel] = resultData;
        try {
            await updateDoc(doc(db, "users", currentUser.uid), {
                [`quizScores.${currentLevel}`]: resultData
            });
            showToast('Quiz score saved!', 'success');
            renderUserDashboard();
        } catch (error) {
            console.error("Failed to save quiz score:", error);
            showToast('Could not save your quiz score.', 'error');
        }
    }
};

const saveTimestamp = async (videoId, time) => {
    if (!currentUser || time < 1 || !navigator.onLine) return;
    if (!userProgress.timestamps) userProgress.timestamps = {};
    userProgress.timestamps[videoId] = time;
    const userDocRef = doc(db, "users", currentUser.uid);
    try {
        await updateDoc(userDocRef, { [`timestamps.${videoId}`]: time });
    } catch (error) {
        if (error.code === 'unavailable') {
            console.warn("Could not save progress, connection is unstable.");
        }
    }
};

const loadVideo = async (videoId) => {
    await ytApiLoaded;
    if (player?.destroy) {
        player.destroy();
        player = null;
    }
    clearInterval(timestampInterval);
    const startTime = userProgress.timestamps?.[videoId] || 0;
    player = new YT.Player('youtube-player-container', {
        videoId: videoId,
        playerVars: { autoplay: 1, modestbranding: 1, rel: 0, start: Math.floor(startTime), origin: window.location.origin },
        events: {
            'onReady': (event) => {
                event.target.playVideo();
                timestampInterval = setInterval(() => {
                    try {
                        if (player?.getCurrentTime) saveTimestamp(videoId, player.getCurrentTime());
                    } catch (e) {
                        console.warn("YT player unavailable for timestamp save:", e);
                        clearInterval(timestampInterval); // Stop interval if player is broken
                    }
                }, 5000);
            },
            'onStateChange': (event) => {
                if (event.data === YT.PlayerState.ENDED) {
                    const currentVideoId = getYouTubeIdFromUrl(event.target.getVideoUrl());
                    const videoIndex = currentPlaylist.findIndex(v => v.videoId === currentVideoId);
                    if (videoIndex !== -1) {
                        markVideoAsCompleteAndPlayNext(videoIndex);
                    }
                }
            }
        }
    });
    document.querySelectorAll('.video-item').forEach(item => item.classList.toggle('active', item.dataset.videoId === videoId));
};

const markVideoAsCompleteAndPlayNext = async (completedVideoIndex) => {
    const newProgress = completedVideoIndex + 1;
    const currentProgress = userProgress.progress?.[currentLevel] || 0;

    if (newProgress > currentProgress) {
        if (!userProgress.progress) userProgress.progress = {};
        userProgress.progress[currentLevel] = newProgress;
        renderVideoList();
        renderUserDashboard();
        if (navigator.onLine && currentUser) {
            try {
                await updateDoc(doc(db, "users", currentUser.uid), { [`progress.${currentLevel}`]: newProgress });
                showToast('Progress Saved!', 'success');
            } catch (error) {
                console.error("Failed to save progress:", error);
            }
        }
    }

    const nextVideoIndex = completedVideoIndex + 1;
    if (nextVideoIndex < currentPlaylist.length) {
        loadVideo(currentPlaylist[nextVideoIndex].videoId);
    } else {
        showToast('Level Complete! Congratulations!', 'success');
    }
};

const renderUserDashboard = () => {
    if (!elements.welcomeMessage) return;
    const t = getTranslations();
    elements.welcomeMessage.textContent = `${t.welcomeBackPrefix}${currentUser.displayName || 'User'}!`;

    const progress = (userProgress && typeof userProgress.progress === 'object' && userProgress.progress !== null)
        ? userProgress.progress
        : {};
    const videosCompleted = Object.values(progress).reduce((sum, p) => sum + (Number(p) || 0), 0);

    const totalVideos = Object.values(courseData || {}).reduce((sum, level) => sum + (level.totalVideos || 0), 0);

    const quizScores = (userProgress && typeof userProgress.quizScores === 'object' && userProgress.quizScores !== null)
        ? userProgress.quizScores
        : {};
    const userQuizPoints = Object.values(quizScores).reduce((sum, result) => sum + (result?.score || 0), 0);

    let totalQuizQuestions = 0;
    const lang = localStorage.getItem('language') || 'en';
    const currentLangQuizData = quizData[lang] || quizData['en'];
    if (currentLangQuizData && typeof currentLangQuizData === 'object') {
        Object.values(currentLangQuizData).forEach(quiz => {
            if (Array.isArray(quiz)) {
                totalQuizQuestions += quiz.length;
            }
        });
    }

    const quizzesCompleted = Object.keys(quizScores).length;
    const totalCompletedItems = videosCompleted + userQuizPoints;
    const totalPossibleItems = totalVideos + totalQuizQuestions;
    const overallPercentage = totalPossibleItems > 0 ? Math.round((totalCompletedItems / totalPossibleItems) * 100) : 0;

    const circle = document.getElementById('progress-ring-circle');
    if (circle) {
        const radius = circle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        circle.style.strokeDashoffset = circumference - (overallPercentage / 100) * circumference;
    }
    if (document.getElementById('progress-ring-text')) document.getElementById('progress-ring-text').textContent = `${overallPercentage}%`;
    if (document.getElementById('stat-videos-completed')) document.getElementById('stat-videos-completed').textContent = videosCompleted;
    if (document.getElementById('stat-quizzes-completed')) document.getElementById('stat-quizzes-completed').textContent = quizzesCompleted;
};

const renderAllCourses = () => {
    const container = document.getElementById('courses-container');
    if (!container) return;
    container.innerHTML = '';
    const t = getTranslations();

    if (!courseData || Object.keys(courseData).length === 0) {
        container.innerHTML = '<div class="spinner"></div>';
        return;
    }

    Object.keys(PLAYLISTS).forEach(level => {
        const section = document.createElement('div');
        section.className = 'course-level-section';
        section.innerHTML = `<h3 class="section-title">${t.levelPrefix}${level}</h3><div class="courses-grid" id="grid-${level}"></div>`;
        container.appendChild(section);

        const grid = document.getElementById(`grid-${level}`);
        const total = courseData[level]?.totalVideos || 0;
        const card = document.createElement('div');
        card.className = 'course-card animated-card';
        card.innerHTML = `
            <h4 class="course-level">${t.fullCourse}</h4>
            <p class="course-description">${total}${t.lessonsCount}</p>
            <p class="course-description">${t.courseDescription}</p>
            <button class="btn btn-primary start-course-btn" data-level="${level}">${t.startCourse}</button>
        `;
        grid.appendChild(card);
    });
};


const renderQuizzesView = () => {
    const container = document.getElementById('quizzes-container');
    if (!container) return;
    const t = getTranslations();
    const lang = localStorage.getItem('language') || 'en';
    const quizzesForLang = quizData[lang] || quizData['en'] || {};
    if (!quizzesForLang || typeof quizzesForLang !== 'object' || Object.keys(quizzesForLang).length === 0) {
        container.innerHTML = `<p class="empty-state">No quizzes available.</p>`;
        return;
    }
    container.innerHTML = Object.keys(quizzesForLang).map((level, index) => `
        <div class="quiz-card animated-card" style="animation-delay: ${index * 100}ms">
            <h4 class="course-level">${t.levelPrefix}${level} Quiz</h4>
            <p class="course-description">${t.quizzesDesc}</p>
            <button class="btn btn-primary start-quiz-btn" data-level="${level}">${t.startQuiz}</button>
        </div>`).join('');
};

const renderGrammarView = () => {
    const container = document.getElementById('grammar-container');
    if (!container) return;
    const t = getTranslations();
    container.innerHTML = grammarData.map((item, index) => `
        <div class="quiz-card animated-card" style="animation-delay: ${index * 100}ms">
            <h4 class="course-level">${t.grammarLevel.replace('{level}', item.level)}</h4>
            <p class="course-description">${t.pagesCount.replace('{count}', item.pages)}</p>
            <p class="course-description">${t.grammarDescription.replace('{level}', item.level)}</p>
            <a href="assets/Grammar/${item.file}" class="btn btn-primary" download="${item.file}">${t.downloadPDF}</a>
        </div>
    `).join('');
};

const renderVocabView = () => {
    const container = document.getElementById('vocab-container');
    if (!container) return;
    const t = getTranslations();
    container.innerHTML = vocabData.map((item, index) => {
        const title = item.titleKey ? t[item.titleKey] : t.vocabLevel.replace('{level}', item.level);
        const description = item.descKey ? t[item.descKey] : t.vocabDescription.replace('{level}', item.level);
        return `
        <div class="quiz-card animated-card" style="animation-delay: ${index * 100}ms">
            <h4 class="course-level">${title}</h4>
            <p class="course-description">${t.pagesCount.replace('{count}', item.pages)}</p>
            <p class="course-description">${description}</p>
            <a href="assets/vocab/${item.file}" class="btn btn-primary" download="${item.file}">${t.downloadPDF}</a>
        </div>`;
    }).join('');
};

const renderProfileView = () => {
    if (!elements.profileName || !elements.profileEmail || !elements.pfpContainer) return;
    elements.profileName.textContent = currentUser.displayName;
    elements.profileEmail.textContent = currentUser.email;
    elements.pfpContainer.innerHTML = '';
    if (userProgress.photoURL) {
        const img = document.createElement('img');
        img.src = userProgress.photoURL;
        img.alt = "Profile Picture";
        img.className = 'profile-avatar-img';
        elements.pfpContainer.appendChild(img);
    } else {
        elements.pfpContainer.appendChild(generateInitialsAvatar(currentUser.displayName));
    }
    const overlay = document.createElement('div');
    overlay.className = 'profile-avatar-overlay';
    overlay.innerHTML = '<span class="material-symbols-outlined">photo_camera</span>';
    elements.pfpContainer.appendChild(overlay);
};

const renderHeaderProfileAvatar = () => {
    if (!elements.headerProfileLink) return;
    elements.headerProfileLink.innerHTML = '';

    if (currentUser) {
        elements.headerProfileLink.classList.remove('hidden');
        if (userProgress.photoURL) {
            const img = document.createElement('img');
            img.src = userProgress.photoURL;
            img.alt = "Profile Picture";
            elements.headerProfileLink.appendChild(img);
        } else {
            const initialsAvatar = generateInitialsAvatar(currentUser.displayName);
            elements.headerProfileLink.appendChild(initialsAvatar);
        }
    } else {
        elements.headerProfileLink.classList.add('hidden');
    }
};

const renderVideoList = () => {
    if (!elements.videoList) return;
    const completedVideos = userProgress.progress?.[currentLevel] || 0;
    elements.videoList.innerHTML = currentPlaylist.map((video, index) => {
        const isCompleted = index < completedVideos;
        return `
        <div class="video-item" data-video-id="${video.videoId}">
            <img src="${video.thumbnail}" alt="${video.title}" class="video-item-thumbnail">
            <div class="video-item-details">
                <h4>${video.title}</h4>
                <button class="btn btn-secondary complete-btn" data-video-index="${index}" ${isCompleted ? 'disabled' : ''}>${isCompleted ? 'Completed' : 'Mark as Complete'}</button>
            </div>
        </div>`;
    }).join('');
};

const resetCourseProgress = async () => {
    if (!currentLevel || !currentUser) return;
    showGlobalLoader();
    try {
        const updates = {
            [`progress.${currentLevel}`]: 0
        };

        if (userProgress.progress) {
            userProgress.progress[currentLevel] = 0; // Update local state
        }

        if (userProgress.timestamps) {
            currentPlaylist.forEach(video => {
                if (userProgress.timestamps[video.videoId] !== undefined) {
                    delete userProgress.timestamps[video.videoId];
                    updates[`timestamps.${video.videoId}`] = deleteField();
                }
            });
        }

        await updateDoc(doc(db, "users", currentUser.uid), updates);

        renderVideoList();
        renderUserDashboard();
        showToast(`Progress for Level ${currentLevel} has been reset.`, 'info');
    } catch (error) {
        console.error("Failed to reset course progress:", error);
        showToast('Failed to reset progress.', 'error');
    } finally {
        hideGlobalLoader();
    }
};

const resetAllProgress = async () => {
    if (!currentUser) return;
    showGlobalLoader();
    try {
        userProgress.progress = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
        userProgress.timestamps = {};
        userProgress.quizScores = {};
        await updateDoc(doc(db, "users", currentUser.uid), {
            progress: userProgress.progress,
            timestamps: deleteField(),
            quizScores: deleteField(),
        });
        renderUserDashboard();
        renderContinueWatching();
        showToast('All your progress has been reset.', 'info');
    } catch (error) {
        showToast('Failed to reset all progress.', 'error');
    } finally {
        hideGlobalLoader();
    }
};

const resetSingleVideoProgress = async (videoId) => {
    if (!currentUser) return;
    const userDocRef = doc(db, "users", currentUser.uid);
    if (userProgress.timestamps?.[videoId] !== undefined) {
        delete userProgress.timestamps[videoId];
        await updateDoc(userDocRef, { [`timestamps.${videoId}`]: deleteField() });
        const t = getTranslations();
        showToast(t.videoProgressReset, 'info');
        renderContinueWatching();
    }
};

const renderContinueWatching = () => {
    const activityList = document.getElementById('activity-list');
    if (!activityList) return;
    activityList.innerHTML = '';
    const t = getTranslations();
    const lang = localStorage.getItem('language') || 'en';
    const allVideosForLang = allVideosData[lang];

    if (!allVideosForLang || Object.keys(allVideosForLang).length === 0) {
        activityList.innerHTML = `<div class="spinner"></div>`;
        return;
    }

    const timestamps = userProgress.timestamps || {};
    const progress = userProgress.progress || {};
    let inProgressVideos = [];

    for (const videoId in timestamps) {
        if (timestamps[videoId] < 5) continue;
        const videoInfo = allVideosForLang[videoId];
        if (!videoInfo) continue;
        const level = videoInfo.level;
        const completedInLevel = progress[level] || 0;
        if (videoInfo.index >= completedInLevel) {
            inProgressVideos.push({ ...videoInfo, timestamp: timestamps[videoId] });
        }
    }
    inProgressVideos.sort((a, b) => b.timestamp - a.timestamp);
    const recentVideos = inProgressVideos.slice(0, 5);
    if (recentVideos.length === 0) {
        activityList.innerHTML = `<p class="empty-state">${t.noRecentActivity}</p>`;
        return;
    }
    recentVideos.forEach(video => {
        const card = document.createElement('div');
        card.className = 'continue-watching-card';
        card.dataset.videoId = video.videoId;
        card.dataset.level = video.level;
        const totalDuration = video.duration || 1800; // Fallback to 30 mins if duration not available
        const progressPercent = totalDuration > 0 ? Math.min(100, (video.timestamp / totalDuration) * 100) : 0;
        card.innerHTML = `
            <img src="${video.thumbnail}" alt="${video.title}" class="continue-watching-thumbnail">
            <div class="continue-watching-details">
                <h4>${video.title}</h4>
                <p class="level-info">${t.levelPrefix}${video.level}</p>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${progressPercent}%;"></div>
                </div>
            </div>
            <button class="btn icon-btn reset-video-button" data-video-id="${video.videoId}" aria-label="Reset video progress">
                <span class="material-symbols-outlined">cancel</span>
            </button>`;
        activityList.appendChild(card);
    });
};

const initializeCourseData = async () => {
    if (isDataLoading || (courseData && Object.keys(courseData).length > 0)) return;
    isDataLoading = true;

    const lang = localStorage.getItem('language') || 'en';

    try {
        const videoDataPromise = fetchAndCacheAllVideos(lang);
        const countsPromise = fetchPlaylistVideoCounts();

        allVideosData[lang] = await videoDataPromise;
        courseData = await countsPromise;

    } catch (error) {
        console.warn("Could not fetch live data, creating fallback.", error);

        courseData = {};
        const cachedVideos = allVideosData[lang] || {};
        for (const level of Object.keys(PLAYLISTS)) {
            const cachedVideosForLevel = Object.values(cachedVideos).filter(v => v.level === level);
            courseData[level] = { totalVideos: cachedVideosForLevel.length, playlistId: PLAYLISTS[level] };
        }
    } finally {
        isDataLoading = false;
    }

    if (currentUser) {
        renderAllCourses();
        renderUserDashboard();
        renderContinueWatching();
    }
};

const updateUIForUser = (user, progressData) => {
    currentUser = user;
    userProgress = progressData;
    elements.appContainer?.classList.remove('hidden');
    elements.passwordResetView?.classList.add('hidden');
    elements.authContainer?.classList.add('hidden');
    document.body.classList.remove('public-view-mode');

    renderProfileView();
    renderHeaderProfileAvatar();
    renderQuizzesView();
    renderGrammarView();
    renderVocabView();
    renderAllCourses();
    renderUserDashboard();
    renderContinueWatching();

    initializeCourseData();
    hideGlobalLoader();
};

const updateUIForGuest = () => {
    currentUser = null;
    userProgress = {};
    elements.appContainer?.classList.add('hidden');
    elements.passwordResetView?.classList.add('hidden');
    elements.authContainer?.classList.remove('hidden');
    if (elements.headerProfileLink) elements.headerProfileLink.classList.add('hidden');

    elements.logoutModalOverlay?.classList.add('hidden');
    elements.resetCourseModalOverlay?.classList.add('hidden');
    elements.deleteAccountModalOverlay?.classList.add('hidden');
    elements.changePasswordModalOverlay?.classList.add('hidden');
    elements.renameProfileModalOverlay?.classList.add('hidden');
    elements.resetAllModalOverlay?.classList.add('hidden');

    showAuthForm(false);
    hideGlobalLoader();
};

const cacheDOMElements = () => {
    const ids = ['app-loader', 'global-loader-overlay', 'auth-container', 'app-container', 'toast-container', 'login-form', 'signup-form', 'logout-btn', 'dark-mode-toggle', 'logout-modal-overlay', 'confirm-logout-btn', 'cancel-logout-btn', 'reset-progress-checkbox', 'reset-course-modal-overlay', 'reset-course-confirm-text', 'confirm-reset-btn', 'cancel-reset-btn', 'youtube-player-container', 'video-list', 'welcome-message', 'profile-name', 'profile-email', 'delete-account-btn', 'delete-account-modal-overlay', 'cancel-delete-btn', 'confirm-delete-btn', 'change-password-btn', 'password-reset-view', 'password-reset-form', 'change-password-modal-overlay', 'change-password-form', 'cancel-change-password-btn', 'change-password-error', 'sidebar', 'hamburger-btn', 'close-sidebar-btn', 'install-app-btn', 'reset-all-progress-btn', 'reset-all-modal-overlay', 'cancel-reset-all-btn', 'pfp-upload-input', 'pfp-container', 'faq-view', 'terms-view', 'privacy-view', 'accessibility-view', 'lang-toggle-btn', 'lang-dropdown', 'delete-account-password', 'delete-account-error', 'offline-banner', 'rename-profile-btn', 'rename-profile-modal-overlay', 'rename-profile-form', 'cancel-rename-profile-btn', 'rename-profile-error', 'new-display-name', 'header-profile-link', 'vocab-view', 'vocab-container'];
    ids.forEach(id => {
        const camelCaseId = id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        elements[camelCaseId] = document.getElementById(id);
    });
    elements.sidebarNav = document.querySelector('.sidebar-nav');
    elements.authPanelContainer = document.getElementById('auth-panel-container');
};

const setupEventListeners = () => {
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resizeUI, 150);
    });

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (elements.installAppBtn) elements.installAppBtn.classList.remove('hidden');
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        if (elements.installAppBtn) elements.installAppBtn.classList.add('hidden');
    });

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    if (elements.hamburgerBtn) elements.hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMobileMenu();
    });

    if (elements.closeSidebarBtn) elements.closeSidebarBtn.addEventListener('click', closeMobileMenu);
    window.addEventListener('hashchange', () => handleNavigation(window.location.hash, false));

    if (elements.langToggleBtn) elements.langToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (elements.langDropdown) elements.langDropdown.classList.toggle('hidden');
    });

    if (elements.langDropdown) elements.langDropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('lang-option')) {
            setLanguage(e.target.dataset.lang);
            elements.langDropdown.classList.add('hidden');
        }
    });

    if (elements.loginForm) elements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showGlobalLoader();
        const loginError = document.getElementById('login-error');
        if (loginError) loginError.textContent = '';
        const result = await handleLogin(elements.loginForm['login-email'].value, elements.loginForm['login-password'].value);
        if (!result.success && loginError) {
            loginError.textContent = 'Invalid email or password.';
            hideGlobalLoader();
        }
    });

    if (elements.signupForm) elements.signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showGlobalLoader();
        const signupError = document.getElementById('signup-error');
        if (signupError) signupError.textContent = '';

        const termsCheckbox = document.getElementById('terms-checkbox');
        if (!termsCheckbox || !termsCheckbox.checked) {
            if (signupError) signupError.textContent = 'You must accept the Terms and Privacy Policy to create an account.';
            hideGlobalLoader();
            return false;
        }

        const result = await handleSignUp(elements.signupForm['signup-name'].value, elements.signupForm['signup-email'].value, elements.signupForm['signup-password'].value);
        if (!result.success && signupError) {
            signupError.textContent = result.error.includes('auth/email-already-in-use') ? 'This email is already in use.' : 'An error occurred.';
            hideGlobalLoader();
        }
    });

    if (elements.passwordResetForm) elements.passwordResetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showGlobalLoader();
        const newPassword = document.getElementById('reset-new-password').value;
        const resetError = document.getElementById('reset-error');
        if (resetError) resetError.textContent = '';
        if (oobCode && newPassword) {
            const result = await handleConfirmPasswordReset(oobCode, newPassword);
            if (result.success) {
                showToast('Password has been reset successfully! Please log in.', 'success');
                window.location.href = '/';
            } else {
                if (resetError) resetError.textContent = 'Failed to reset password. The link may have expired.';
            }
        }
        hideGlobalLoader();
    });

    if (elements.changePasswordForm) elements.changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showGlobalLoader();
        const currentPassword = document.getElementById('change-current-password').value;
        const newPassword = document.getElementById('change-new-password').value;
        if (elements.changePasswordError) elements.changePasswordError.textContent = '';
        const result = await handleChangePassword(currentPassword, newPassword);
        if (result.success) {
            showToast('Password changed successfully!', 'success');
            if (elements.changePasswordModalOverlay) elements.changePasswordModalOverlay.classList.add('hidden');
        } else {
            if (elements.changePasswordError) elements.changePasswordError.textContent = result.error;
        }
        hideGlobalLoader();
    });

    if (elements.renameProfileForm) elements.renameProfileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = elements.newDisplayName.value.trim();
        if (elements.renameProfileError) elements.renameProfileError.textContent = '';

        if (!newName) {
            if (elements.renameProfileError) elements.renameProfileError.textContent = 'Name cannot be empty.';
            return;
        }

        if (newName === currentUser.displayName) {
            if (elements.renameProfileModalOverlay) elements.renameProfileModalOverlay.classList.add('hidden');
            return;
        }
        showGlobalLoader();
        const result = await handleUpdateProfileName(newName);
        if (result.success) {
            currentUser.displayName = newName;
            if (userProgress) userProgress.displayName = newName;
            showToast('Name updated successfully!', 'success');
            if (elements.renameProfileModalOverlay) elements.renameProfileModalOverlay.classList.add('hidden');
            renderProfileView();
            renderUserDashboard();
            renderHeaderProfileAvatar();
        } else {
            if (elements.renameProfileError) elements.renameProfileError.textContent = result.error;
        }
        hideGlobalLoader();
    });

    if (elements.pfpContainer) {
        elements.pfpContainer.addEventListener('click', () => {
            if (elements.pfpUploadInput) {
                elements.pfpUploadInput.click();
            }
        });
    }
    if (elements.pfpUploadInput) elements.pfpUploadInput.addEventListener('change', handleProfilePictureUpload);

    document.body.addEventListener('click', async (e) => {
        const target = e.target;
        if (document.body.classList.contains('sidebar-open') && !target.closest('.sidebar') && !target.closest('#hamburger-btn')) {
            closeMobileMenu();
        }
        if (!target.closest('.lang-toggle-container')) {
            if (elements.langDropdown) elements.langDropdown.classList.add('hidden');
        }

        if (target.closest('.back-to-previous-btn')) {
            if (currentUser) {
                // For a logged-in user, always go back to the main dashboard.
                showView('home');
            } else {
                // For a logged-out user, programmatically navigate to the default view,
                // which our router will correctly interpret as the auth screen.
                // This is more reliable than history.back() when users land directly on a page.
                showView('home');
            }
            return;
        }

        if (target.closest('.reset-video-button')) {
            e.stopPropagation();
            e.preventDefault();
            const videoId = target.closest('.reset-video-button').dataset.videoId;
            await resetSingleVideoProgress(videoId);
            return;
        }

        const navLink = target.closest('.nav-link');
        const footerLink = target.closest('.footer-link');
        const continueCard = target.closest('.continue-watching-card');
        const headerProfileLink = target.closest('#header-profile-link');
        const termsLink = target.closest('.terms-container a');


        if (target.id === 'signUp' || target.id === 'mobile-signUp-link') {
            if (target.tagName === 'A') e.preventDefault();
            showAuthForm(true);
        } else if (target.id === 'signIn' || target.id === 'mobile-signIn-link') {
            if (target.tagName === 'A') e.preventDefault();
            showAuthForm(false);
        } else if (target.id === 'forgot-password-link') {
            const email = prompt("Please enter your email address to receive a password reset link:");
            if (email) {
                showGlobalLoader();
                const result = await handlePasswordReset(email);
                if (result.success) {
                    showToast('Password reset email sent! Check your inbox.', 'success');
                } else {
                    showToast('Could not send email. Please check the address.', 'error');
                }
                hideGlobalLoader();
            }
        }

        if (target.closest('#install-app-btn')) {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                deferredInstallPrompt = null;
                if (elements.installAppBtn) elements.installAppBtn.classList.add('hidden');
            }
        } else if (navLink || (footerLink && footerLink.getAttribute('href').startsWith('#')) || headerProfileLink || termsLink) {
            e.preventDefault();
            const link = navLink || footerLink || headerProfileLink || termsLink;
            handleNavigation(link.getAttribute('href'));
            if (window.innerWidth <= 992) closeMobileMenu();
        } else if (continueCard) {
            showView('video-player', { level: continueCard.dataset.level, videoId: continueCard.dataset.videoId });
        } else if (target.matches('.start-course-btn')) {
            showView('video-player', { level: target.dataset.level });
        } else if (target.matches('#back-to-courses-btn')) {
            showView('courses');
        } else if (target.closest('.video-item') && !target.matches('.complete-btn')) {
            loadVideo(target.closest('.video-item').dataset.videoId);
        } else if (target.matches('.complete-btn')) {
            e.stopPropagation();
            target.disabled = true;
            markVideoAsCompleteAndPlayNext(parseInt(target.dataset.videoIndex, 10));
        } else if (target.matches('.start-quiz-btn')) {
            startQuiz(target.dataset.level);
        } else if (target.matches('.quiz-option-btn')) {
            handleAnswer(parseInt(target.dataset.index, 10));
        } else if (target.matches('#quiz-retry-btn')) {
            startQuiz(currentLevel);
        } else if (target.matches('#quiz-back-btn')) {
            showView('quizzes');
        } else if (target.closest('#dark-mode-toggle')) {
            const newTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
            localStorage.setItem('theme', newTheme);
            applyTheme(newTheme);
        } else if (target.matches('#logout-btn')) {
            if (elements.logoutModalOverlay) elements.logoutModalOverlay.classList.remove('hidden');
        } else if (target === elements.logoutModalOverlay || target.matches('#cancel-logout-btn')) {
            if (elements.logoutModalOverlay) elements.logoutModalOverlay.classList.add('hidden');
        } else if (target.matches('#confirm-logout-btn')) {
            showGlobalLoader();
            (elements.resetProgressCheckbox.checked ? handleLogoutAndReset() : handleLogout());
        } else if (target.matches('#reset-course-btn')) {
            const t = getTranslations();
            if (elements.resetCourseConfirmText) elements.resetCourseConfirmText.textContent = t.resetCourseConfirmMessage.replace('{level}', currentLevel);
            if (elements.resetCourseModalOverlay) elements.resetCourseModalOverlay.classList.remove('hidden');
        } else if (target === elements.resetCourseModalOverlay || target.matches('#cancel-reset-btn')) {
            if (elements.resetCourseModalOverlay) elements.resetCourseModalOverlay.classList.add('hidden');
        } else if (target.matches('#confirm-reset-btn')) {
            resetCourseProgress().finally(() => {
                if (elements.resetCourseModalOverlay) elements.resetCourseModalOverlay.classList.add('hidden');
            });
        } else if (target.matches('#reset-all-progress-btn')) {
            if (elements.resetAllModalOverlay) elements.resetAllModalOverlay.classList.remove('hidden');
        } else if (target === elements.resetAllModalOverlay || target.matches('#cancel-reset-all-btn')) {
            if (elements.resetAllModalOverlay) elements.resetAllModalOverlay.classList.add('hidden');
        } else if (target.matches('#confirm-reset-all-btn')) {
            resetAllProgress().finally(() => {
                if (elements.resetAllModalOverlay) elements.resetAllModalOverlay.classList.add('hidden');
            });
        } else if (target.matches('#delete-account-btn')) {
            if (elements.deleteAccountError) elements.deleteAccountError.textContent = '';
            if (elements.deleteAccountPassword) elements.deleteAccountPassword.value = '';
            if (elements.deleteAccountModalOverlay) elements.deleteAccountModalOverlay.classList.remove('hidden');
        } else if (target.matches('#cancel-delete-btn')) {
            if (elements.deleteAccountModalOverlay) elements.deleteAccountModalOverlay.classList.add('hidden');
        } else if (target.matches('#confirm-delete-btn')) {
            const password = elements.deleteAccountPassword.value;
            if (elements.deleteAccountError) elements.deleteAccountError.textContent = '';
            if (!password) {
                if (elements.deleteAccountError) elements.deleteAccountError.textContent = 'Password is required to delete your account.';
                return;
            }
            showGlobalLoader();
            const result = await handleDeleteAccount(password);
            if (!result.success) {
                if (elements.deleteAccountError) elements.deleteAccountError.textContent = result.error;
                hideGlobalLoader();
            }
        } else if (target.matches('#change-password-btn')) {
            if (elements.changePasswordError) elements.changePasswordError.textContent = '';
            if (elements.changePasswordForm) elements.changePasswordForm.reset();
            if (elements.changePasswordModalOverlay) elements.changePasswordModalOverlay.classList.remove('hidden');
        } else if (target === elements.changePasswordModalOverlay || target.matches('#cancel-change-password-btn')) {
            if (elements.changePasswordModalOverlay) elements.changePasswordModalOverlay.classList.add('hidden');
        } else if (target.matches('#rename-profile-btn')) {
            if (elements.renameProfileError) elements.renameProfileError.textContent = '';
            if (elements.newDisplayName) elements.newDisplayName.value = currentUser.displayName || '';
            if (elements.renameProfileModalOverlay) elements.renameProfileModalOverlay.classList.remove('hidden');
        } else if (target === elements.renameProfileModalOverlay || target.matches('#cancel-rename-profile-btn')) {
            if (elements.renameProfileModalOverlay) elements.renameProfileModalOverlay.classList.add('hidden');
        }
    });

    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        if (elements.installAppBtn) elements.installAppBtn.classList.add('hidden');
    }
};

const handleActionCodes = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    oobCode = urlParams.get('oobCode');
    if (mode === 'resetPassword' && oobCode) {
        const result = await handleVerifyPasswordResetCode(oobCode);
        if (result.success) {
            elements.authContainer?.classList.add('hidden');
            elements.appContainer?.classList.add('hidden');
            if (document.getElementById('reset-email')) document.getElementById('reset-email').value = result.email;
            elements.passwordResetView?.classList.remove('hidden');
        } else {
            showToast('Invalid or expired password reset link.', 'error');
            oobCode = null;
        }
        history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        cacheDOMElements();

        // Prevent Flash of Untranslated Content (FOUC)
        if (elements.appContainer) elements.appContainer.style.visibility = 'hidden';
        if (elements.authContainer) elements.authContainer.style.visibility = 'hidden';

        const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        applyTheme(savedTheme);

        const initialLang = await getInitialLanguage();
        await setLanguage(initialLang);

        resizeUI();
        setupEventListeners();
        updateOnlineStatus();

        await handleActionCodes();

        if (oobCode) {
            elements.appLoader?.classList.add('hidden');
            // Make sure the relevant container is visible for the password reset view
            if (elements.passwordResetView && !elements.passwordResetView.classList.contains('hidden')) {
                if (elements.appContainer) elements.appContainer.style.visibility = 'visible';
            }
            return;
        }

        onAuthStateChanged(auth, async (user) => {
            elements.appLoader?.classList.add('hidden');
            if (user) {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    updateUIForUser(user, userDoc.data());
                } else {
                    console.warn("User exists in Auth but not in Firestore. Logging out.");
                    alert("Your account data is missing. This can happen if an account deletion was interrupted. You will be logged out. Please contact support if you cannot sign up again.");
                    await handleLogout();
                    updateUIForGuest(); // Ensure UI is updated after forced logout
                }
            } else {
                updateUIForGuest();
            }
            handleNavigation(window.location.hash || '#', false);
        });
    } catch (error) {
        console.error("A critical error occurred during app initialization:", error);
        // Fallback for fatal errors: show a message and ensure UI is visible.
        document.body.innerHTML = '<div style="text-align: center; padding: 2rem; color: #333;">An error occurred while loading the application. Please try refreshing the page.</div>';
    } finally {
        // FOUC Safeguard: ensure main containers are visible even if an error occurs.
        if (elements.appContainer) elements.appContainer.style.visibility = 'visible';
        if (elements.authContainer) elements.authContainer.style.visibility = 'visible';
    }
});
