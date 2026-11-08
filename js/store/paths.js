import { db, collection, doc } from '../firebase.js';
import { FAMILY_ID } from '../../config.js';

// 所有資料都放在 families/{FAMILY_ID}/... 底下
export const familyRef = () => doc(db, 'families', FAMILY_ID);
export const fcol = (name) => collection(db, 'families', FAMILY_ID, name);
export const fdoc = (name, id) => doc(db, 'families', FAMILY_ID, name, id);

/** 把 snapshot 轉成 [{id, ...data}] */
export const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/** 時間戳記排序用（尚未寫入伺服器的時間視為「現在」） */
export const tsMillis = (ts) => (ts && ts.toMillis ? ts.toMillis() : Date.now());
