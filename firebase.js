import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js"; // Removed FieldValue import here

const firebaseConfig = {
  apiKey: "AIzaSyA7rw3wnvyxxDHF8RWXDSfkY91ZOiiWTY0",
  authDomain: "deutschmeister-hcj.firebaseapp.com",
  projectId: "deutschmeister-hcj",
  storageBucket: "deutschmeister-hcj.appspot.com",
  messagingSenderId: "213786635954",
  appId: "1:213786635954:web:80014dae07f9e71dd563ab",
  measurementId: "G-BMCPQJVPL5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db }; // Export only auth and db