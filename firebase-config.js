import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDA0Qm0DRFyXyNQyCWjxdpGg7oZD8-XA8s",
  authDomain: "pga-draft-league.firebaseapp.com",
  projectId: "pga-draft-league",
  storageBucket: "pga-draft-league.firebasestorage.app",
  messagingSenderId: "126707941809",
  appId: "1:126707941809:web:7c9629e8559a24d6e93d90"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
