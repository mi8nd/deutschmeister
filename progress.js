import { db } from "./firebase.js";
import {
  doc, setDoc, getDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

export async function saveProgress(userId, level, videoId) {
  const ref = doc(db, "users", userId);
  await setDoc(ref, {
    [level]: arrayUnion(videoId)
  }, { merge: true });
}

export async function loadProgress(userId) {
  const ref = doc(db, "users", userId);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : {};
}