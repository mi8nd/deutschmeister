import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    updateProfile,
    deleteUser,
    sendPasswordResetEmail,
    confirmPasswordReset,
    verifyPasswordResetCode,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { auth, db } from './firebase.js';

async function handleSignUp(name, email, password) {
    let user = null;
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        user = userCredential.user;
        await updateProfile(user, { displayName: name });
        const userDocRef = doc(db, "users", user.uid);
        await setDoc(userDocRef, {
            uid: user.uid,
            displayName: name,
            email: user.email,
            createdAt: new Date(),
            photoURL: null,
            progress: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 },
            timestamps: {},
            quizScores: {}
        });
        return { success: true, user };
    } catch (error) {
        if (user) {
            try { await deleteUser(user); } catch (deleteError) { console.error("Rollback failed:", deleteError); }
        }
        return { success: false, error: error.message };
    }
}

async function handleLogin(email, password) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: userCredential.user };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function handleLogout() {
    try {
        await signOut(auth);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function handleLogoutAndReset() {
    try {
        const user = auth.currentUser;
        if (user) {
            const userDocRef = doc(db, "users", user.uid);
            await updateDoc(userDocRef, {
                progress: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0 },
                timestamps: {},
                quizScores: {}
            });
        }
        await signOut(auth);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function handleDeleteAccount(currentPassword) {
    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error("No user is currently logged in.");
        }

        // Create a credential with the user's email and the provided password
        const credential = EmailAuthProvider.credential(user.email, currentPassword);

        // Re-authenticate the user to confirm their identity
        await reauthenticateWithCredential(user, credential);

        // If re-authentication is successful, proceed with deletion
        const userDocRef = doc(db, "users", user.uid);
        await deleteDoc(userDocRef); // Delete Firestore document first
        await deleteUser(user);      // Then delete the Auth user

        return { success: true };
    } catch (error) {
        // Provide specific error messages for common failures
        if (error.code === 'auth/wrong-password') {
            return { success: false, error: 'Incorrect password. Please try again.' };
        }
        if (error.code === 'auth/requires-recent-login') {
            return { success: false, error: 'This operation is sensitive and requires recent authentication. Please log in again before retrying.' };
        }
        console.error("Delete Account Error:", error);
        return { success: false, error: 'An unexpected error occurred. Could not delete account.' };
    }
}

async function handlePasswordReset(email) {
    try {
        const actionCodeSettings = { url: 'https://deutschmeister.netlify.app/' };
        await sendPasswordResetEmail(auth, email, actionCodeSettings);
        return { success: true };
    } catch (error) {
        if (error.code === 'auth/user-not-found') {
            return { success: true };
        }
        return { success: false, error: error.message };
    }
}

async function handleVerifyPasswordResetCode(code) {
    try {
        const email = await verifyPasswordResetCode(auth, code);
        return { success: true, email: email };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function handleConfirmPasswordReset(code, newPassword) {
    try {
        await confirmPasswordReset(auth, code, newPassword);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function handleChangePassword(currentPassword, newPassword) {
    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error('No user is currently logged in.');
        }
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
        return { success: true };
    } catch (error) {
        if (error.code === 'auth/wrong-password') {
            return { success: false, error: 'Incorrect current password. Please try again.' };
        }
        return { success: false, error: 'Failed to change password. Please try again.' };
    }
}

export {
    handleSignUp, handleLogin, handleLogout, handleLogoutAndReset,
    handleDeleteAccount, handlePasswordReset, handleVerifyPasswordResetCode,
    handleConfirmPasswordReset, handleChangePassword
};