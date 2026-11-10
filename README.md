# 親子進度與點數 ⭐

給媽媽和兩個小孩在 iPhone／iPad 使用的 PWA：進度排程、每日檢查清單、點數流水帳、儀表板。
純 HTML／CSS／JavaScript（ES modules），不需要建置；後端為 Firebase Firestore，多台裝置即時同步。

- **安裝與發佈步驟**：[docs/SETUP.md](docs/SETUP.md)
- **資料結構與安全設計**：[docs/DATA.md](docs/DATA.md)
- **推播通知設定**：[docs/PUSH.md](docs/PUSH.md)

## 目前進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| 第一階段 | 身分選擇與裝置配對、進度排程（週／兩週）、每日清單、點數流水帳、儀表板 | ✅ 完成 |
| 第二階段 | 留言板（已讀）、課程（非學校行程）、科目顏色、兌換項目與紀錄、目標、本週進度（小孩自己排日期） | ✅ 完成 |
| 第三階段 | 推播通知（含勿擾時段、每日提醒）、離線提示與同步、新版更新提示 | ✅ 完成（推播需依 [docs/PUSH.md](docs/PUSH.md) 設定） |

## 檔案結構

```
index.html            唯一頁面（hash 路由）
manifest.json, sw.js  PWA 設定與 Service Worker
config.js             ← 填入你的 Firebase 設定
css/                  樣式（base：顏色變數；components：元件）
js/app.js             進入點：登入、裝置狀態、路由與權限保護
js/firebase.js        Firebase SDK（CDN）集中載入處
js/store/             資料層，每個集合一個檔案，全部使用 onSnapshot 即時監聽
js/views/             各畫面
js/utils/             日期（台灣時區）、PIN 雜湊
firestore.rules       Firestore 安全規則
firestore.indexes.json 需要的複合索引
functions/            推播通知（Firebase Cloud Functions，部署方式見 docs/PUSH.md）
tests/                安全規則與通知的自動測試（只在開發時用）
```
