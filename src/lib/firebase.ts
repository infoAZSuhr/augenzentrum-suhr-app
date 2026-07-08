import { initializeApp } from 'firebase/app'
import { getAuth, browserSessionPersistence, setPersistence } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: "AIzaSyAYRnIZJ46oEPUIZ9uRiLDbTWW0dB93vgQ",
  authDomain: "azsdb-999d6.firebaseapp.com",
  projectId: "azsdb-999d6",
  storageBucket: "azsdb-999d6.firebasestorage.app",
  messagingSenderId: "782091866487",
  appId: "1:782091866487:web:4616ff6bf7cce1e15c1172",
  measurementId: "G-VRZKYB2CSV"
}

export const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
setPersistence(auth, browserSessionPersistence)
export const db = getFirestore(app)
export const storage = getStorage(app)
