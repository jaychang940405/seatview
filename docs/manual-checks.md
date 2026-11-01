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
| 9 | `section=B1&row=8&seat=18`，`mode=overview` 和 `mode=seat` 各一次 | 鳥瞰時座位上方有紅色倒錐；座位視角看不到它，畫面跟 #2 一樣 | ✅ | [鳥瞰](screenshots/08-marker-overview.jpg)／[座位](screenshots/09-marker-hidden-in-seat-view.jpg) |

### 發現並修正的問題

- **#4 鳥瞰取景**：原本相機繞 focus（舞台）轉，端台的舞台在場館一端，最靠近相機的 A1 大半被切出畫面下緣。改成繞「所有座位與 overlay」的中心轉，相機距離依 bounding sphere 半徑計算。
- **#9 dev server 全黑**：分兩次 Edit 改 viewer.ts（先加用法、再加 import）時，瀏覽器快取了 HMR 的中間版本，出現 `MARKER_LAYER is not defined`。typecheck、測試、build 都正常，server 提供的檔案也是新版；重啟 dev server 後就好了。這不是程式錯誤；畫面出問題時，先用 typecheck 和 build 排除程式本身的問題。

### 還沒檢查

- **效能**：用 DevTools Performance 量 FPS。大巨蛋模型只建了約 2.2–2.5 萬席（不是 4 萬），目視操作沒有卡頓，但還沒量化。
- **整體比例感**（看台斜度、舞台大小）：demo-arena 的尺寸是編出來的。大巨蛋的比例請見下面「還沒檢查」那一段。
- **build 警告**：bundle 超過 500 kB，主要是 three.js 本身；之後可以用動態 import 拆開。

## 2026-10-23（taipei-dome 方案 B，桌面 Browser pane 800×450）

這一輪改成方案 B 的看台（本壘弧 + 沿界外線的直線看台 + 與外野牆同心的外野弧，二層懸挑在一層上方）。
網址都要加上 `?venue=taipei-dome&`；截圖只用本專案自己的 render 畫面。對照用的平面圖：[dome-plan-b.svg](screenshots/dome-plan-b.svg)。

| # | 網址參數 | 預期 | 結果 | 截圖 |
|---|---|---|---|---|
| B1 | `layout=baseball&section=I1-HP&row=1&seat=29&mode=overview` | 跟平面圖一致：本壘後方是弧、兩側是沿界外線的直線看台、二層在一層外側上方、外野三段弧；本壘在內野菱形下方的頂點，界外線從本壘延伸到外野牆兩端 | ✅ 距離 18.6 m、俯角 10.5°、偏角 0.0° | [B1](screenshots/dome-b-01-baseball-overview.jpg) |
| B2 | `layout=concert&section=F1&row=1&seat=50&mode=overview` | 舞台在外野端；F1–F3 在舞台前；舞台後方沒有 O1-CF，外野左右兩區還在 | ✅ | [B2](screenshots/dome-b-02-concert-overview.jpg) |
| B3 | `layout=baseball&section=I2-HP&row=14&seat=71` | 二層最後一排中央：本壘在正中央，前方是二層前幾排 | ✅ 距離 50.8 m、俯角 26.4°、偏角 0.3° | [B3](screenshots/dome-b-03-baseball-i2hp-r14-s71.jpg) |
| B4 | `layout=baseball&section=I1-1B&row=15&seat=58` | 一壘側：本壘在中央、內野往右側延伸、左側是本壘後方看台 | ✅ 距離 42.5 m、俯角 11.3°、偏角 88.6° | [B4](screenshots/dome-b-04-baseball-i11b-r15-s58.jpg) |

**之前截圖的「外野牆端點接到本壘」「內野菱形不在界外線交點」**：這次對照確認不是 render 或資料的錯，而是畫面上的錯覺。

- 從本壘連到外野牆兩端的是**界外線**，外野牆的端點本來就是界外桿。
- 一壘、三壘依規則就在界外線上，所以菱形下方兩條邊跟界外線重疊，看起來像界外線從菱形側邊的頂點出發。
- 這次加了不變量從數字確認：界外線終點 = 外野牆端點（座標相等、左右沒接反）、一壘與三壘在界外線上、本壘 = 菱形第一個頂點 = 界外線起點。

## 2026-10-23（taipei-dome 第一版：同心圓弧看台，已被方案 B 取代）

以下是第一版的紀錄，保留作為對照。預期值來自當時的 `docs/venue-taipei-dome.md`。

| # | 網址參數 | 預期 | 結果 | 截圖 |
|---|---|---|---|---|
| D1 | `layout=baseball&section=I1-HP&row=1&seat=91&mode=overview` | 本壘在下、中外野在上；一壘側（+x）在右；看得到界外線、外野牆圓弧、內野、投手丘；二層在外圈 | ✅ | [D1](screenshots/dome-01-baseball-overview.jpg) |
| D2 | `layout=baseball&section=I1-HP&row=1&seat=91` | 本壘後方：本壘在畫面中央；水平偏角 ≈ 0 | ✅ 距離 19.4 m、俯角 10.1°、偏角 0.8° | [D2](screenshots/dome-02-baseball-i1hp-r1-s91.jpg) |
| D3 | `layout=baseball&section=I1-1B&row=8&seat=100` | 一壘側：水平偏角 > 0，內野往畫面右側延伸 | ✅ 偏角 +107.9°、距離 82.4 m | [D3](screenshots/dome-03-baseball-i11b-r8-s100.jpg) |
| D4 | `layout=baseball&section=O1-CF&row=1&seat=72` | 中外野：水平偏角 ≈ ±180 | ✅ 偏角 179.9°、距離 139.0 m | [D4](screenshots/dome-04-baseball-o1cf-r1-s72.jpg) |
| D5 | `layout=concert&section=F1&row=1&seat=50&mode=overview` | 舞台在外野端；F1–F3 在舞台前；舞台後方沒有 O1-CF | ✅ | [D5](screenshots/dome-05-concert-overview.jpg) |
| D6 | `layout=concert&section=F1&row=1&seat=50` | 比舞台低：俯角為負；水平偏角 ≈ 0 | ✅ 俯角 −10.8°、偏角 −1.2°（舞台正面擋住大半畫面） | [D6](screenshots/dome-06-concert-f1-r1-s50.jpg) |
| D7 | `layout=concert&section=I2-HP&row=7&seat=115` | 最遠的內野二層：舞台在遠方正中央 | ✅ 距離 155.8 m、偏角 0.1° | [D7](screenshots/dome-07-concert-i2hp-r7-s115.jpg) |
| D8 | `layout=concert&section=O1-CF&row=1&seat=1` | 不開放 | ✅ `SECTION_NOT_IN_LAYOUT`，下面附免責聲明 | — |
| D9 | `layout=baseball&section=F1&row=1&seat=1` | 搖滾區只在演唱會 | ✅ `SECTION_NOT_IN_LAYOUT` | — |
| D10 | `layout=baseball&section=O2-RF&row=1&seat=1` | 沒有建模的區（外野二層） | ✅ `UNKNOWN_SECTION`，不編資料 | — |
| D11 | 以上任一頁 | 資訊列顯示免責聲明；concert 顯示「暫定假設」 | ✅ | — |

### 還沒檢查

- **比例感**：第一版在短向比 OSM 外框寬，已由方案 B 修正（看台全部在外框摘要內、留空 ≥ 3 m）。
- **效能**：還沒量化。

## 照片佐證（2026-10-23，自己拍攝，照片不放進 repo）

| 照片 | 位置 | 從椅背標籤與畫面讀到的 | 用途 |
|---|---|---|---|
| 棒球 | 113 區 20 排 11 號（本人坐） | 前排標籤為 19 排，座號 09–14，面向場地時往左增加；兩根界外桿對稱落在畫面左右邊緣；畫面上緣只見屋頂網架，未見混凝土底面 | 抽查座號方向、位置（本壘後方中央附近） |
| 演唱會 ×2 | 114 區（B1 層）12 排 11 號，2026/3/20（本人坐） | 前排標籤為 08、09 排，座號 08–10，面向場地時往左增加；推得拍攝排約 9–10，與票面差 2–3 排 | 位置抽查（±3 排） |
| 其他 | 走動時拍攝，位置與層別不詳 | 部分照片可見 26、27 排標籤（某處至少有 27 排） | 僅目視參考，不進任何數字 |

限制：
- 沒有原檔，焦段不明，不做姿態估計。
- 位置確定的只有 2 個座位，只做抽查，不做參數擬合，也不拿來調整任何 C 級參數。
- 座號往左增加只有 113、114 區的佐證，其他區（含外野）沒有證據。