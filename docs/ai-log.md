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
