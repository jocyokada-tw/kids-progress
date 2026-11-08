# 資料結構與安全設計

所有資料都放在 `families/{FAMILY_ID}/` 底下（預設 `families/home`）。日期一律是台灣時間的 `YYYY-MM-DD` 字串。

## 集合一覽

| 路徑 | 說明 | 主要欄位 |
|---|---|---|
| `families/{fid}` | 家庭本身 | `setupBy`（建立者裝置 uid）, `createdAt` |
| `devices/{uid}` | **已配對的裝置**（權限的依據） | `isMom`, `kids: ['kidA', …]`, `label`, `pairedAt` |
| `pairRequests/{uid}` | 等待媽媽核可的裝置 | `code`（4 位數）, `label`, `createdAt` |
| `members/{mom\|kidA\|kidB}` | 使用者（媽媽與小孩） | `role`, `name`, `emoji`, `color` |
| `meta/settings` | 點數規則 | `bonusAllDone`（全部完成獎勵）, `defaultTaskPoints` |
| `private/pin` | 媽媽 PIN（PBKDF2 雜湊＋鹽） | `hash`, `salt`, `updatedAt` |
| `tasks/{id}` | 進度（任務） | `kidId`, `date`, `title`, `note`, `points`, `createdBy: mom\|kid`, `status: pending\|approved\|rejected`, `momNote`（媽媽的建議） |
| `routines/{id}` | 每日固定事項 | `kidId`, `title`, `points`, `weekdays: [0-6]`, `active`, `order` |
| `items/{kidId}_{date}_{sourceId}` | 每日清單項目 | `kidId`, `date`, `sourceType: task\|routine`, `sourceId`, `title`, `points`, `done`, `doneAt`, `review: none\|pending\|approved\|returned`, `returnNote` |
| `ledger/{id}` | **點數流水帳** | `kidId`, `amount`（可為負）, `type: task\|bonus\|adjust\|redeem`, `title`, `date`, `refId`, `createdAt`, `createdBy` |

第二階段會再加入：`rewards/{id}`（兌換項目）、`redemptions/{id}`（兌換紀錄）、`threads/{kidId}/messages/{id}`（留言）。

## 流程

**進度**：媽媽新增的進度直接是 `approved`；小孩新增的進度是 `pending`、0 點，等媽媽確認後才會有點數，也才會出現在清單上。
媽媽可以在確認時修改內容、日期、點數，並留下 `momNote`，小孩看得到。

**每日清單**：打開某天的清單時，App 會把「當天已確認的進度」和「符合星期的固定事項」合併，缺少的項目就建立。
項目 ID 固定為 `{kidId}_{date}_{sourceId}`，所以兩台裝置同時打開也不會重複。
媽媽裝置還會順便同步「被改名、改點數、刪除」的來源；已入帳的項目永遠不會被動到。

**點數**：
1. 小孩勾選 → 項目變成 `pending`（顯示「待核可」，還不算點數）。
2. 媽媽核可 → 在**同一個交易**裡把項目改成 `approved`，並新增一筆流水帳 `ledger/task_{itemId}`。
   流水帳 ID 固定，所以重複按也只會入帳一次。
3. 當天所有項目都核可後，新增 `ledger/bonus_{kidId}_{date}`（每天最多一次）。
4. 媽媽退回 → 項目回到未完成並附上原因，不會產生流水帳。

**目前點數 = 該小孩所有流水帳 `amount` 的總和**。沒有任何地方存放「總點數」，所以：
- 每一點都查得到來源（哪一天、哪個項目、誰核可）。
- 要更正只能新增一筆 `adjust`（手動調整，需填原因），舊紀錄不會被改寫。
- 第二階段的兌換會新增一筆負數的 `redeem` 紀錄。

## 安全規則重點（`firestore.rules`）

**身分**：每台裝置以 Firebase 匿名登入取得固定的 uid。只有在 `devices/{uid}` 存在時才算「已配對」。
媽媽 PIN 只是媽媽裝置上的介面鎖，真正的權限由裝置配對決定，所以小孩無法靠繞過介面取得權限。

| 誰 | 可以做 |
|---|---|
| 未登入 | 什麼都不行 |
| 未配對裝置 | 只能查詢家庭是否存在、送出／取消**自己的**配對申請、讀自己的裝置文件 |
| 第一台裝置 | 家庭尚未存在時，可以用一次批次寫入建立家庭並成為媽媽裝置（家庭已存在就不行） |
| 小孩裝置 | 只能讀寫 `kids` 清單內小孩的資料；新增的進度必須是 `pending`、0 點；只能修改／刪除自己尚未確認的進度；清單項目只能改 `done`／`review`（只能改成 `pending` 或 `none`，不能自己核可，已入帳的不能取消）；補建清單項目時，點數必須和媽媽設定的來源一致；**不能**寫入流水帳、設定、成員、固定事項；讀不到 PIN 雜湊 |
| 媽媽裝置 | 全部可讀寫，**但流水帳只能新增，任何人都不能修改或刪除** |

`tests/rules.test.mjs` 有 17 項自動測試驗證上述規則。

## 索引

| 集合 | 欄位 | 用途 |
|---|---|---|
| `tasks` | `kidId` ↑, `date` ↑ | 排程與「一個月內行程」的日期範圍查詢 |

其他查詢都只有等號條件，Firestore 不需要額外索引。
