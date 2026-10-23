# SeatView MCP server

用 MCP（Model Context Protocol）讓 AI 助理直接查座位視野。官方 TypeScript SDK（`@modelcontextprotocol/sdk`，MIT），stdio transport。

## 啟動與接上

```bash
npm run mcp
```

Claude Code：

```bash
claude mcp add seatview -- node C:/seatview/src/mcp/main.ts
```

Claude Desktop（`claude_desktop_config.json`）：

```json
{ "mcpServers": { "seatview": { "command": "node", "args": ["C:/seatview/src/mcp/main.ts"] } } }
```

- 需要 Node ≥ 22.18：直接用 Node 內建的 TypeScript 型別剝除執行，不需要 build。
- stdout 只給 MCP 協定用；log 寫到 stderr。

## 架構

```
src/mcp/
  main.ts      進入點：讀場館、接 stdio
  server.ts    註冊 tool（zod 輸入／輸出 schema、唯讀標註）
  tools.ts     處理函式：輸入 → 結果物件；只用 src/core，不碰 SDK
  format.ts    中文摘要
  venues.ts    讀 src/venues/*.json，經 parseVenue 驗證
```

所有數字都來自 `src/core` 的 `getSeatView` 等函式，跟網頁版是同一套算式。

## Tools

**共通約定**：

- **單位**：公尺、度。
- **focus**：演唱會是舞台，棒球是本壘。
- **俯角**：正值代表比 focus 高、往下看。
- **水平偏角**：範圍 (−180, 180]。0 = 正對 focus 的正面；正值 = 觀眾面向 focus 時的右手邊。棒球的 0° 是本壘正後方，一壘側為正。
- **方位（direction）**：±15° 內為「正面」，60°、120°、165° 分界，依序是前方／側／後方，超過 165° 為「背面」（C 級設計選擇）。
- **venue**：輸入 schema 用 enum 列出所有場館，AI 可以直接看到有哪些值。
- **回傳**：成功時回傳 `structuredContent`（符合 `outputSchema`）加中文摘要。
- **錯誤**：`isError: true`，訊息附錯誤代碼與改正提示。
- **免責聲明**：近似模型（臺北大巨蛋）的結果一定附上 `disclaimer`，要轉告使用者。
- **編號**：區、排、號都是模型內部編號，不對應實際票面。

| tool | 輸入 | 輸出重點 |
|---|---|---|
| `list_venues` | — | 場館、各自的 layout、區數、免責聲明 |
| `list_sections` | `venue`, `layout` | 該 layout 開放的區：排數、每排席數、總席數 |
| `get_seat_view` | `venue`, `layout`, `section`, `row`, `seat` | 座位位置、相機位置與看向點、距離、平面距離、高低差、俯角、水平偏角、方位、免責聲明 |
| `compare_seats` | `venue`, `layout`, `seats`（2–10 筆） | 每席的指標（出錯的座位單獨標示）、由近到遠與由正到偏的排名 |
| `get_venue_provenance` | `venue` | 每個數字的值、等級（A／B／C）與來源 |

### 例子（真正的 stdio 連線，2026-10-23）

`get_seat_view { venue: "taipei-dome", layout: "baseball", section: "I1-HP", row: 1, seat: 29 }`：

> 臺北大巨蛋（近似模型）｜棒球｜I1-HP（內野一層・本壘後方） 第 1 排 29 號：距本壘 18.6 m（平面 18.3 m），比本壘高 3.4 m（俯角 10.5°），水平偏角 0.0°，位於正面。
> 本模型為依公開報導與棒球規則推算的近似模型……不應作為購票依據。

`get_seat_view { venue: "taipei-dome", layout: "concert", section: "O1-CF", row: 1, seat: 1 }` → `isError`：

> SECTION_NOT_IN_LAYOUT：O1-CF 區在 concert layout 沒有開放
> concert 開放的區：I1-1B、I1-HP、I1-3B、I2-1B、I2-HP、I2-3B、O1-RF、O1-LF、F1、F2、F3

### 錯誤代碼

| 代碼 | 什麼時候 | 提示 |
|---|---|---|
| `UNKNOWN_VENUE` | 場館不存在 | 可用的場館 |
| `UNKNOWN_LAYOUT` | layout 不存在 | 可用的 layout |
| `UNKNOWN_SECTION` | 區不存在（例如沒建模的外野二層） | 這個 layout 開放的區 |
| `SECTION_NOT_IN_LAYOUT` | 區存在，但這個 layout 沒開放（例如演唱會的 O1-CF） | 這個 layout 開放的區 |
| `ROW_OUT_OF_RANGE`、`SEAT_OUT_OF_RANGE` | 排號、座號超出範圍 | 訊息說明範圍；可用 `list_sections` 查 |
| `Input validation error` | 輸入不符合 schema（例如 1.5 排、缺參數）；由 SDK 擋下，不會執行 core | — |

## 測試

- `src/mcp/tools.test.ts`（26 項）：
  - `get_seat_view` 的數字跟 core 的 `getSeatView` 完全一致。
  - 方位標籤的分界角度。
  - 各種錯誤都附提示。
  - 近似模型一定附免責聲明。
  - `compare_seats` 的排名正確，其中一席出錯不影響其他席。
  - 數字來源表的等級正確。
- `src/mcp/server.test.ts`（7 項）：用 SDK 的 `InMemoryTransport` 走完整的 MCP 協定。
  - 列出 5 個 tool，都有輸入、輸出 schema 和唯讀標註。
  - 每個 tool 的回傳都通過 `outputSchema` 驗證。
  - 錯誤回傳 `isError`。
  - 不合法的輸入在執行 core 之前就被擋下。
- **真正的 stdio**：用 SDK 的 `StdioClientTransport` 啟動 `node src/mcp/main.ts`，5 個 tool 全部呼叫一次，見上面的例子。
- **型別檢查**：tsconfig 開了 `erasableSyntaxOnly`。Node 的型別剝除不支援建構子參數屬性、enum 這類語法，但 Vitest 照樣能編譯；開了這個選項，typecheck 會直接擋下。

## 這一版不做

- 回傳 render 截圖：需要沒有畫面的 WebGL 環境。
- 依條件找座位（`find_seats`）。
- HTTP transport。
- MCP resources 和 prompts。
