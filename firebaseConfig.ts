
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";

/**
 * ⚠️ CONFIGURACIÓN DE FIREBASE
 */
const firebaseConfig = {
  apiKey: "AIzaSyAUY3mbdZ3_MgxDDVE0qRwDOBqIuSOTdOU",
  authDomain: "seikoyt-streaming.firebaseapp.com",
  projectId: "seikoyt-streaming",
  storageBucket: "seikoyt-streaming.firebasestorage.app",
  messagingSenderId: "329984889094",
  appId: "1:329984889094:web:2c4814f98f9bb0edb74e87",
  databaseURL: "https://seikoyt-streaming-default-rtdb.firebaseio.com"
};

export const isConfigured = firebaseConfig.projectId !== "YOUR_PROJECT_ID";

// Initialize Firebase safely for serverless cold-starts
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const rtdb = getDatabase(app);

export default app;
