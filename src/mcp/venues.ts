import type { Venue } from "../core/schema.ts";

export interface VenueRegistry {
  /** 場館 id，依字母排序 */
  ids: string[];
  get(id: string): Venue | undefined;
}

/** 由一組已驗證的場館建立清單（測試也用這個）。 */
export function registryOf(venues: Venue[]): VenueRegistry {
  throw new Error("not implemented: registryOf");
}

/** 讀 src/venues/ 下所有 .json，經 parseVenue 驗證後建立清單。 */
export function loadVenues(dir: URL = new URL("../venues/", import.meta.url)): VenueRegistry {
  throw new Error("not implemented: loadVenues");
}
