import { readdirSync, readFileSync } from "node:fs";
import { parseVenue, type Venue } from "../core/schema.ts";

export interface VenueRegistry {
  /** 場館 id，依字母排序 */
  ids: string[];
  get(id: string): Venue | undefined;
}

/** 由一組已驗證的場館建立清單（測試也用這個）。 */
export function registryOf(venues: Venue[]): VenueRegistry {
  const byId = new Map(venues.map((v) => [v.id, v]));
  if (byId.size !== venues.length) throw new Error("場館 id 重複");
  return { ids: [...byId.keys()].sort(), get: (id) => byId.get(id) };
}

/** 讀 src/venues/ 下所有 .json，經 parseVenue 驗證後建立清單。 */
export function loadVenues(dir: URL = new URL("../venues/", import.meta.url)): VenueRegistry {
  const files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  return registryOf(files.map((name) => parseVenue(JSON.parse(readFileSync(new URL(name, dir), "utf8")))));
}
