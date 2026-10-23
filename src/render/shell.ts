import * as THREE from "three";
import type { Shell } from "../core/schema";

/** 穹頂外殼："shell" 群組，內含牆、接縫、屋頂、格柵、屋頂邊緣的燈；形狀與高度全部來自 core。 */
export function buildShell(_shell: Shell): THREE.Group {
  throw new Error("not implemented");
}
