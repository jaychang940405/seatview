# 人工目視檢查清單

unit test 涵蓋的是座標、相機投影、左右鏡像、場景裡有哪些物件；這份清單補上**只能用眼睛確認**的部分。
render 有改動時重新跑一次，在「結果」欄記錄日期。

**怎麼跑**：`npm run dev`，打開 `http://localhost:5173/`，用網址參數切換座位：

```
?layout=concert&section=A1&row=1&seat=16&mode=seat
```

`mode=overview` 是鳥瞰模式，可以拖曳旋轉。

## 2026-10-23（demo-arena，桌面 Browser pane 775×638；手機 375×812）

| # | 網址參數 | 預期 | 結果 | 截圖 |
|---|---|---|---|---|
| 1 | （預設）A1 第 1 排 16 號 | 舞台在正中央，搖滾區 F1 在舞台前下方；資訊列顯示距離 60.0 m、俯角 1.1°、水平偏角 0.0° | ✅ console 無錯誤 | [01](screenshots/01-a1-r1-s16-concert.jpg) |
| 2 | `section=B1&row=8&seat=18` | 從側面看舞台；F1 在左、自己這區在右下；水平偏角為正（觀眾右手邊） | ✅ 偏角 54.9° | [02](screenshots/02-b1-r8-s18-concert.jpg) |
| 3 | `section=F1&row=1&seat=20` | 比舞台低：舞台正面擋住下半部；俯角為負 | ✅ 俯角 −10.2° | [03](screenshots/03-f1-r1-s20-concert.jpg) |
| 4 | `mode=overview` | 整個場館入鏡；B1 在右側（跟鏡像測試一致） | ✅（修正後） | [修正前](screenshots/04a-overview-before-fix.jpg)／[修正後](screenshots/04b-overview-concert.jpg) |
| 5 | `layout=baseball&mode=overview` | F1 和舞台消失；距離變成 55.1 m | ✅ | [05](screenshots/05-overview-baseball.jpg) |
| 6 | `layout=baseball&section=F1&row=1&seat=1` | 顯示錯誤而不是白畫面 | ✅ `SECTION_NOT_IN_LAYOUT：F1 區在 baseball layout 沒有開放` | — |
| 7 | 手機 375×812，預設座位 | 舞台沒被左右切掉：寬度約佔畫面 45%（水平 FOV 50°） | ✅ 約 47%；canvas 750×1624（HiDPI 2×） | [06](screenshots/06-mobile-375x812.jpg) |
| 8 | `mode=overview`，拖曳 | 視角跟著旋轉，放開後畫面停在新角度 | ✅ | [07](screenshots/07-overview-orbit.jpg) |

### 發現並修正的問題

- **#4 鳥瞰取景**：原本相機繞 focus（舞台）轉，端台的舞台在場館一端，最靠近相機的 A1 大半被切出畫面下緣。改成繞「所有座位與 overlay」的中心轉，相機距離依 bounding sphere 半徑計算。

### 還沒檢查

- **效能**：等台北大巨蛋（約 4 萬席）完成後，用 DevTools Performance 量 FPS。
- **整體比例感**（看台斜度、舞台大小）：demo-arena 的尺寸是編出來的，等真實場館再對照照片判斷。
- **build 警告**：bundle 超過 500 kB，主要是 three.js 本身；之後可以用動態 import 拆開。
