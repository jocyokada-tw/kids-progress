// ⚠️ 請把 Firebase 主控台提供的設定貼到這裡（專案設定 → 一般 → 你的應用程式 → SDK 設定）
// 這些值不是密碼，可以公開；真正的保護來自 Firestore 安全規則（firestore.rules）。
export const firebaseConfig = {
  apiKey: "AIzaSyCvjyAPjQNmicvnI5glO9eDrjVCO_ZS3I4",
  authDomain: "kids-progress-0927.firebaseapp.com",
  projectId: "kids-progress-0927",
  storageBucket: "kids-progress-0927.firebasestorage.app",
  messagingSenderId: "434170266751",
  appId: "1:434170266751:web:70339bb77c661ea9742b4a"
};

// 推播通知用的「網路推播憑證」公開金鑰（Firebase 主控台 → 專案設定 → Cloud Messaging →
// 網路設定 → Web Push 憑證 → 產生金鑰組）。沒有填的話，通知功能不會出現。
export const vapidKey = "";

// 家庭代號：同一個家庭的所有裝置必須相同。只用英文、數字、底線。
export const FAMILY_ID = "home";
