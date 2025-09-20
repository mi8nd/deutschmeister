import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, getDoc, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { auth, db } from './firebase.js';
import { handleSignUp, handleLogin, handleLogout, handleLogoutAndReset, handleDeleteAccount, handlePasswordReset, handleVerifyPasswordResetCode, handleConfirmPasswordReset, handleChangePassword } from './auth.js';
import { fetchPlaylistVideoCounts, fetchAndCacheAllVideos, PLAYLISTS } from './youtube.js';
import { quizData } from './quiz.js';
import { translations } from './translations.js';

// --- START: Robust YouTube API Loading ---
// This promise-based loader ensures the YouTube Iframe API is loaded only once
// and that any part of the app can wait for it to be ready.
const loadYouTubeAPI = () => {
    return new Promise((resolve) => {
        // If the API is already loaded, resolve immediately.
        if (window.YT && window.YT.Player) {
            return resolve();
        }
        // If the script is already in the process of loading, wait for it.
        if (window.onYouTubeIframeAPIReady) {
            const originalCallback = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                originalCallback();
                resolve();
            };
            return;
        }
        // Otherwise, load the script dynamically.
        window.onYouTubeIframeAPIReady = resolve;
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    });
};

const ytApiLoaded = loadYouTubeAPI();
// --- END: Robust YouTube API Loading ---


// Global State
let courseData = {}, currentUser = null, userProgress = {}, currentLevel = null;
let currentPlaylist = [], currentQuiz = [], currentQuestionIndex = 0, score = 0;
let player, timestampInterval;
const elements = {};
let oobCode = null;
let allVideosData = {};
let deferredInstallPrompt = null;


// Helper Functions
const getTranslations = () => {
    const lang = localStorage.getItem('language') || 'en';
    return translations[lang] || translations['en'];
};

const showToast = (message, type = 'info') => {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    if (elements.toastContainer) elements.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
};

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

    // Only fetch video data if it doesn't already exist for this language.
    if (!allVideosData[lang] || Object.keys(allVideosData[lang]).length === 0) {
        allVideosData[lang] = await fetchAndCacheAllVideos(lang);
    }

    if (currentUser) {
        renderUserDashboard();
        renderContinueWatching();
        renderAllCourses();
        renderQuizzesView();
    }

    if (currentLevel) {
        currentPlaylist = getPlaylistFromCache(currentLevel);
        renderVideoList();
    }
};

const handleNavigation = (hash, updateHistory = true) => {
    const [viewId, params] = (hash.substring(1) || 'home').split('?');
    const urlParams = new URLSearchParams(params);
    const mainContent = document.querySelector('.main-content');

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
        if (document.getElementById('home-view')) document.getElementById('home-view').classList.remove('hidden');
    }

    if (viewId === 'video-player') {
        const level = urlParams.get('level');
        const videoIdParam = urlParams.get('videoId');

        if (level && PLAYLISTS[level]) {
            currentLevel = level;
            const t = getTranslations();
            if (document.getElementById('video-view-title')) document.getElementById('video-view-title').textContent = `${t.levelPrefix}${currentLevel} Course`;
            if (elements.videoList) elements.videoList.innerHTML = '<div class="spinner"></div>';
            currentPlaylist = getPlaylistFromCache(currentLevel);

            if (currentPlaylist.length) {
                renderVideoList();
                let videoToLoadId = videoIdParam;

                if (!videoToLoadId) {
                    const lastCompletedIndex = userProgress.progress?.[currentLevel] || 0;
                    const nextVideoIndex = Math.min(lastCompletedIndex, currentPlaylist.length - 1);
                    videoToLoadId = currentPlaylist[nextVideoIndex]?.videoId || currentPlaylist[0].videoId;
                }

                loadVideo(videoToLoadId);
            } else {
                if (elements.videoList) elements.videoList.innerHTML = '<p>Could not load videos.</p>';
            }
        } else {
            console.warn("No valid level specified for video player, redirecting to courses.");
            window.location.hash = '#courses';
            return;
        }
    }

    resizeUI();

    if (elements.sidebarNav) {
        elements.sidebarNav.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.getAttribute('href').startsWith(`#${viewId}`));
        });
    }

    if (updateHistory && window.location.hash !== hash) {
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

const openMobileMenu = () => document.body.classList.add('sidebar-open');
const closeMobileMenu = () => document.body.classList.remove('sidebar-open');

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
    if (elements.pfpSpinnerOverlay) elements.pfpSpinnerOverlay.classList.remove('hidden');
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
                const userDocRef = doc(db, "users", currentUser.uid);
                await updateDoc(userDocRef, { photoURL: base64String });
                userProgress.photoURL = base64String;
                renderProfileView();
                showToast('Profile picture updated!', 'success');
            } catch (error) {
                showToast('Failed to update picture. Please try again.', 'error');
            } finally {
                if (elements.pfpSpinnerOverlay) elements.pfpSpinnerOverlay.classList.add('hidden');
            }
        };
        img.onerror = () => {
            const t = getTranslations();
            showToast(t.invalidImageFormat, 'error');
            if (elements.pfpSpinnerOverlay) elements.pfpSpinnerOverlay.classList.add('hidden');
        };
    };
    reader.readAsDataURL(file);
    e.target.value = '';
}

const startQuiz = (level) => {
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
    options.forEach(btn => btn.disabled = true);
    const feedbackEl = document.getElementById('quiz-feedback');
    const t = getTranslations();

    if (selectedIndex === question.correctAnswer) {
        options[selectedIndex].classList.add('correct');
        score++; // Increment score on correct answer
        if (feedbackEl) feedbackEl.textContent = t.feedbackCorrect;
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

const showQuizResults = () => {
    if (document.getElementById('quiz-content')) document.getElementById('quiz-content').classList.add('hidden');
    if (document.getElementById('quiz-results')) document.getElementById('quiz-results').classList.remove('hidden');
    if (document.getElementById('quiz-score')) document.getElementById('quiz-score').textContent = `You scored ${score} out of ${currentQuiz.length}`;
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
    // This is the crucial fix: always wait for the YouTube API to be ready.
    await ytApiLoaded;

    if (player?.destroy) {
        player.destroy();
        player = null;
    }
    clearInterval(timestampInterval);

    const startTime = userProgress.timestamps?.[videoId] || 0;

    const playerVars = {
        autoplay: 1,
        modestbranding: 1,
        rel: 0,
        start: Math.floor(startTime),
        origin: window.location.origin
    };

    player = new YT.Player('youtube-player-container', {
        videoId: videoId,
        playerVars: playerVars,
        events: {
            'onReady': (event) => {
                event.target.playVideo(); // Force autoplay on player ready
                timestampInterval = setInterval(() => {
                    if (player?.getCurrentTime) saveTimestamp(videoId, player.getCurrentTime());
                }, 5000);
            },
            'onStateChange': (event) => {
                if (event.data === YT.PlayerState.ENDED) {
                    const videoElement = event.target.getIframe();
                    const currentVideoId = new URL(videoElement.src).pathname.split('/').pop();
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
        const nextVideo = currentPlaylist[nextVideoIndex];
        loadVideo(nextVideo.videoId);
    } else {
        showToast('Level Complete! Congratulations!', 'success');
    }
};

const renderUserDashboard = () => {
    if (!elements.welcomeMessage) return;
    const t = getTranslations();
    elements.welcomeMessage.textContent = `${t.welcomeBackPrefix}${currentUser.displayName || 'User'}!`;
    const progressValues = Object.values(userProgress.progress || {});
    const videosCompleted = progressValues.reduce((sum, p) => sum + p, 0);
    const totalVideos = Object.values(courseData || {}).reduce((sum, level) => sum + (level.totalVideos || 0), 0);
    const overallPercentage = totalVideos > 0 ? Math.round((videosCompleted / totalVideos) * 100) : 0;
    const circle = document.getElementById('progress-ring-circle');
    if (circle) {
        const radius = circle.r.baseVal.value;
        const circumference = radius * 2 * Math.PI;
        circle.style.strokeDasharray = `${circumference} ${circumference}`;
        circle.style.strokeDashoffset = circumference - (overallPercentage / 100) * circumference;
    }
    if (document.getElementById('progress-ring-text')) document.getElementById('progress-ring-text').textContent = `${overallPercentage}%`;
    if (document.getElementById('stat-videos-completed')) document.getElementById('stat-videos-completed').textContent = videosCompleted;
};

const renderAllCourses = () => {
    const container = document.getElementById('courses-container');
    if (!container || !courseData) return;
    container.innerHTML = '';
    const t = getTranslations();

    Object.keys(PLAYLISTS).forEach(level => {
        const section = document.createElement('div');
        section.className = 'course-level-section';
        section.innerHTML = `<h3 class="section-title">Level ${level}</h3><div class="courses-grid" id="grid-${level}"></div>`;
        container.appendChild(section);
    });

    Object.keys(PLAYLISTS).forEach((level) => {
        const grid = document.getElementById(`grid-${level}`);
        const total = courseData[level]?.totalVideos || 0;
        const card = document.createElement('div');
        card.className = 'course-card animated-card';
        card.innerHTML = `
            <h4 class="course-level">Full Course</h4>
            <p class="course-description">${total} Lessons</p>
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
    container.innerHTML = Object.keys(quizData.en).map((level, index) => `<div class="quiz-card animated-card" style="animation-delay: ${index * 100}ms"><h4 class="course-level">${t.levelPrefix}${level} Quiz</h4><p class="course-description">${t.quizzesDesc}</p><button class="btn btn-primary start-quiz-btn" data-level="${level}">${t.startQuiz}</button></div>`).join('');
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
    const spinnerOverlay = document.createElement('div');
    spinnerOverlay.className = 'spinner-overlay hidden';
    spinnerOverlay.id = 'pfp-spinner-overlay';
    spinnerOverlay.innerHTML = '<div class="spinner"></div>';
    elements.pfpContainer.appendChild(spinnerOverlay);
    elements.pfpSpinnerOverlay = spinnerOverlay;
};

const renderVideoList = () => {
    if (!elements.videoList) return;
    const completedVideos = userProgress.progress?.[currentLevel] || 0;
    elements.videoList.innerHTML = currentPlaylist.map((video, index) => {
        const isCompleted = index < completedVideos;
        return `<div class="video-item" data-video-id="${video.videoId}"><img src="${video.thumbnail}" alt="${video.title}" class="video-item-thumbnail"><div class="video-item-details"><h4>${video.title}</h4><button class="btn btn-secondary complete-btn" data-video-index="${index}" ${isCompleted ? 'disabled' : ''}>${isCompleted ? 'Completed' : 'Mark as Complete'}</button></div></div>`;
    }).join('');
};

const resetCourseProgress = async () => {
    if (!currentLevel || !currentUser) return;
    if (userProgress.progress) userProgress.progress[currentLevel] = 0;
    currentPlaylist.forEach(video => {
        if (userProgress.timestamps?.[video.videoId]) delete userProgress.timestamps[video.videoId];
    });
    renderVideoList();
    renderUserDashboard();
    await updateDoc(doc(db, "users", currentUser.uid), {
        [`progress.${currentLevel}`]: 0,
        timestamps: userProgress.timestamps
    });
    showToast(`Progress for Level ${currentLevel} has been reset.`, 'info');
};

const resetAllProgress = async () => {
    if (!currentUser) return;
    userProgress.progress = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 };
    userProgress.timestamps = {};
    await updateDoc(doc(db, "users", currentUser.uid), {
        progress: userProgress.progress,
        timestamps: userProgress.timestamps
    });
    renderUserDashboard();
    renderContinueWatching();
    showToast('All your progress has been reset.', 'info');
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
    const timestamps = userProgress.timestamps || {};
    const progress = userProgress.progress || {};
    let inProgressVideos = [];
    const t = getTranslations();
    const lang = localStorage.getItem('language') || 'en';
    const allVideosForLang = allVideosData[lang] || {};

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
        const totalDuration = 30 * 60;
        const progressPercent = Math.min(100, (video.timestamp / totalDuration) * 100);
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

const updateUIForUser = (user, progressData) => {
    currentUser = user;
    userProgress = progressData;
    if (elements.authContainer) elements.authContainer.classList.add('hidden');
    if (elements.passwordResetView) elements.passwordResetView.classList.add('hidden');
    if (elements.appContainer) elements.appContainer.classList.remove('hidden');
    setLanguage(localStorage.getItem('language') || 'en').then(() => {
        renderAllCourses();
        renderQuizzesView();
        renderProfileView();
        renderUserDashboard();
        renderContinueWatching();
        handleNavigation(window.location.hash || '#home', false);
    });
};

const updateUIForGuest = () => {
    currentUser = null;
    userProgress = {};
    if (elements.appContainer) elements.appContainer.classList.add('hidden');
    if (elements.passwordResetView) elements.passwordResetView.classList.add('hidden');
    if (elements.authContainer) elements.authContainer.classList.remove('hidden');
    showAuthForm(false);
};

const cacheDOMElements = () => {
    const ids = ['app-loader', 'auth-container', 'app-container', 'toast-container', 'login-form', 'signup-form', 'logout-btn', 'dark-mode-toggle', 'logout-modal-overlay', 'confirm-logout-btn', 'cancel-logout-btn', 'reset-progress-checkbox', 'reset-course-modal-overlay', 'reset-course-confirm-text', 'confirm-reset-btn', 'cancel-reset-btn', 'youtube-player-container', 'video-list', 'welcome-message', 'profile-name', 'profile-email', 'delete-account-btn', 'delete-account-modal-overlay', 'cancel-delete-btn', 'confirm-delete-btn', 'change-password-btn', 'password-reset-view', 'password-reset-form', 'change-password-modal-overlay', 'change-password-form', 'cancel-change-password-btn', 'change-password-error', 'sidebar', 'hamburger-btn', 'close-sidebar-btn', 'install-app-btn', 'reset-all-progress-btn', 'reset-all-modal-overlay', 'cancel-reset-all-btn', 'confirm-reset-all-btn', 'pfp-upload-input', 'pfp-container', 'faq-view', 'terms-view', 'privacy-view', 'accessibility-view', 'lang-toggle-btn', 'lang-dropdown', 'delete-account-password', 'delete-account-error', 'offline-banner'];
    ids.forEach(id => {
        const camelCaseId = id.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        elements[camelCaseId] = document.getElementById(id);
        if (!elements[camelCaseId] && id !== 'auth-panel-container') console.warn(`Element with ID '${id}' not found.`);
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
        else console.warn("Element with ID 'install-app-btn' not found.");
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        if (elements.installAppBtn) elements.installAppBtn.classList.add('hidden');
    });

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    if (elements.hamburgerBtn) elements.hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMobileMenu();
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
        const loginError = document.getElementById('login-error');
        if (loginError) loginError.textContent = '';
        const result = await handleLogin(elements.loginForm['login-email'].value, elements.loginForm['login-password'].value);
        if (!result.success && loginError) loginError.textContent = 'Invalid email or password.';
    });

    if (elements.signupForm) elements.signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const signupError = document.getElementById('signup-error');
        if (signupError) signupError.textContent = '';
        const result = await handleSignUp(elements.signupForm['signup-name'].value, elements.signupForm['signup-email'].value, elements.signupForm['signup-password'].value);
        if (!result.success && signupError) signupError.textContent = result.error.includes('auth/email-already-in-use') ? 'This email is already in use.' : 'An error occurred.';
    });

    if (elements.passwordResetForm) elements.passwordResetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
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
    });

    if (elements.changePasswordForm) elements.changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
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
    });

    if (elements.pfpContainer) elements.pfpContainer.addEventListener('click', () => elements.pfpUploadInput.click());
    if (elements.pfpUploadInput) elements.pfpUploadInput.addEventListener('change', handleProfilePictureUpload);

    document.body.addEventListener('click', async (e) => {
        const target = e.target;
        if (document.body.classList.contains('sidebar-open') && !target.closest('.sidebar')) {
            closeMobileMenu();
        }
        if (!target.closest('.lang-toggle-container')) {
            if (elements.langDropdown) elements.langDropdown.classList.add('hidden');
        }

        if (target.closest('.back-to-previous-btn')) {
            history.back();
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

        if (target.id === 'signUp') showAuthForm(true);
        if (target.id === 'signIn') showAuthForm(false);
        if (target.id === 'forgot-password-link') {
            const email = prompt("Please enter your email address to receive a password reset link:");
            if (email) {
                const result = await handlePasswordReset(email);
                if (result.success) {
                    showToast('Password reset email sent! Check your inbox.', 'success');
                } else {
                    showToast('Could not send email. Please check the address.', 'error');
                }
            }
        }

        if (target.closest('#install-app-btn')) {
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                deferredInstallPrompt = null;
                if (elements.installAppBtn) elements.installAppBtn.classList.add('hidden');
            }
        } else if (navLink || (footerLink && footerLink.getAttribute('href').startsWith('#'))) {
            e.preventDefault();
            const link = navLink || footerLink;
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
            (elements.resetProgressCheckbox.checked ? handleLogoutAndReset() : handleLogout()).finally(() => {
                if (elements.logoutModalOverlay) elements.logoutModalOverlay.classList.add('hidden');
            });
        } else if (target.matches('#reset-course-btn')) {
            const t = getTranslations();
            if (elements.resetCourseConfirmText) elements.resetCourseConfirmText.textContent = t.resetCourseConfirmMessage.replace('{level}', currentLevel);
            if (elements.resetCourseModalOverlay) elements.resetCourseModalOverlay.classList.remove('hidden');
        } else if (target === elements.resetCourseModalOverlay || target.matches('#cancel-reset-btn')) {
            if (elements.resetCourseModalOverlay) elements.resetCourseModalOverlay.classList.add('hidden');
        } else if (target.matches('#confirm-reset-btn')) {
            resetCourseProgress();
            if (elements.resetCourseModalOverlay) elements.resetCourseModalOverlay.classList.add('hidden');
        } else if (target.matches('#reset-all-progress-btn')) {
            if (elements.resetAllModalOverlay) elements.resetAllModalOverlay.classList.remove('hidden');
        } else if (target === elements.resetAllModalOverlay || target.matches('#cancel-reset-all-btn')) {
            if (elements.resetAllModalOverlay) elements.resetAllModalOverlay.classList.add('hidden');
        } else if (target.matches('#confirm-reset-all-btn')) {
            resetAllProgress();
            if (elements.resetAllModalOverlay) elements.resetAllModalOverlay.classList.add('hidden');
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
            const result = await handleDeleteAccount(password);
            if (result.success) {
                showToast('Account deleted successfully.', 'info');
                if (elements.deleteAccountModalOverlay) elements.deleteAccountModalOverlay.classList.add('hidden');
            } else {
                if (elements.deleteAccountError) elements.deleteAccountError.textContent = result.error;
            }
        } else if (target.matches('#change-password-btn')) {
            if (elements.changePasswordError) elements.changePasswordError.textContent = '';
            if (elements.changePasswordForm) elements.changePasswordForm.reset();
            if (elements.changePasswordModalOverlay) elements.changePasswordModalOverlay.classList.remove('hidden');
        } else if (target === elements.changePasswordModalOverlay || target.matches('#cancel-change-password-btn')) {
            if (elements.changePasswordModalOverlay) elements.changePasswordModalOverlay.classList.add('hidden');
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
            if (elements.authContainer) elements.authContainer.classList.add('hidden');
            if (elements.appContainer) elements.appContainer.classList.add('hidden');
            if (document.getElementById('reset-email')) document.getElementById('reset-email').value = result.email;
            if (elements.passwordResetView) elements.passwordResetView.classList.remove('hidden');
        } else {
            showToast('Invalid or expired password reset link.', 'error');
            oobCode = null;
        }
        history.replaceState({}, document.title, window.location.pathname);
    }
};

const initializeApp = async () => {
    // Preload video data for primary languages, checking if they already exist.
    if (!allVideosData.en || Object.keys(allVideosData.en).length === 0) {
        allVideosData.en = await fetchAndCacheAllVideos('en');
    }
    if (!allVideosData.de || Object.keys(allVideosData.de).length === 0) {
        allVideosData.de = await fetchAndCacheAllVideos('de');
    }

    try {
        courseData = await fetchPlaylistVideoCounts();
    } catch (error) {
        console.warn("Could not fetch live playlist counts, will proceed with cached data.", error);
    }

    if (!courseData || Object.keys(courseData).length === 0) {
        console.log("Creating fallback course data for offline mode.");
        courseData = {};
        const lang = localStorage.getItem('language') || 'en';
        const cachedVideos = allVideosData[lang] || {};
        for (const level of Object.keys(PLAYLISTS)) {
            const cachedVideosForLevel = Object.values(cachedVideos).filter(v => v.level === level);
            courseData[level] = { totalVideos: cachedVideosForLevel.length, playlistId: PLAYLISTS[level] };
        }
    }

    onAuthStateChanged(auth, async (user) => {
        if (oobCode) {
            if (elements.appLoader) elements.appLoader.classList.add('hidden');
            return;
        }
        if (elements.appLoader) elements.appLoader.classList.add('hidden');
        if (user) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                updateUIForUser(user, userDoc.data());
            } else {
                console.warn("User exists in Auth but not in Firestore. Logging out.");
                alert("Your account data is missing. This can happen if an account deletion was interrupted. You will be logged out. Please contact support if you cannot sign up again.");
                await handleLogout();
            }
        } else {
            updateUIForGuest();
        }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme);
    const savedLang = localStorage.getItem('language') || 'en';

    cacheDOMElements();
    resizeUI();
    setupEventListeners();
    updateOnlineStatus();

    setLanguage(savedLang).then(() => {
        handleActionCodes();
        if (!oobCode) {
            initializeApp().then(() => {
                handleNavigation(window.location.hash, false);
            });
        } else {
            if (elements.appLoader) elements.appLoader.classList.add('hidden');
        }
    });
});

window.addEventListener('load', () => {
    console.log("Window fully loaded");
    resizeUI();
});