// 只宣告 scripts/ 用到的 Node API：為了這兩個函式不新增 @types/node 依賴。
// scripts 直接用 Node 22 內建的 TypeScript 型別剝除執行（node scripts/xxx.ts）。

declare module "node:fs" {
  export function writeFileSync(file: URL, data: string): void;
}

interface ImportMeta {
  readonly url: string;
}
