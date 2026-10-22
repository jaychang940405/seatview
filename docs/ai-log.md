# AI Collaboration Log

格式：日期｜問題｜AI 建議｜我的取捨

---

## 2026-10-23｜場館 JSON schema 與 core 函式簽名

**問題**：在寫任何程式之前，先定下場館資料格式和 `src/core/` 的函式介面，之後加棒球版時才不用改簽名。

**AI 建議**

1. **座標慣例**
   - 單位用公尺；JSON 和輸出的角度用「度」，內部計算才轉弧度。
   - 3D 用 Y 向上（跟 three.js 一樣），地板 y = 0，原點在場館中心。
   - 平面圖 (x, z) 用 x 向右、z 向下，跟 SVG／螢幕座標一樣。平面角度從 +x 轉向 +z 為正，在平面圖上是順時針。
   - 理由：從自己畫的平面圖量到的座標可以直接填，不會左右鏡像。
2. **用參數描述一區，不逐席列座標**
   - 兩種區：`arc`（圓心、第 1 排半徑、fromDeg→toDeg）和 `linear`（第 1 排前緣 from→to，加上 `facing` 指定面對哪個點）。
   - 共用欄位：`rows`、`seatsPerRow`（數字或每排一個的陣列）、`rowDepth`、`rowRise`、`baseHeight`。
   - 座位中心在 t = (s − 0.5) / n：from/to 是區塊邊緣，平面圖上最好量。
   - 代價：形狀不規則的區要拆成多區。
3. **區有沒有開放，標在 section 的 `layouts?`（白名單，省略代表全部 layout 都有）**
   - 看台是建築，所有 layout 共用；搖滾區是活動配置，標 `["concert"]`。
   - 新增棒球版只要加 layout，看台不用改。
   - `seatPosition(venue, section, row, seat)` 可以維持 CLAUDE.md 的簽名：它只算幾何，開放檢查交給 `getSeatView`。
4. **`Focus` 加 `facingDeg`（舞台正面朝向）**：只有一個點算不出正對還是側邊，水平偏角需要它。
5. **用 zod 寫 schema**
   - 一份定義同時得到執行期驗證和 TS 型別（`z.infer`）。
   - 能抓到手打 JSON 的錯，例如 seatsPerRow 長度不符、facing 落在前緣線上。
   - MCP SDK 本來就要 zod，不算多加依賴。
6. **core 多出三個函式：`getSeatView`、`listSections`、`parseVenue`**
   - `getSeatView` 把「查區 → 座位 → 相機 → 指標」包成一個呼叫，UI 和 MCP 共用，兩邊數字不會不一致。
   - 錯誤統一丟 `SeatViewError`，帶 `code`：`UNKNOWN_LAYOUT` / `UNKNOWN_SECTION` / `SECTION_NOT_IN_LAYOUT` / `ROW_OUT_OF_RANGE` / `SEAT_OUT_OF_RANGE`。
7. **正負號定義**（CLAUDE.md 原本沒寫，最容易出 bug）
   - `elevationAngle(eye, target)`：正值代表比目標高、往下看。
   - `horizontalAngle(eye, focus)`：範圍 (−180, 180]；0 是正對；正值是觀眾面向舞台時的右手邊；180 是舞台正後方；在正上方時回傳 0。
   - `cameraPose` 的眼高預設 1.2 m（坐姿）。
8. **v1 刻意不做**（之後加選填欄位就好，不改簽名）：
   - 字母排號、單雙號分邊、`hiddenSections`
   - 遮蔽判斷、不等斜度看台

**我的取捨**
- 座標慣例、三處調整（section `layouts?`、`Focus.facingDeg`、core 新增的函式）和 zod 全部同意。
- 要求 `demo-arena.json` 加一個最小的 baseball layout（只有 name 和 focus），讓 `SECTION_NOT_IN_LAYOUT` 的測試成立。
- 真實場館先用 demo-arena 把 core 做完，之後再做台北大巨蛋。台北大巨蛋同時有演唱會和棒球兩種 layout，剛好能驗證架構。
- 開發順序：建專案 → 先寫 core 測試並確認全部失敗 → 實作；每完成一步就 commit。

---

## 2026-10-23｜core 實作（測試先行）

**問題**：照上面的設計實作 `src/core/`，並用測試證明是測試先行。

**AI 建議**

1. **紅燈階段放「有型別的空殼」**
   - 不直接讓測試 import 不存在的模組，而是每個函式都先寫成 `throw new Error("not implemented")`。
   - 這樣 typecheck 會過，64 個測試也會各自失敗；不會整個檔案因為 import 錯誤一起掛掉，看不出哪些案例還沒做。
2. **避免空殼「假通過」**
   - 錯誤路徑的測試會斷言丟出的是 `SeatViewError`、而且 `code` 正確；schema 測試只接受 `ZodError`。
   - 所以空殼丟一般 `Error` 時，這些測試不會意外變綠燈。
   - 驗證方式：用 Vitest 的 JSON reporter 把 64 個失敗依第一行錯誤訊息分組，確認全部都來自空殼。
3. **layout 查詢用 `Object.hasOwn`**
   - `venue.layouts["toString"]` 會拿到原型上的函式，而 MCP 的輸入來自 LLM，什麼字串都可能出現。
   - 測試涵蓋 `"toString"` 和 `"__proto__"`，兩者都要回 `UNKNOWN_LAYOUT`。
4. **`horizontalAngle` 把 −179.999… 統一成 180**：浮點誤差會讓「舞台正後方」偶爾算成接近 −180，範圍約定是 (−180, 180]。
5. **`normalAwayFrom` 共用**：linear 區「往哪邊退」的計算，和 schema 檢查「facing 不能在前緣線上」用的是同一個函式，兩邊的判斷不會不一致。
6. **版本**：npm 裝到的是 TypeScript 7、Vite 8、Vitest 5、zod 4；scaffold 後 typecheck 和 build 都正常。

**結果**
- 實作分 4 個 commit：geometry → seat → schema 驗證 → view。
- 最終 64 個測試全部通過，typecheck 和 build 都正常。
- `src/core/` 沒有任何 three.js 或 DOM 依賴。

**流程備註**：測試的 commit 一度把 VS Code Local History 產生的 `.history/` 一起加進去。那時還沒推送，所以直接修正那個 commit，並把 `.history/` 加進 `.gitignore`；之後 `git add` 都指定路徑。

**我的取捨**：
- 我發現測試案例要求 SECTION_NOT_IN_LAYOUT，但示範資料沒有 baseball layout。
- 我要求補上，原因是不補的話測試會得到 UNKNOWN_LAYOUT，驗證不到想測的情境。

---

## 2026-10-23 誤提交 .history/

- **問題：** Claude Code 在提交第一批測試時，誤把 VS Code Local History 產生的 `.history/` 一起 commit。
- **處理：** 在尚未 push 的情況下修正該 commit，並把 `.history/` 加進 `.gitignore`；之後 `git add` 一律指定路徑。
- **我的觀察：** AI 自己發現並回報了這個問題，但如果我沒檢查 git log，也可能漏掉。

---

## 2026-10-23｜src/render/ 設計

**問題**：three.js 場景怎麼切模組、座位怎麼畫、相機怎麼接 `getSeatView`，以及哪些能測、哪些只能目視。

**AI 建議**

1. **「render 只畫」的界線**
   - render 可以把 core 的結果轉成 three.js 物件（Matrix4、顏色、旋轉），也可以為了取景算 bounding box。
   - render 不讀 section 的幾何欄位，也不自己算座位位置、朝向、距離。
   - 因此 core 新增 `sectionSeats(venue, sectionId)`，回傳每個座位的 `position` 和 `yawDeg`（座位面向的方向）。之後 MCP 也能用它算「要轉頭幾度」。
2. **模組切分**
   - `convert`、`camera`、`seats`、`overlays`、`scene`、`viewer`。
   - 只有 `viewer` 碰 DOM 和 WebGL（WebGLRenderer、OrbitControls）；其他模組只操作 three.js 的場景物件，可以在 Node 裡用 Vitest 測。
3. **座位的畫法**：每個座位一個小方塊、每區一個 `InstancedMesh`。
   - 跟點雲成本差不多，但有遮擋效果和看台的層次感。
   - 台北大巨蛋約 4 萬席，也只是幾十次 draw call。
4. **相機**
   - core 的座標系（Y 向上、平面 z 向下）就是 three.js 的世界座標，position 和 target 直接複製。
   - 唯一要轉換的是 `rotation.y = −yawDeg`：three.js 的正旋轉會把 +x 轉向 −z，跟平面角度方向相反。
   - FOV 預設 50°，約等於手機主鏡頭。
   - 兩種模式：`seat`（固定看向 focus）和 `overview`（OrbitControls）。
   - 只在需要時重畫，不一直跑 render loop。
5. **測試範圍**
   - unit test：`sectionSeats`、yaw 轉換、`applyCameraPose`（focus 投影到 NDC 中心）、**左右鏡像**、場景內容、instance 位置等於 core 座標、highlight、dispose。
   - 只能目視：比例感、光影、手感、效能 → 寫成 `docs/manual-checks.md`。

**我的取捨**
- 五個確認點都同意：core 新增 `sectionSeats`、方塊加 InstancedMesh、FOV 50°、座位模式先不做拖曳轉頭、先不加 Playwright。
- **窄螢幕（畫面比例 < 1）改用水平 FOV 當基準**，避免直式手機把舞台左右切掉，並補測試。
- 優先順序：sectionSeats → seats → camera → convert → 鏡像測試 → viewer 的網址參數入口；overlay 測試、dispose 測試、選位錐形標記放最後，時間不夠就略過。
- CLAUDE.md 架構原則補上：「render 不讀 section 幾何欄位，座標與朝向一律來自 core」。

---

## 2026-10-23｜src/render/ 實作

**問題**：照上面的設計和優先順序實作 render，每一步都先看到紅燈再實作。

**AI 建議與過程**

1. **convert 提前到 seats 之前**
   - seats 要用 convert 的 `planYawToRotationY` 擺方塊朝向。
   - 照原本的順序，convert 得跟著 seats 先實作，等輪到它時測試會一寫下去就是綠燈，違反先紅燈。convert 只有兩個小函式，提前做不影響其他優先順序。
2. **`sectionSeats` 和 `seatPosition` 共用內部的 `placeSeat`**：render 畫的每個座位，跟 `getSeatView` 回報的座位是同一段算式算出來的。
3. **測試的容許誤差配合 float32**
   - seats 測試第一次跑紅燈的原因不是實作錯誤：`InstancedMesh` 把矩陣和顏色存成 Float32Array，數十公尺的座標只有約 1e-6 的精度。
   - 修正：位置改成比到 0.1 mm，顏色改成逐通道比較。測試的意圖不變，這個修正獨立成一個 commit。
4. **窄螢幕 FOV**
   - 比例 < 1 時，50° 改當水平 FOV；比例 = 1 時兩條規則重合，縮放視窗不會跳。
   - 測試加了對照組：9:16 時，「固定垂直 50°」的相機會把偏 24° 的點切到畫面外，新規則不會。
   - 目視：手機 375×812 上，舞台約佔畫面寬度 47%。
5. **鏡像測試用突變驗證**
   - 這個測試檢查的是 core 加 camera 串起來的結果，兩者都已實作，沒辦法先紅燈，所以改成故意放錯、確認測試會失敗。
   - 第一個突變 `camera.scale.x = -1` **無效**：three.js r186 的 `Camera.updateMatrixWorld` 為了符合 glTF 規範，會把 scale 排除在 view matrix 外，畫面根本沒有鏡像。學到的是：突變本身也要確認真的放進了錯誤。
   - 改用投影矩陣 x 反向（真正的鏡像），2 個測試失敗；把 core `horizontalAngle` 的正負號反過來，1 個測試失敗。
6. **鳥瞰取景改成繞場館中心**（目視發現）
   - 原設計是繞 focus 轉，但端台的舞台在場館一端，最靠近相機的 A1 大半被切出畫面。
   - 改成繞「所有座位和 overlay」的中心轉，相機距離依 bounding sphere 計算。
7. **overlay 和 dispose 是先實作、後補測試**
   - 照優先順序，這兩項的測試排在最後；但 viewer 要畫出舞台、切換 layout 要釋放資源，所以實作先做了。
   - 補上的測試用突變驗證都抓得到錯：拿掉 box 旋轉、closed 改用 Line、不釋放 material、不呼叫 InstancedMesh.dispose。
   - 跟設計不同的一處：closed polyline 用 `LineLoop`（N 個點），不是 N+1 個點。
8. **選位標記放在獨立 layer**：座位相機就在那個座位的眼睛位置，標記如果在座位模式下看得到，會擋住視線。只有鳥瞰相機啟用 `MARKER_LAYER`；測試確認座位相機看不到它。
9. **dev server 全黑的誤判**
   - 分兩次 Edit 改 viewer.ts（先加用法、再加 import）時，瀏覽器快取了 HMR 的中間版本，出現 `MARKER_LAYER is not defined`。
   - 先確認 typecheck、測試、build 都正常，server 提供的檔案也是新版，判定不是程式錯誤；重啟 dev server 後就正常了。

**結果**
- 131 個測試全部通過，typecheck 和 build 都正常。
- build 有一個 chunk 超過 500 kB 的警告，主要是 three.js 本身。
- 人工檢查 9 項，記錄在 `docs/manual-checks.md`，附截圖。
- 還沒做：效能（等大巨蛋）、座位模式拖曳轉頭（設計上先不做）。

**我的取捨**：（待補）
