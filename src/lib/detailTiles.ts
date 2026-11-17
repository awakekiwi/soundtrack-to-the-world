import * as THREE from "three";

/**
 * Sharper ground when you zoom in: NASA's Blue Marble imagery at 500 m per
 * pixel, from NASA's free tile service (GIBS). Only the patch under the
 * camera is fetched: 4 × 4 tiles of 512 px, stitched into one 2048 px
 * texture that the earth shader blends over the base map.
 *
 * The tiles are in plain latitude/longitude (EPSG:4326), the same layout as
 * the globe's own map, so a patch lines up with a simple rectangle.
 */

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";
/** Daytime ground: Blue Marble with shaded relief */
export const DAY_TILES = `${GIBS}/BlueMarble_ShadedRelief/default/500m`;
/** Night: VIIRS city lights */
export const NIGHT_TILES = `${GIBS}/VIIRS_CityLights_2012/default/default/500m`;
/** Degrees covered by one tile at level 0 (NASA's grid: 0.5625°/px × 512 px) */
const SPAN0 = 288;
/** Finest level this imagery has (about 500 m per pixel) */
export const MAX_LEVEL = 7;
const GRID = 4;
const TILE = 512;
const MAX_CACHED = 160;

export class DetailPatch {
  readonly texture: THREE.CanvasTexture;
  /** Where the patch sits on the globe's map: u0, v0, width, height (0–1) */
  readonly rect = new THREE.Vector4(0, 0, 0, 0);
  /** True once at least one tile is on the patch */
  ready = false;
  private ctx: CanvasRenderingContext2D;
  private cache = new Map<string, HTMLImageElement | null>();
  private key = "";
  private level = -1;
  private col0 = 0;
  private row0 = 0;
  private dirty = false;

  constructor(
    anisotropy: number,
    private base = DAY_TILES
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = GRID * TILE;
    this.ctx = canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.anisotropy = anisotropy;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
  }

  /** Point the patch at this spot and detail level (level < 0: no patch) */
  update(lat: number, lon: number, level: number) {
    if (level < 0) {
      this.level = -1;
      this.key = "";
      this.ready = false;
      return;
    }
    const span = SPAN0 / 2 ** level;
    const cols = Math.ceil(360 / span);
    const rows = Math.ceil(180 / span);
    // The spot sits in the middle of the 4 × 4 block
    const col0 = clamp(Math.round((lon + 180) / span) - GRID / 2, 0, Math.max(0, cols - GRID));
    const row0 = clamp(Math.round((90 - lat) / span) - GRID / 2, 0, Math.max(0, rows - GRID));
    const key = `${level}/${row0}/${col0}`;
    if (key === this.key) return;
    this.key = key;
    this.level = level;
    this.col0 = col0;
    this.row0 = row0;
    const width = GRID * span;
    this.rect.set((col0 * span) / 360, 1 - (row0 * span + width) / 180, width / 360, width / 180);

    this.ctx.clearRect(0, 0, GRID * TILE, GRID * TILE);
    this.ready = false;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const row = row0 + r;
        const col = col0 + c;
        if (row >= rows || col >= cols) continue;
        this.tile(level, row, col);
      }
    }
    this.dirty = true;
  }

  /** Upload to the graphics card at most once a frame, when something changed */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.texture.needsUpdate = true;
  }

  private tile(level: number, row: number, col: number) {
    const id = `${level}/${row}/${col}`;
    const got = this.cache.get(id);
    if (got) return this.draw(got, level, row, col);
    if (got === null) return; // loading, or failed
    this.cache.set(id, null);
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      this.cache.set(id, img);
      this.draw(img, level, row, col);
    };
    img.onerror = () => this.cache.delete(id);
    img.src = `${this.base}/${level}/${row}/${col}.jpeg`;
  }

  private draw(img: HTMLImageElement, level: number, row: number, col: number) {
    // Only if the patch is still where this tile belongs
    if (level !== this.level) return;
    const x = col - this.col0;
    const y = row - this.row0;
    if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
    this.ctx.drawImage(img, x * TILE, y * TILE, TILE, TILE);
    this.ready = true;
    this.dirty = true;
  }

  dispose() {
    this.texture.dispose();
    this.cache.clear();
  }
}

/** How much detail to fetch at this camera distance (-1: none needed) */
export function detailLevel(distance: number, earthRadius: number) {
  const h = distance - earthRadius;
  if (h < 0.22) return MAX_LEVEL;
  if (h < 0.5) return 6;
  if (h < 1.0) return 5;
  if (h < 1.7) return 4;
  return -1;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
