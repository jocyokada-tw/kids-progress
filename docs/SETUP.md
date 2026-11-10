# 安裝、發佈與測試

整個流程大約 20 分鐘。只需要瀏覽器；用 Firebase CLI 部署規則是選用的。

---

## 1. 建立 Firebase 專案

1. 到 <https://console.firebase.google.com> →「新增專案」（Google Analytics 可以不開）。
2. **Firestore Database** →「建立資料庫」→ 選擇位置（建議 `asia-east1` 台灣）→ 先選「正式版模式」。
3. **Authentication** →「開始使用」→「登入方式」→ 啟用 **匿名**。
4. **專案設定（齒輪）→ 一般 → 你的應用程式** → 按 `</>` 新增網頁應用程式（不用勾 Hosting）。
   複製畫面上的 `firebaseConfig`。
5. **Authentication → 設定 → 已授權網域**：加入 `你的帳號.github.io`。

## 2. 填寫 config.js

打開 repo 根目錄的 `config.js`，把剛剛複製的值貼進去：

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "xxx.firebaseapp.com",
  projectId: "xxx",
  storageBucket: "xxx.appspot.com",
  messagingSenderId: "123",
  appId: "1:123:web:abc"
};
export const FAMILY_ID = "home";
```

> 這些值公開在網頁上是正常的，Firebase 本來就是這樣設計。資料的保護靠下一步的安全規則。

## 3. 部署安全規則與索引（一定要做）

**方法 A：用主控台（不用安裝任何東西）**
1. Firestore Database →「規則」分頁 → 把 `firestore.rules` 的全部內容貼上 →「發布」。
2. Firestore Database →「索引」→「複合」→「建立索引」：
   - 集合 ID：`tasks`
   - 欄位：`kidId` 遞增、`date` 遞增
   - 查詢範圍：集合
   （或者先不建；第一次打開排程時，瀏覽器主控台的錯誤訊息會附上一鍵建立的連結。）

**方法 B：Firebase CLI**

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase deploy --only firestore --project 你的專案ID
```

## 4. 發佈到 GitHub Pages

1. 把 `config.js` 的修改 commit 並 push 到要發佈的分支（例如 `main`）。
2. GitHub repo →「Settings」→「Pages」：
   - Source：**Deploy from a branch**
   - Branch：`main`，資料夾 `/ (root)` → Save
3. 等 1～2 分鐘，網址會是 `https://你的帳號.github.io/kids-progress/`。

> **之後每次更新程式**：請把 `sw.js` 最上面的 `VERSION` 改大一號（例如 `'v2'`），
> 已安裝的手機才會抓到新版。裝置上通常需要關掉 App 再打開一次（有時要兩次）。

## 5. 在手機上安裝與測試

### 第一台：媽媽的 iPhone
1. 用 **Safari** 打開 GitHub Pages 網址。
2. 點下方「分享」→「**加入主畫面**」→ 新增。
3. **從主畫面的圖示打開**（重要：iOS 的主畫面 App 和 Safari 的資料是分開的，配對要在主畫面 App 裡做）。
4. 出現「歡迎！第一次使用」→ 輸入兩個小孩的名字、設定媽媽 PIN →「建立家庭」。
5. 選「媽媽」進入 → 到 ⚙️ 設定 → 新增每日固定事項（例如刷牙 1 點、閱讀 2 點）。

### 其他裝置：小孩的 iPad／iPhone
1. 一樣用 Safari 打開網址 → 加入主畫面 → 從主畫面圖示打開。
2. 輸入裝置名稱 →「產生配對代碼」→ 畫面顯示 4 位數代碼。
3. 媽媽的裝置：⚙️ 設定 → 裝置管理 → 核對代碼 → 選「○○的裝置」或「兩個小孩共用」→「核可配對」。
4. 小孩的裝置會自動進入。

### 建議的測試流程（兩台並排看即時同步）
| 步驟 | 小孩裝置 | 媽媽裝置 |
|---|---|---|
| 1 | 排程 → ＋ → 新增「練琴」→ 送出 | 首頁出現「1 項進度待確認」 |
| 2 | | 排程 → 點「練琴」→ 設定點數、寫建議 →「確認並儲存」 |
| 3 | 排程上變成已確認，點開看得到媽媽的建議；今日清單多出「練琴」 | |
| 4 | 清單 → 勾選全部項目（顯示「待核可」） | 清單分頁出現紅色數字 |
| 5 | | 清單 →「全部核可」→ 出現全部完成獎勵 |
| 6 | 首頁點數即時增加；點數頁看得到每一筆紀錄 | |

### 要再加一台媽媽的裝置？
新裝置一樣申請配對，在媽媽裝置核可時選「媽媽的裝置」。第一次進入媽媽模式會要求輸入 PIN，之後這台就會記住。

---

## 推播通知

請看 [docs/PUSH.md](PUSH.md)：升級 Blaze 方案、產生推播金鑰、用 Cloud Shell 部署一次。部署之後，安全規則也會一起發布，不用再手動貼。

## 更新版本時

- **`firestore.rules` 有改動時**（例如第二階段新增留言、兌換），要重新到 Firestore「規則」分頁貼上並發布，否則新功能會出現「沒有權限」。
- `sw.js` 的 `VERSION` 改大一號後，手機上把 App 完全關掉再打開，就會換成新版。

## 常見問題

- **合併後網站沒有更新（GitHub 寄來「pages build and deployment … failed」）**：通常是 GitHub 發佈服務暫時出問題，不是程式錯誤。
  到 repo 的「Actions」→ 點那次失敗的「pages build and deployment」→ 右上角「Re-run all jobs」。
  如果重跑後一直卡在排隊，合併下一個 PR（任何新的 commit 到 `main`）就會重新發佈；也可以到 <https://www.githubstatus.com> 看 Pages 是否故障。

- **畫面顯示「尚未設定 Firebase」**：`config.js` 沒填好或沒 push。
- **出現「沒有權限」**：安全規則沒有發布，或這台裝置被移除了（重新配對即可）。
- **出現「資料庫缺少索引」**：依第 3 步建立 `tasks` 的複合索引（建立需要幾分鐘）。
- **小孩裝置一直停在配對畫面**：確認是從「主畫面圖示」打開，不是 Safari。
- **媽媽換了手機／所有媽媽裝置都遺失**：到 Firebase 主控台 → Firestore →
  `families/home/devices`，把新裝置的申請文件（在 `pairRequests` 裡，文件 ID 就是裝置 ID）
  手動複製成一筆 `devices/{同樣的 ID}`，欄位 `isMom: true`、`kids: ["kidA","kidB"]`。
- **忘記 PIN**：到 Firebase 主控台 → Firestore → 刪除 `families/home/private/pin` 這份文件。
  之後在任一台**媽媽裝置**上選「媽媽」，就會請你設定新的 PIN。（小孩裝置沒有權限做這件事。）

## 開發者：本機測試

只需要一個靜態伺服器；網址加上 `?emulator` 會改連本機的 Firebase 模擬器，不會碰到正式資料。

```bash
python3 -m http.server 5173
```

```bash
npx firebase-tools emulators:start --project demo-kids
```

然後打開 `http://127.0.0.1:5173/?emulator`。

安全規則自動測試（29 項，涵蓋配對、任務、本週進度、清單、流水帳、課程、兌換、留言、推播權杖的權限）：
通知觸發測試（12 項）的執行方式寫在 `tests/functions.test.mjs` 開頭。


```bash
cd tests && npm install && npm run test:rules
```

> 注意：PIN 雜湊使用 Web Crypto，只能在 `https` 或 `localhost`／`127.0.0.1` 下運作，
> 所以手機請直接用 GitHub Pages 的 https 網址測試，不要用區網 IP。
