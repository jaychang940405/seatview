import * as THREE from "three";

/*
 * 地面材質的紋理：全部由程式產生（不用外部貼圖或照片），數值是 C 級的目視估計，見 docs/visuals.md。
 * 紋理是接近白色的明暗變化，乘上 polygon 本身的顏色；polygon 的 UV 就是平面上的公尺，所以 repeat = 1 ÷ 一張紋理鋪幾公尺。
 */

export type Surface = "turf" | "dirt";

interface SurfaceSpec {
  /** 一張紋理在地上鋪幾公尺 */
  tileMeters: number;
  /** 第 (x, y) 個像素的亮度倍數，約 0.9–1.05 */
  shade: (x: number, y: number, size: number, random: () => number) => number;
  /**
   * 校色用的各通道倍數（可以 > 1，所以紋理用半精度浮點），乘在亮度上：
   * polygon 的顏色不動，畫面對齊參考照片的取樣值（docs/look-targets.md）
   */
  tint: readonly [number, number, number];
}

const SIZE = 64;

const SPECS: Record<Surface, SurfaceSpec> = {
  // 草皮：割草條紋，一張 12 m 裡深淺各 6 m，深的一條暗約 8%，再加 ±3% 的細雜訊
  turf: {
    tileMeters: 12,
    shade: (_x, y, size, random) => (y < size / 2 ? 1 : 0.92) + (random() - 0.5) * 0.06,
    tint: [1.9, 1.3, 1.8],
  },
  // 紅土：一張 4 m 的細顆粒，亮度 ±6%，沒有條紋
  dirt: {
    tileMeters: 4,
    shade: (_x, _y, _size, random) => 0.97 + (random() - 0.5) * 0.12,
    tint: [1.075, 0.71, 1.26],
  },
};

/** mulberry32：固定種子，每次產生的紋理都一樣。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一張新的紋理（每個 polygon 自己一張，dispose 時不會互相影響）。 */
export function surfaceTexture(surface: Surface): THREE.DataTexture {
  const spec = SPECS[surface];
  const random = rng(surface === "turf" ? 20261101 : 20261102);
  const data = new Uint16Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = Math.min(1, Math.max(0, spec.shade(x, y, SIZE, random)));
      data.set([...spec.tint.map((t) => THREE.DataUtils.toHalfFloat(v * t)), THREE.DataUtils.toHalfFloat(1)], (y * SIZE + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1 / spec.tileMeters, 1 / spec.tileMeters);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
