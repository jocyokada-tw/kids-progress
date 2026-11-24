// 功能開關：在 config.js 的 FEATURES 設定（沒寫的功能預設開啟）。
// 關掉的功能整個不顯示：分頁、首頁卡片、設定區塊、清單項目都不會出現。資料不會被刪除，之後打開就回來了。
import * as config from '../config.js';

const F = (config && config.FEATURES) || {};
export const feature = (name) => F[name] !== false;
