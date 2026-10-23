/**
 * 依官方票區排臺北大巨蛋的棒球看台（產生器用）。
 * 區號、層別、相鄰關係、排數下限、票面標籤是 B（公開資料）；每區的寬度與每排長度是 C（依規則推算，不是描摹座位圖）。
 */

/** 依最小寬度切分 [0, total]：最小寬度大於平均分的區用最小寬度，其餘平分剩下的。order[0] 從 0 開始。 */
export function splitByMinWidth(_order: string[], _total: number, _minWidth: Record<string, number>): Record<string, [number, number]> {
  throw new Error("not implemented");
}

/** 一排可用的長度 [a, b]（m）裡以固定間距放座位：席數 = 可用長度 ÷ 間距取整，座位置中。 */
export function centeredSpan(_available: [number, number], _pitch: number): { seats: number; span: [number, number] } {
  throw new Error("not implemented");
}
