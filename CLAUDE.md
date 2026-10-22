# SeatView — 座位視野模擬器與 MCP 工具

## 專案背景
這是 HW2（AI-Assisted Programming Project，佔學期成績 40%，截止 11/1 23:59:59）。
痛點：買演唱會／球賽票時，無法預知座位實際視野。
靈感來自 twconcertview.com，但該網站非開源。**嚴禁複製其程式碼、3D 模型或圖片資產**，所有場館資料與模型必須自己建立。

## 作業交付（隨時對照）
1. 報告：專案目的、與 AI 協作方式、軟體工程實踐（unit test 等）
2. GitHub 完整 git log（commit 小而清楚）
3. AI collaboration log（重要決策記錄於 docs/ai-log.md）
4. Bonus +10%：MCP server，tool 例如 get_seat_view(venue, layout, section, row, seat)

## 技術選型
- TypeScript + Vite + three.js
- 測試：Vitest
- MCP server：官方 TypeScript MCP SDK，放在 packages/mcp 或 src/mcp
- 不引入未經授權的資產；第三方程式庫需為寬鬆授權

## 架構原則（為了之後擴充棒球版 C）
- `src/core/`：**純函式、無 three.js 依賴、無 DOM**，可直接 unit test，也供 MCP 重用
  - `seatPosition(venue, section, row, seat)` → {x, y, z}
  - `cameraPose(seatPos, focusPoint)` → 位置與朝向
  - `distance`、`elevationAngle`、`horizontalAngle`
- `src/venues/*.json`：場館資料。一個場館有多個 `layouts`（concert / baseball），
  每個 layout 定義自己的 `focus`（舞台中心、本壘板等）與可選的 `overlays`
- `src/render/`：three.js 場景，只負責畫，不含計算邏輯
- `src/ui/`：區／排／號輸入、layout 切換
- 新增棒球版時，只新增 layout 與 overlay，不應改動 core 函式簽名

## 工作方式
- 先討論設計與取捨再實作；重要決策說明「為什麼這樣選」
- 測試先行：core 函式先寫測試再寫實作
- 每完成一個小功能就 commit，訊息清楚（例如 `feat(core): add seatPosition with row rake`）
- 重要決策與 AI 對話重點追加到 docs/ai-log.md（日期、問題、AI 建議、我的取捨）
- 回覆用繁體中文，直接講重點並給具體範例
- 報告驗證或實驗結果時，不只給結果，要說明原因與驗證方式

## 指令（scaffold 完成後補上）
- 開發：`npm run dev`
- 測試：`npm test`
- 型別檢查：`npm run typecheck`
