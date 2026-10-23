/** 把 tool 結果轉成給人看的中文摘要（MCP 回應裡的 text content）。 */
import type {
  CompareSeatsOutput,
  ListSectionsOutput,
  ListVenuesOutput,
  Metrics,
  ProvenanceOutput,
  SeatViewOutput,
  ToolError,
} from "./tools.ts";

const m = (v: number) => `${v.toFixed(1)} m`;
const deg = (v: number) => `${v.toFixed(1)}°`;

/** focus 在這個 layout 叫什麼（演唱會是舞台、棒球是本壘），其他 layout 統稱 focus。 */
function focusNoun(layoutId: string): string {
  return { concert: "舞台", baseball: "本壘" }[layoutId] ?? "focus";
}

function metricsText(metrics: Metrics, layoutId: string): string {
  const noun = focusNoun(layoutId);
  const height = metrics.heightAboveFocus >= 0 ? `比${noun}高 ${m(metrics.heightAboveFocus)}` : `比${noun}低 ${m(-metrics.heightAboveFocus)}`;
  return `距${noun} ${m(metrics.distance)}（平面 ${m(metrics.horizontalDistance)}），${height}（俯角 ${deg(metrics.elevationDeg)}），水平偏角 ${deg(metrics.horizontalDeg)}`;
}

const withDisclaimer = (text: string, disclaimer?: string) => (disclaimer ? `${text}\n${disclaimer}` : text);

export function errorText(error: ToolError): string {
  return `${error.code}：${error.message}${error.hint ? `\n${error.hint}` : ""}`;
}

export function venuesText({ venues }: ListVenuesOutput): string {
  return venues
    .map((v) => withDisclaimer(`${v.id}（${v.name}）：${v.sectionCount} 區；layout：${v.layouts.map((l) => `${l.id}（${l.name}）`).join("、")}`, v.disclaimer))
    .join("\n");
}

export function sectionsText({ venue, layout, sections }: ListSectionsOutput): string {
  const lines = sections.map((s) => {
    const counts = s.seatsPerRow;
    const range = Math.min(...counts) === Math.max(...counts) ? `每排 ${counts[0]} 號` : `每排 ${Math.min(...counts)}–${Math.max(...counts)} 號`;
    return `- ${s.id}${s.name ? `（${s.name}）` : ""}：${s.rows} 排、${range}、共 ${s.totalSeats} 席`;
  });
  return [`${venue.name}｜${layout.name}：${sections.length} 區`, ...lines].join("\n");
}

export function seatViewText(v: SeatViewOutput): string {
  const where = `${v.section.id}${v.section.name ? `（${v.section.name}）` : ""} 第 ${v.row} 排 ${v.seat} 號`;
  return withDisclaimer(`${v.venue.name}｜${v.layout.name}｜${where}：${metricsText(v.metrics, v.layout.id)}，位於${v.direction}。`, v.disclaimer);
}

export function compareText(c: CompareSeatsOutput): string {
  const label = (i: number) => {
    const r = c.results[i];
    return r ? `${r.section} 第 ${r.row} 排 ${r.seat} 號` : "";
  };
  const lines = c.results.map((r) =>
    r.ok ? `- ${label(c.results.indexOf(r))}：${metricsText(r.metrics, c.layout.id)}，位於${r.direction}` : `- ${r.section} 第 ${r.row} 排 ${r.seat} 號：${errorText(r.error)}`,
  );
  const ranking = [
    c.ranking.byDistance.length > 0 ? `由近到遠：${c.ranking.byDistance.map(label).join(" → ")}` : "",
    c.ranking.byCenter.length > 0 ? `由正到偏：${c.ranking.byCenter.map(label).join(" → ")}` : "",
  ].filter(Boolean);
  return withDisclaimer([`${c.venue.name}｜${c.layout.name}`, ...lines, ...ranking].join("\n"), c.disclaimer);
}

export function provenanceText({ venue, disclaimer, provenance }: ProvenanceOutput): string {
  if (provenance.length === 0) return `${venue.name}：沒有數字來源表（示範用場館）。`;
  const lines = provenance.map((p) => `- [${p.grade}] ${p.value}（來源：${p.source}）`);
  return withDisclaimer([`${venue.name} 的數字來源（A = 規則或官方定義、B = 新聞報導、C = 本專案估算）：`, ...lines].join("\n"), disclaimer);
}
