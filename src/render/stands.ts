import * as THREE from "three";
import type { Venue } from "../core/schema";

/**
 * 看台第一排前緣的護欄（m）。C 級：一般看台護欄的高度量級。
 * 大巨蛋實際是玻璃、欄杆還是實心牆不知道，所以畫成半透明：表示「這裡有護欄」，不斷定它擋住多少視線。
 */
export const PARAPET = { height: 0.8, opacity: 0.3 } as const;

/** 踏面（朝上的面）與踢面、牆面、底面的顏色：淺灰與深灰，不靠陰影也看得出一階一階。 */
export const STAND_COLORS = { tread: new THREE.Color("#8f949c"), side: new THREE.Color("#5f646c") } as const;

/**
 * 這個 layout 開放的區的看台：每區一個實體 "stand:<id>"，升高的看台再加一道護欄 "parapet:<id>"。
 * 踏面的形狀、高度全部來自 core 的 sectionTreads；在地面、不升高的區（搖滾區）沒有看台。
 */
export function buildStands(_venue: Venue, _layoutId: string): THREE.Group {
  throw new Error("not implemented");
}
