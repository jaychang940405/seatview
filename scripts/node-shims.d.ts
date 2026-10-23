// 只宣告 scripts/ 與 src/mcp/ 用到的 Node API：為了這幾個函式不新增 @types/node 依賴。
// 兩者都直接用 Node 22 內建的 TypeScript 型別剝除執行（node xxx.ts）。

declare module "node:fs" {
  export function writeFileSync(file: URL | string, data: string): void;
  export function readFileSync(file: URL | string, encoding: "utf8"): string;
  export function readdirSync(dir: URL | string): string[];
}

declare const process: {
  argv: string[];
  exitCode?: number;
  stderr: { write(chunk: string): boolean };
};

interface ImportMeta {
  readonly url: string;
}
