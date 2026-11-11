# 資料結構與安全設計

所有資料都放在 `families/{FAMILY_ID}/` 底下（預設 `families/home`）。日期一律是台灣時間的 `YYYY-MM-DD` 字串。

## 集合一覽

| 路徑 | 說明 | 主要欄位 |
|---|---|---|
| `families/{fid}` | 家庭本身 | `setupBy`（建立者裝置 uid）, `createdAt` |
| `devices/{uid}` | **已配對的裝置**（權限的依據） | `isMom`, `kids: ['kidA', …]`, `label`, `pairedAt` |
| `pairRequests/{uid}` | 等待媽媽核可的裝置 | `code`（4 位數）, `label`, `createdAt` |
| `members/{mom\|kidA\|kidB}` | 使用者（媽媽與小孩） | `role`, `name`, `emoji`, `color`, `goal: {title, emoji, points, rewardId}`（目標，只有媽媽能設定） |
| `meta/settings` | 點數規則、科目、通知 | `bonusAllDone`（全部完成獎勵）, `defaultTaskPoints`, `subjects: [{id, name, color}]`, `notify: {mom:{…}, kid:{…}, quietStart, quietEnd, dailyTime}` |
| `private/pin` | 媽媽 PIN（PBKDF2 雜湊＋鹽） | `hash`, `salt`, `updatedAt` |
| `tasks/{id}` | 進度（任務） | `kidId`, `date`（本週進度未排時為空字串）, `kind: weekly`（本週進度才有）, `week`／`weekEnd`（該週週一／週日）, `itemApproved`, `title`, `note`, `subject`, `points`, `createdBy: mom\|kid`, `status: pending\|approved\|rejected`, `momNote`（媽媽的建議） |
| `routines/{id}` | 每日固定事項 | `kidId`, `title`, `points`, `weekdays: [0-6]`, `active`, `order` |
| `items/{kidId}_{date}_{sourceId}` | 每日清單項目 | `kidId`, `date`, `sourceType: task\|routine`, `sourceId`, `title`, `points`, `done`, `doneAt`, `review: none\|pending\|approved\|returned`, `returnNote` |
| `ledger/{id}` | **點數流水帳** | `kidId`, `amount`（可為負）, `type: task\|bonus\|adjust\|redeem`, `title`, `date`, `refId`, `createdAt`, `createdBy` |

| `events/{id}` | 課程（非學校行程，沒有點數） | `kidId`, `title`, `subject`, `start`, `end`（HH:MM）, `repeat: weekly\|once`, `weekdays`, `from`, `until`, `date`, `skipDates`（只取消某一次）, `note` |
| `rewards/{id}` | 兌換項目 | `title`, `emoji`, `cost`, `active` |
| `redemptions/{id}` | 兌換申請與紀錄 | `kidId`, `rewardId`, `title`, `emoji`, `cost`, `status: pending\|approved\|rejected\|cancelled`, `momNote`, `createdAt`, `decidedAt` |
| `pushTokens/{uid}` | 裝置的推播權杖（只有伺服器會讀） | `token`, `ua`, `updatedAt` |
| `pushQueue/{id}` | 勿擾時段暫存的通知（伺服器專用） | `who`, `title`, `body`, `url`, `tag`, `createdAt` |
| `meta/pushState` | 每日提醒是否已發（伺服器專用） | `lastDaily` |
| `wordLists/{id}` | 單字字庫 | `name`, `kind: cram\|general`（補習班／一般字庫）, `kids[]`, `testDate`（補習班考試日）, `count`, `active` |
| `wordLists/{id}/chunks/{n}` | 字庫內容（每 200 字一份） | `words: [{w, pos, zh, ex}]`（`pos` 詞性可省略，只顯示不考） |
| `wordProgress/{kidId}` | 單字學習進度 | `w: { 單字: { b: 熟練度 0–6, d: 下次複習日, n: 練習次數, x: 答錯次數, t: 學會日 } }` |
| `wordSessions/{kidId}_{日期}` | 當天的單字練習 | `kidId`, `date`, `newWords[]`, `reviewWords[]`, `wrong[]`, `finished`, `perfect` |
| `threads/{kidId}` | 對話串的已讀時間 | `momReadAt`, `kidReadAt` |
| `threads/{kidId}/messages/{id}` | 留言 | `from: mom\|kid`, `text`（最多 500 字）, `createdAt` |

## 流程

**進度**：媽媽新增的進度直接是 `approved`；小孩新增的進度是 `pending`、0 點，等媽媽確認後才會有點數，也才會出現在清單上。
媽媽可以在確認時修改內容、日期、點數，並留下 `momNote`，小孩看得到。

**本週進度**：媽媽只訂內容、科目和點數，指定是哪一週（`kind: 'weekly'`, `date: ''`）。
小孩在排程上方的「📦 本週待安排」選一天，把 `date` 填上，不需要媽媽再確認；之後就和一般進度一樣進入每日清單。
日期排定後小孩不能自己改（避免為了「全部完成獎勵」把做不完的進度挪走）；媽媽可以「退回重排」把日期清空，小孩再重新選。入帳後 `itemApproved = true`。
過了那週還沒排的會標示「逾期未安排」，由媽媽移到本週、下週或刪除。

**每日清單**：打開某天的清單時，App 會把「當天已確認的進度」和「符合星期的固定事項」合併，缺少的項目就建立。
項目 ID 固定為 `{kidId}_{date}_{sourceId}`，所以兩台裝置同時打開也不會重複。
媽媽裝置還會順便同步「被改名、改點數、刪除」的來源；已入帳的項目永遠不會被動到。

**點數**：
1. 小孩勾選 → 項目變成 `pending`（顯示「待核可」，還不算點數）。送出後小孩不能取消，只有媽媽能退回。
2. 媽媽核可 → 在**同一個交易**裡把項目改成 `approved`，並新增一筆流水帳 `ledger/task_{itemId}`。
   流水帳 ID 固定，所以重複按也只會入帳一次。
3. 當天所有項目都核可後，新增 `ledger/bonus_{kidId}_{date}`（每天最多一次）。
4. 媽媽退回 → 項目回到未完成並附上原因，不會產生流水帳。

**目前點數 = 該小孩所有流水帳 `amount` 的總和**。沒有任何地方存放「總點數」，所以：
- 每一點都查得到來源（哪一天、哪個項目、誰核可）。
- 要更正只能新增一筆 `adjust`（手動調整，需填原因），舊紀錄不會被改寫。
- 兌換核可時新增一筆負數的 `redeem` 紀錄（ID 固定為 `redeem_{申請ID}`，不會重複扣點）。

**兌換（先預留點數）**：
1. 小孩申請兌換 → `redemptions` 新增一筆 `pending`。
2. 「可用點數 = 目前點數 − 所有申請中的點數」，可用點數不夠就不能再申請。
3. 媽媽核可 → 同一個交易中把申請改成 `approved`，並寫入負數流水帳；媽媽退回或小孩取消 → 預留的點數自動釋放。

**目標**：媽媽在設定中為每個小孩設定目標（名稱、圖示、點數），小孩首頁與點數頁顯示「目前點數／目標點數，還差 N 點」。

**每日單字**：
- 每天學 `settings.words.perDay` 個新字（預設 5）。補習班單字（考試日未過）優先，不足的用一般字庫依順序補滿。
- 複習依遺忘曲線：答對後熟練度 +1，隔 1、2、4、7、15、30、60 天再考；答錯回到熟練度 0、隔天再考。每天最多複習 20 個到期的字。
- 補習班考前一天與當天，學過的字整份複習。
- 流程：新字卡（發音、中文、例句）→ 選意思 → 全部拼字。答錯的題目會排到最後再考一次，直到答對。
- 第一次答錯就寫進 `wordSessions.wrong`，中途離開重來也不會消失；完成時 `wrong` 是空的才算 `perfect`。
- 完成後自動把清單項目 `items/{kidId}_{日期}_words` 標成待核可（點數 `settings.words.points`）；媽媽核可時若 `perfect`，同一個交易多寫一筆 `ledger/wordbonus_…`（`settings.words.perfectBonus`）。
- 發音使用裝置內建的語音朗讀，不需要網路。

**留言已讀**：打開對話時更新自己的 `momReadAt`／`kidReadAt`；我傳的訊息若 `createdAt` 早於對方的讀取時間，就顯示「已讀」。

## 安全規則重點（`firestore.rules`）

**身分**：每台裝置以 Firebase 匿名登入取得固定的 uid。只有在 `devices/{uid}` 存在時才算「已配對」。
媽媽 PIN 只是媽媽裝置上的介面鎖，真正的權限由裝置配對決定，所以小孩無法靠繞過介面取得權限。

| 誰 | 可以做 |
|---|---|
| 未登入 | 什麼都不行 |
| 未配對裝置 | 只能查詢家庭是否存在、送出／取消**自己的**配對申請、讀自己的裝置文件 |
| 第一台裝置 | 家庭尚未存在時，可以用一次批次寫入建立家庭並成為媽媽裝置（家庭已存在就不行） |
| 小孩裝置 | 只能讀寫 `kids` 清單內小孩的資料；本週進度只能把還沒排的排到同一週的某一天，排定後不能自己改；課程、兌換項目只能看；兌換申請的點數必須等於兌換項目的點數，只能取消自己申請中的項目，不能自己核可；留言只能以「小孩」身分發言、不能修改或刪除，已讀只能更新 `kidReadAt`；新增的進度必須是 `pending`、0 點；只能修改／刪除自己尚未確認的進度；清單項目只能勾選送出（`review` 改成 `pending`），送出後不能自己取消、不能自己核可，只有媽媽能退回；補建清單項目時，點數必須和媽媽設定的來源一致；**不能**寫入流水帳、設定、成員、固定事項；讀不到 PIN 雜湊 |
| 媽媽裝置 | 全部可讀寫，**但流水帳只能新增，任何人都不能修改或刪除** |

`tests/rules.test.mjs` 有 33 項自動測試驗證上述規則；`tests/srs.test.mjs` 有 7 項測試驗證單字解析與遺忘曲線排程；`tests/functions.test.mjs` 有 12 項測試驗證通知的觸發、對象、勿擾時段與每日提醒。

**推播**：每台裝置開啟通知後，把權杖寫到 `pushTokens/{自己的uid}`（只能寫自己的、任何用戶端都讀不到）。
伺服器依 `devices` 判斷對象：媽媽的通知送到 `isMom` 的裝置；小孩的通知送到配對給該小孩、且不是媽媽的裝置。

## 索引

| 集合 | 欄位 | 用途 |
|---|---|---|
| `tasks` | `kidId` ↑, `date` ↑ | 排程與「一個月內行程」的日期範圍查詢 |

其他查詢都只有等號條件，Firestore 不需要額外索引。
