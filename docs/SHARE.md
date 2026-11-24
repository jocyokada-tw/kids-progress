# 架設你自己的一份（給朋友）

這份文件給想要「架設一份自己家用的」朋友。照著做，你會有一個**完全屬於自己**的 App：
程式放在你的 GitHub，資料放在你的 Firebase，和原作者的家庭完全分開。

整個流程約 30～60 分鐘，只需要瀏覽器。

---

## 你需要準備

- 一個 **Google 帳號**（建立 Firebase 專案用）
- 一個 **GitHub 帳號**（放程式、用 GitHub Pages 發佈網頁）
- （選用）願意把 Firebase 升級成 **Blaze 方案**（要綁信用卡，用量很小，一個家庭通常每月幾塊台幣以內）。
  不升級也可以用大部分功能，見下面的表格。

## 步驟

1. **複製程式**：在這個專案的 GitHub 頁面按右上角「**Fork**」，複製一份到你的帳號。
2. **建立 Firebase 專案、填 `config.js`、部署安全規則、開 GitHub Pages**：照 [`docs/SETUP.md`](SETUP.md) 第 1～4 步。
   - ⚠️ **一定要把 `config.js` 換成你自己專案的設定**。沒換的話，你的 App 會連到原作者的 Firebase，
     你的裝置會跑到他的家庭去申請配對。
   - `FAMILY_ID` 也改成你自己的（英文、數字、底線），例如 `wang_family`。
3. **選擇要用的功能**：`config.js` 最下面的 `FEATURES`，不需要的改成 `false`（見下一節）。
4. **在手機上安裝**：照 `docs/SETUP.md` 第 5 步。第一台裝置會建立家庭、設定媽媽 PIN，
   孩子的名字在這時候輸入，之後也可以在設定裡改。
5. **（選用）推播通知與雲端功能**：升級 Blaze 後，照 [`docs/PUSH.md`](PUSH.md) 部署。部署前先確認：
   - `functions/index.js` 的 `REGION` 和你的 Firestore 位置相同（預設 `asia-east1` 台灣）。
   - `functions/index.js` 最下面的**排程時間**配合你家孩子的放學時間（見「排程」一節）。
   - 指令裡的 `你的專案ID` 換成你的 Firebase 專案 ID、GitHub 網址換成你自己的。
6. **在 App 裡設定**（⚙️ 設定）：每日固定事項、科目與顏色、兌換項目、點數規則、通知時間。
   課後小記和照顧紀錄預設不開，要用的話在設定裡開啟。

## 功能開關（config.js 的 FEATURES）

```js
export const FEATURES = {
  messages: true,   // 💬 留言板
  rewards: true,    // 🎁 兌換獎勵與目標
  words: true,      // 📖 每日單字
  journal: true,    // 📝 課後小記與週末記事錄整理
  care: true        // 🩺 照顧紀錄（媽媽記錄用藥、情緒、學習、睡眠）
};
```

- 改成 `false` 的功能，分頁、首頁卡片、設定區塊都不會出現，網址也進不去。
- **資料不會被刪除**，改回 `true` 就回來了。
- 改完 commit 到 GitHub，等 1～2 分鐘網頁更新後，在 App 的設定頁按「檢查更新」。
- 每日固定事項、排程、每日清單、點數是核心功能，沒有開關。

| 功能 | 不升級 Blaze 能用嗎 | 說明 |
|---|---|---|
| 清單、核可、點數、排程、本週進度、課程月曆 | ✅ | 核心功能 |
| 留言板、兌換獎勵、目標 | ✅ | 沒有推播，要打開 App 才看得到 |
| 每日單字 | ✅（裝置內建語音） | 自然的雲端語音需要 Blaze＋啟用 Text-to-Speech API |
| 課後小記、週末記事錄整理 | ⚠️ 可以寫，但**不會自動入帳** | 點數由雲端函式計算 |
| 照顧紀錄 | ✅（沒有提醒） | 早晚提醒需要雲端函式 |
| 推播通知、自動順延、指定時間提醒、每日提醒 | ❌ | 需要 Blaze＋部署雲端函式 |

## 排程（有部署雲端函式才需要看）

提醒和自動順延由排程每 30 分鐘檢查一次。為了省費用，孩子在學校時不執行。
預設是**週一、二、四、五 16:00 放學、週三中午放學**，在 `functions/index.js` 最下面：

```js
export const periodic = onSchedule({ schedule: '0,30 7,16-22 * * 1,2,4,5', timeZone: TZ }, runAll);   // 一二四五：07:00、07:30、16:00～22:30
export const periodicWednesday = onSchedule({ schedule: '0,30 7,12-22 * * 3', timeZone: TZ }, runAll); // 週三：07:00、07:30、12:00～22:30
export const periodicWeekend = onSchedule({ schedule: '0,30 7-22 * * 0,6', timeZone: TZ }, runAll);  // 週末：07:00～22:30
```

放學時間不同的話，改中間的小時（例如 `15-22` 代表 15:00 起）。最多保持 3 個排程：
Cloud Scheduler 每個帳單帳戶免費 3 個，第 4 個起每個每月約 US$0.10。

## 請 Claude 幫忙安裝

1. 先完成上面的步驟 1（Fork）。
2. 到 <https://claude.ai/code>，連上你的 GitHub，選擇你 Fork 的 `kids-progress`。
3. 把下面這段貼給 Claude，依你的需要修改：

```
這是一個給家長和孩子用的網頁 App（純 HTML/JS，Firebase，GitHub Pages）。
請先閱讀 docs/SHARE.md、docs/SETUP.md、docs/PUSH.md，然後一步一步帶我架設我自己的一份：

- 我的 Firebase 設定是：（貼上 Firebase 主控台的 firebaseConfig）
- 家庭代號用：（例如 wang_family）
- 我不需要的功能：（例如 每日單字、課後小記；沒有就寫「全部都要」）
- 孩子放學時間：（例如 週一到週五 16:00，週三 12:00）
- 我（要／不要）升級 Blaze 使用推播通知

請先列出要修改的檔案和每一步要我在 Firebase 主控台、GitHub、Cloud Shell 做什麼，等我確認後再開始修改。
需要我在瀏覽器操作的步驟，請一次說一步，等我回覆完成再繼續。
```

Claude 可以幫你修改 `config.js`、功能開關、排程時間，並提交到 GitHub；
在 Firebase 主控台建立專案、升級 Blaze、產生推播金鑰、在 Cloud Shell 執行部署指令，需要你自己在瀏覽器裡操作，Claude 會說明每一步。

## 常見問題

- **會看到原作者的資料嗎？** 不會。資料在各自的 Firebase 專案裡，換掉 `config.js` 之後完全分開。
- **之後原作者更新了，我要怎麼拿到？** 在你 Fork 的 GitHub 頁面按「Sync fork」。如果你改過同一個檔案，可能需要請 Claude 幫忙合併。
  有部署雲端函式的話，同步後要在 Cloud Shell 重新部署一次。
- **費用？** Firestore、匿名登入、GitHub Pages 在一般家庭的用量下免費。Blaze 的雲端函式用量很小，通常每月幾塊台幣以內；
  可以在 Google Cloud 主控台設定預算提醒。
