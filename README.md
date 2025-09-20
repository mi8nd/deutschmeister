<div align="center">
DeutschMeister - German Learning Companion

  ![alt text](https://i.ibb.co/tM17qGj6/icon.png)

![alt text](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)
A modern, responsive PWA for learning German, featuring structured video courses (A1-C1), progress tracking, interactive quizzes, and a bilingual interface, all powered by Firebase and the YouTube API.
![alt text](https://github.com/mi8nd/deutschmeister/raw/main/demo.gif)
</div>
✨ Key Features
Complete Learning Path (A1-C1): Structured video courses organized by CEFR levels, using curated content from the "YourGermanTeacher" YouTube channel.
User Authentication: Secure user registration, login, password reset, and account management powered by Firebase Authentication.
Personalized Dashboard: A central hub to track overall completion, view completed videos, and quickly resume lessons with a "Continue Watching" feature.
Progress Tracking: The app saves video timestamps and marks completed lessons, allowing users to track their journey through each course level.
Interactive Quizzes: Level-specific quizzes with instant feedback and explanations to test and reinforce knowledge.
Bilingual Interface: Seamlessly switch between English and German (DE/EN) for an immersive experience.
Profile Management: Users can personalize their profile with a custom picture, change their password, and manage their progress data.
Dark & Light Mode: A comfortable viewing experience in any lighting condition with a sleek theme toggle.
Progressive Web App (PWA): Installable on any device for an app-like experience with offline capabilities for the core application shell.
Fully Responsive: A clean, intuitive UI that works flawlessly on desktops, tablets, and smartphones.
🖼️ Screenshots
<div align="center">
<table>
<tr>
<td align="center"><b>Dashboard</b></td>
<td align="center"><b>Video Player</b></td>
</tr>
<tr>
<td><img src="https://github.com/mi8nd/deutschmeister/raw/main/screenshots/dashboard.png" width="400"></td>
<td><img src="https://github.com/mi8nd/deutschmeister/raw/main/screenshots/player.png" width="400"></td>
</tr>
<tr>
<td align="center"><b>Quizzes</b></td>
<td align="center"><b>Profile Page</b></td>
</tr>
<tr>
<td><img src="https://github.com/mi8nd/deutschmeister/raw/main/screenshots/quizzes.png" width="400"></td>
<td><img src="https://github.com/mi8nd/deutschmeister/raw/main/screenshots/profile.png" width="400"></td>
</tr>
<tr>
<td align="center"><b>Login (Dark Mode)</b></td>
<td align="center"><b>Mobile View</b></td>
</tr>
<tr>
<td><img src="https://github.com/mi8nd/deutschmeister/raw/main/screenshots/auth-dark.png" width="400"></td>
<td><img src="https://github.com/mi8nd/deutschmeister/raw/main/screenshots/mobile.png" width="400"></td>
</tr>
</table>
</div>
🛠️ Tech Stack
Frontend: HTML5, CSS3, Vanilla JavaScript (ES6+ Modules)
Backend & Services:
Firebase:
Authentication: User sign-up, login, and management.
Firestore: NoSQL database for user progress, timestamps, and profiles.
YouTube Data API v3: To fetch and display video playlists and details.
PWA: Service Worker for offline caching and a Web App Manifest for installability.
📂 Project Structure
The codebase is organized into modular JavaScript files for clarity and maintainability.
code
Code
/
├── index.html            # The main entry point and structure of the app.
├── style.css             # All CSS styles for the application.
├── app.js                # Core application logic, state, UI rendering, and event listeners.
├── auth.js               # Handles all Firebase Authentication functions.
├── firebase.js           # Initializes the Firebase app and exports auth/db instances.
├── youtube.js            # Manages all interactions with the YouTube Data API.
├── quiz.js               # Contains the static data for all quizzes.
├── translations.js       # Stores UI strings for multi-language support (EN/DE).
├── sw.js                 # The service worker for caching and offline functionality.
├── manifest.json         # PWA configuration file.
└── icon.png              # App icon.
🚀 Getting Started
To run this project locally, you'll need to set up your own Firebase project and YouTube API keys.
Prerequisites:
A modern web browser.
A code editor (e.g., VS Code).
A local web server (like the Live Server extension for VS Code).
Configuration Steps:
Clone the Repository:
code
Bash
git clone https://github.com/mi8nd/deutschmeister.git
cd deutschmeister
Set up Firebase:
Go to the Firebase Console and create a new project.
Add a new Web App to your project.
Enable Authentication and choose the "Email/Password" sign-in method.
Set up a Firestore Database in production mode.
In your project settings, find your Firebase configuration object.
Copy this object and paste it into firebase.js, replacing the existing firebaseConfig.
Set up YouTube Data API:
Go to the Google Cloud Console and create a new project.
Enable the "YouTube Data API v3".
Create an API key from the Credentials page.
Open youtube.js and paste your key into the YOUTUBE_API_KEY constant.
Important: It is highly recommended to restrict your API key to prevent unauthorized use (e.g., by setting HTTP referrer restrictions to your domain).
Run the Application:
Open the project folder in VS Code.
Right-click on index.html and select "Open with Live Server".
⚖️ License
This project is licensed under the MIT License. See the LICENSE file for details.
