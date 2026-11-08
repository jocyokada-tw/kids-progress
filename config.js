// ⚠️ 請把 Firebase 主控台提供的設定貼到這裡（專案設定 → 一般 → 你的應用程式 → SDK 設定）
// 這些值不是密碼，可以公開；真正的保護來自 Firestore 安全規則（firestore.rules）。
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// 家庭代號：同一個家庭的所有裝置必須相同。只用英文、數字、底線。
export const FAMILY_ID = "home";
