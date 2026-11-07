import { Suspense, memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { localTime, subsolarPoint } from "@/lib/geo";
import { levelForDistance, rankPopular, rankQuiet, revealLevels } from "@/lib/declutter";
import { FAMILY_BY_ID, placeLine, type Station } from "@/lib/stations";

// ---------------------------------------------------------------------------
// Geometry + sun (ported from Sun Chaser Live)
// ---------------------------------------------------------------------------

const EARTH_R = 2;
const DOT_R = 2.012;

export function latLongToVector3(lat: number, lon: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );
}

function getSunDirection(out: THREE.Vector3) {
  const { lat, lon } = subsolarPoint();
  return out.copy(latLongToVector3(lat, lon, 1)).normalize();
}

// ---------------------------------------------------------------------------
// Earth: one shader does day, night and dusk. The day side shows the planet,
// the night side fades to city lights (where the late-night radio lives),
// and a warm band glows along the terminator as in Sun Chaser.
// ---------------------------------------------------------------------------

// Same day map as Sun Chaser: 4096px like the three.js one, but saved at
// much higher quality (~1.4 MB vs ~0.5 MB), so fine detail stays crisp
const DAY_TEX = "https://raw.githubusercontent.com/turban/webgl-earth/master/images/2_no_clouds_4k.jpg";
const NIGHT_TEX = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_night_4096.jpg";

// Optional 8K maps, served from the site's own public/textures folder
// (download them once: see public/textures/README.md). They're only fetched
// when you zoom in close, on a computer that can hold them; if the files
// aren't there, the 4K maps simply stay.
const HD_DAY_TEX = `${import.meta.env.BASE_URL}textures/8k_earth_daymap.jpg`;
const HD_NIGHT_TEX = `${import.meta.env.BASE_URL}textures/8k_earth_nightmap.jpg`;
/** Camera distance below which the 8K maps are worth fetching */
const HD_ZOOM = 4.4;

function canTakeHd(gl: THREE.WebGLRenderer) {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (gl.capabilities.maxTextureSize < 8192) return false;
  if (nav.connection?.saveData) return false;
  // Each 8K map needs ~180 MB of graphics memory: skip phones and small devices
  if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
  if (Math.min(window.screen.width, window.screen.height) < 600) return false;
  return true;
}

const earthVertex = `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const earthFragment = `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    float d = dot(normalize(vNormal), sunDirection);
    float dayMix = smoothstep(-0.12, 0.18, d);
    vec3 day = texture2D(dayMap, vUv).rgb * (0.45 + 1.0 * max(d, 0.0)) + vec3(0.015, 0.035, 0.075);
    vec3 lights = texture2D(nightMap, vUv).rgb;
    vec3 night = texture2D(dayMap, vUv).rgb * 0.12 + lights * vec3(1.0, 0.78, 0.45) * 1.25;
    vec3 col = mix(night, day, dayMix);
    // Dusk / dawn band
    float band = 1.0 - smoothstep(0.0, 0.22, abs(d));
    vec3 dusk = mix(vec3(0.98, 0.30, 0.55), vec3(1.0, 0.48, 0.08), smoothstep(-0.15, 0.15, d));
    col += dusk * band * 0.16;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Thin atmosphere halo: the inside of a slightly larger sphere, brightest
// right at the planet's edge and fading to nothing outward, tinted by the
// sun (blue on the day side, violet at night).
const ATMO_SCALE = 1.06;
const atmosphereVertex = `
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;
  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const atmosphereFragment = `
  uniform vec3 sunDirection;
  uniform float edge;
  varying vec3 vViewNormal;
  varying vec3 vWorldNormal;
  void main() {
    // Back faces: z runs from -edge (touching the planet) to 0 (outer rim)
    float k = clamp(-vViewNormal.z / edge, 0.0, 1.0);
    float glow = pow(k, 2.2);
    float lit = smoothstep(-0.35, 0.35, dot(vWorldNormal, sunDirection));
    vec3 col = mix(vec3(0.32, 0.22, 0.7), vec3(0.38, 0.68, 1.0), lit);
    gl_FragColor = vec4(col, glow * mix(0.35, 0.8, lit));
  }
`;

function Earth() {
  const [day, night] = useLoader(THREE.TextureLoader, [DAY_TEX, NIGHT_TEX]);
  const earthMat = useRef<THREE.ShaderMaterial>(null);
  const atmoMat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({ dayMap: { value: day }, nightMap: { value: night }, sunDirection: { value: new THREE.Vector3(1, 0, 0) } }),
    [day, night]
  );
  const atmoUniforms = useMemo(
    () => ({ sunDirection: { value: new THREE.Vector3(1, 0, 0) }, edge: { value: Math.sqrt(1 - 1 / (ATMO_SCALE * ATMO_SCALE)) } }),
    []
  );
  const frame = useRef(0);

  // Sharper when the globe is tilted away (edges and poles)
  const { gl } = useThree();
  useEffect(() => {
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    for (const t of [day, night]) {
      t.anisotropy = aniso;
      t.needsUpdate = true;
    }
  }, [day, night, gl]);

  // Swap in the 8K maps the first time you zoom in close
  const hd = useRef<"idle" | "loading" | "done">("idle");
  const loadHd = () => {
    hd.current = "loading";
    if (!canTakeHd(gl)) return;
    const loader = new THREE.TextureLoader();
    const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    // Each map upgrades on its own, so you can add just one of the 8K files
    // (e.g. only the night lights, keeping the relief-style day map)
    const upgrade = (url: string, slot: "dayMap" | "nightMap") =>
      loader
        .loadAsync(url)
        .then((t) => {
          t.anisotropy = aniso;
          const old = uniforms[slot].value;
          uniforms[slot].value = t;
          old.dispose();
        })
        .catch(() => {
          /* that 8K file isn't on this site: the 4K map stays */
        });
    Promise.all([upgrade(HD_DAY_TEX, "dayMap"), upgrade(HD_NIGHT_TEX, "nightMap")]).then(() => (hd.current = "done"));
  };

  useFrame(({ camera }) => {
    if (hd.current === "idle" && camera.position.length() < HD_ZOOM) loadHd();
    // The sun barely moves; once a second is plenty
    if (frame.current++ % 60 !== 0) return;
    getSunDirection(uniforms.sunDirection.value);
    atmoUniforms.sunDirection.value.copy(uniforms.sunDirection.value);
  });

  return (
    <group>
      <mesh>
        <sphereGeometry args={[EARTH_R, 64, 64]} />
        <shaderMaterial ref={earthMat} vertexShader={earthVertex} fragmentShader={earthFragment} uniforms={uniforms} />
      </mesh>
      <mesh scale={ATMO_SCALE}>
        <sphereGeometry args={[EARTH_R, 48, 48]} />
        <shaderMaterial
          ref={atmoMat}
          vertexShader={atmosphereVertex}
          fragmentShader={atmosphereFragment}
          uniforms={atmoUniforms}
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Station dots: every station is one point in a single draw call, so tens of
// thousands stay smooth on integrated graphics. Dots fade near the globe's
// edge, matches glow, and non-matches sink back when a filter is on.
// ---------------------------------------------------------------------------

const dotsVertex = `
  attribute vec3 aColor;
  attribute float aMatch;
  attribute float aBorn;
  attribute float aFav;
  attribute float aLevel;
  attribute float aLevelAll;
  uniform float uScale;
  uniform float uDim;
  uniform float uTime;
  uniform float uLevel;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFav;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    float facing = dot(normalize(wp), normalize(cameraPosition - wp));
    float limb = smoothstep(0.02, 0.3, facing);
    // New dots fade in as their batch arrives
    float born = clamp((uTime - aBorn) / 1.2, 0.0, 1.0);
    // Even density: a dot fades in once the zoom reaches its reveal level
    // (matches are thinned among themselves, the rest among everyone)
    float lv = aMatch > 0.5 ? aLevel : aLevelAll;
    float reveal = max(clamp(uLevel - lv + 1.0, 0.0, 1.0), aFav);
    vAlpha = limb * born * reveal * mix(uDim, 1.0, aMatch);
    vColor = aColor;
    vFav = aFav;
    // Favourites stay bright even when filtered out, and draw bigger for their ring
    vAlpha = max(vAlpha, limb * born * aFav * 0.85);
    gl_PointSize = uScale * mix(0.65, 1.0, max(aMatch, aFav)) * mix(1.0, 2.1, aFav) * mix(0.4, 1.0, reveal) * (7.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const dotsFragment = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFav;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    if (vFav > 0.5) {
      // Favourite: the usual dot in the middle, a thin gold ring around it
      float core = smoothstep(0.17, 0.07, r);
      float ring = smoothstep(0.05, 0.0, abs(r - 0.36));
      vec3 gold = vec3(1.0, 0.82, 0.35);
      vec3 col = mix(vColor, gold, ring);
      gl_FragColor = vec4(col * 1.1, vAlpha * max(core, ring * 0.95));
      return;
    }
    float core = smoothstep(0.32, 0.12, r);
    float glow = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vColor * (0.75 + 0.5 * core), vAlpha * (0.28 * glow + 0.8 * core));
  }
`;

function StationDots({
  stations,
  matchMask,
  filtering,
  favIds,
  levels,
  levelsAll,
}: {
  stations: Station[];
  matchMask: Uint8Array;
  filtering: boolean;
  favIds: Set<string>;
  levels: Float32Array;
  levelsAll: Float32Array;
}) {
  const geomRef = useRef<THREE.BufferGeometry>(null);
  const born = useRef(new Map<string, number>());
  const { gl, clock } = useThree();
  const uniforms = useMemo(
    () => ({ uScale: { value: 1 }, uDim: { value: 1 }, uTime: { value: 0 }, uLevel: { value: 2 } }),
    []
  );

  // Positions, colours and fade-in times; rebuilt when the station list grows
  useEffect(() => {
    const g = geomRef.current;
    if (!g) return;
    const n = stations.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const bornAt = new Float32Array(n);
    const c = new THREE.Color();
    const now = clock.elapsedTime;
    stations.forEach((s, i) => {
      const v = latLongToVector3(s.lat, s.lon, DOT_R);
      pos.set([v.x, v.y, v.z], i * 3);
      c.set(FAMILY_BY_ID[s.family].color);
      col.set([c.r, c.g, c.b], i * 3);
      if (!born.current.has(s.id)) born.current.set(s.id, now + Math.random() * 0.8);
      bornAt[i] = born.current.get(s.id)!;
    });
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aBorn", new THREE.BufferAttribute(bornAt, 1));
    g.setAttribute("aMatch", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    g.setAttribute("aFav", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aLevel", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("aLevelAll", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.computeBoundingSphere();
  }, [stations, clock]);

  // Reveal levels (recomputed when the stations or the filter change)
  useEffect(() => {
    const g = geomRef.current;
    const a = g?.getAttribute("aLevel") as THREE.BufferAttribute | undefined;
    const b = g?.getAttribute("aLevelAll") as THREE.BufferAttribute | undefined;
    if (!a || !b || a.count !== levels.length || b.count !== levelsAll.length) return;
    (a.array as Float32Array).set(levels);
    (b.array as Float32Array).set(levelsAll);
    a.needsUpdate = b.needsUpdate = true;
  }, [levels, levelsAll, stations]);

  // Which dots are favourites
  useEffect(() => {
    const attr = geomRef.current?.getAttribute("aFav") as THREE.BufferAttribute | undefined;
    if (!attr || attr.count !== stations.length) return;
    stations.forEach((s, i) => (attr.array[i] = favIds.has(s.id) ? 1 : 0));
    attr.needsUpdate = true;
  }, [favIds, stations]);

  // Which dots match the current filter
  useEffect(() => {
    const g = geomRef.current;
    const attr = g?.getAttribute("aMatch") as THREE.BufferAttribute | undefined;
    if (!attr || attr.count !== matchMask.length) return;
    for (let i = 0; i < matchMask.length; i++) attr.array[i] = matchMask[i];
    attr.needsUpdate = true;
  }, [matchMask, stations]);

  useFrame(({ clock, camera }) => {
    uniforms.uTime.value = clock.elapsedTime;
    uniforms.uLevel.value = levelForDistance(camera.position.length());
    uniforms.uScale.value = 3.2 * gl.getPixelRatio();
    // Ease the dimming in and out rather than snapping
    const target = filtering ? 0.1 : 1;
    uniforms.uDim.value += (target - uniforms.uDim.value) * 0.12;
  });

  return (
    <points renderOrder={2}>
      <bufferGeometry ref={geomRef} />
      <shaderMaterial
        vertexShader={dotsVertex}
        fragmentShader={dotsFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  );
}

// ---------------------------------------------------------------------------
// Now-playing marker: a sonar ping in the station's colour (Sun Chaser's
// highlight rings), always turned to face the viewer.
// ---------------------------------------------------------------------------

const RINGS = 5;

/**
 * The playing station's dot, doubling as a sound meter. When the station's
 * audio can be measured, the centre swells with the sound and each ring is
 * sent out carrying the loudness of its moment, so the rings read as a
 * history of the sound: steady for music, ragged and bursty for talk. When
 * it can't be measured, it falls back to an even, gentle pulse.
 */
function NowPlayingMarker({ station, playing, getLevel }: { station: Station; playing: boolean; getLevel?: () => number }) {
  const group = useRef<THREE.Group>(null);
  const pos = useMemo(() => latLongToVector3(station.lat, station.lon, DOT_R + 0.004), [station]);
  const color = FAMILY_BY_ID[station.family].color;
  // Each ring's age (0 → 1) and the loudness it was born with
  const rings = useRef(Array.from({ length: RINGS }, (_, i) => ({ age: i / RINGS, level: 0.4 })));

  useFrame(({ camera }, delta) => {
    const g = group.current;
    if (!g) return;
    g.quaternion.copy(camera.quaternion);
    const dist = camera.position.distanceTo(pos);
    g.scale.setScalar(dist / 8);

    const measured = playing && getLevel ? getLevel() : -1;
    const live = measured >= 0;
    const lv = live ? measured : 0;

    // Centre dot: breathes with the sound (or sits still)
    g.children[0].scale.setScalar(live ? 0.85 + lv * 1.1 : 1);

    const speed = !playing ? 0.18 : live ? 0.55 + lv * 0.6 : 0.5;
    rings.current.forEach((r, i) => {
      r.age += delta * speed;
      if (r.age >= 1) {
        r.age -= 1;
        r.level = live ? lv : 0.45;
      }
      const ring = g.children[i + 1] as THREE.Mesh;
      const reach = live ? 1.2 + r.level * 3.2 : 2.2;
      ring.scale.setScalar(1 + r.age * reach);
      const strength = live ? Math.min(1, 0.15 + r.level * 1.6) : playing ? 0.7 : 0.35;
      (ring.material as THREE.MeshBasicMaterial).opacity = strength * (1 - r.age) * (1 - r.age);
    });
  });

  return (
    <group ref={group} position={pos} renderOrder={5}>
      <mesh renderOrder={5}>
        <circleGeometry args={[0.1, 24]} />
        <meshBasicMaterial color={color} toneMapped={false} depthTest={false} transparent />
      </mesh>
      {Array.from({ length: RINGS }, (_, i) => (
        <mesh key={i} renderOrder={5}>
          <ringGeometry args={[0.13, 0.15, 48]} />
          <meshBasicMaterial color={color} transparent toneMapped={false} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Hover label
// ---------------------------------------------------------------------------

function StationLabel({ station }: { station: Station }) {
  const pos = useMemo(() => latLongToVector3(station.lat, station.lon, DOT_R), [station]);
  const fam = FAMILY_BY_ID[station.family];
  const time = localTime(station.lat, station.lon);
  const tags = station.tags.slice(0, 3).join(" · ");
  return (
    <group position={pos}>
      <Html style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
        <div style={{ transform: "translate(-50%, calc(-100% - 18px))" }}>
          <div
            key={station.id}
            className="animate-in fade-in zoom-in-95 duration-150 bg-popover/75 backdrop-blur-sm text-popover-foreground px-3 py-2 rounded-lg shadow-xl border border-white/10 w-max max-w-[230px]"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: fam.color, boxShadow: `0 0 8px ${fam.color}` }} />
              <span className="font-semibold text-sm leading-tight break-words">{station.name}</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {placeLine(station)} · {time}
            </div>
            {tags && <div className="text-[11px] text-muted-foreground/80 italic truncate">{tags}</div>}
          </div>
        </div>
      </Html>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Proximity picking (Sun Chaser's approach): find the nearest visible dot to
// the pointer within a comfy radius, so nobody has to hit a 3-pixel target.
// Taps are told apart from drags by how far the pointer moved.
// ---------------------------------------------------------------------------

const RADIUS_MOUSE_PX = 18;
const RADIUS_TOUCH_PX = 30;
const TAP_MAX_MOVE_PX = 8;

function Picker({
  stations,
  matchMask,
  levels,
  onHover,
  onSelect,
}: {
  stations: Station[];
  matchMask: Uint8Array;
  levels: Float32Array;
  onHover: (s: Station | null) => void;
  onSelect: (s: Station) => void;
}) {
  const { camera, gl } = useThree();
  const pointer = useRef<{ x: number; y: number; touch: boolean } | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);
  const hovered = useRef<Station | null>(null);
  const clearTimer = useRef<number | undefined>();
  const frame = useRef(0);
  const positions = useMemo(() => stations.map((s) => latLongToVector3(s.lat, s.lon, DOT_R)), [stations]);
  const live = useRef({ stations, matchMask, levels, positions, onHover, onSelect });
  live.current = { stations, matchMask, levels, positions, onHover, onSelect };

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const camDir = useMemo(() => new THREE.Vector3(), []);

  const findNearest = (): Station | null => {
    const p = pointer.current;
    if (!p) return null;
    const { stations, matchMask, levels, positions } = live.current;
    // Only dots you can actually see (mostly faded in at this zoom)
    const shown = levelForDistance(camera.position.length()) + 0.5;
    const rect = gl.domElement.getBoundingClientRect();
    const radius = p.touch ? RADIUS_TOUCH_PX : RADIUS_MOUSE_PX;
    camDir.copy(camera.position).normalize();
    let best = -1;
    let bestD = radius;
    for (let i = 0; i < positions.length; i++) {
      if (!matchMask[i] || levels[i] > shown) continue;
      const w = positions[i];
      // Skip the far side of the globe (cheap check before projecting)
      if ((w.x * camDir.x + w.y * camDir.y + w.z * camDir.z) / DOT_R < 0.2) continue;
      tmp.copy(w).project(camera);
      const sx = ((tmp.x + 1) / 2) * rect.width;
      const sy = ((1 - tmp.y) / 2) * rect.height;
      const d = Math.hypot(sx - p.x, sy - p.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? stations[best] : null;
  };

  const setHovered = (s: Station | null) => {
    if (s?.id === hovered.current?.id) return;
    hovered.current = s;
    live.current.onHover(s);
    gl.domElement.style.cursor = s ? "pointer" : "";
  };

  useEffect(() => {
    const el = gl.domElement;
    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, touch: e.pointerType !== "mouse" };
    };
    const onMove = (e: PointerEvent) => {
      window.clearTimeout(clearTimer.current);
      pointer.current = local(e);
    };
    const onDown = (e: PointerEvent) => {
      window.clearTimeout(clearTimer.current);
      pointer.current = local(e);
      down.current = { x: e.clientX, y: e.clientY };
      setHovered(findNearest());
    };
    const onUp = (e: PointerEvent) => {
      const start = down.current;
      down.current = null;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_MAX_MOVE_PX) {
        pointer.current = local(e);
        const s = findNearest();
        if (s) live.current.onSelect(s);
      }
      if (e.pointerType !== "mouse") {
        // Fingers have no hover, so let the label linger a moment
        clearTimer.current = window.setTimeout(() => {
          pointer.current = null;
          setHovered(null);
        }, 1500);
      }
    };
    const onLeave = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      pointer.current = null;
      setHovered(null);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onLeave);
      window.clearTimeout(clearTimer.current);
    };
  }, [gl, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-check every few frames so the label tracks the globe as it moves
  useFrame(() => {
    if (frame.current++ % 4 !== 0 || !pointer.current) return;
    setHovered(findNearest());
  });

  return null;
}

// ---------------------------------------------------------------------------
// Camera: orbit controls plus Sun Chaser's arc-shaped fly-to (it travels
// around the globe rather than cutting through it).
// ---------------------------------------------------------------------------

export interface FlyTarget {
  lat: number;
  lon: number;
  id: number;
  /** Camera distance to end at (default: zoom in a little, never out) */
  distance?: number;
  durationMs?: number;
}

function CameraRig({ flyTarget, drifting }: { flyTarget: FlyTarget | null; drifting: boolean }) {
  const controls = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const { camera } = useThree();
  const anim = useRef<{
    start: number;
    startDir: THREE.Vector3;
    rot: THREE.Quaternion;
    startDist: number;
    endDist: number;
    ms: number;
  } | null>(null);

  useEffect(() => {
    if (!flyTarget) return;
    const target = latLongToVector3(flyTarget.lat, flyTarget.lon, 1).normalize();
    const startDir = camera.position.clone().normalize();
    const cur = camera.position.length();
    anim.current = {
      start: performance.now(),
      startDir,
      rot: new THREE.Quaternion().setFromUnitVectors(startDir, target),
      startDist: cur,
      endDist: flyTarget.distance ?? Math.min(cur, 5.8),
      ms: flyTarget.durationMs ?? 1400,
    };
    if (controls.current) controls.current.enabled = false;
  }, [flyTarget, camera]);

  useFrame(() => {
    const a = anim.current;
    if (a) {
      const t = Math.min((performance.now() - a.start) / a.ms, 1);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const q = new THREE.Quaternion().slerp(a.rot, e);
      camera.position.copy(a.startDir).applyQuaternion(q).multiplyScalar(a.startDist + (a.endDist - a.startDist) * e);
      controls.current?.update();
      if (t >= 1) {
        anim.current = null;
        if (controls.current) controls.current.enabled = true;
      }
    } else if (controls.current) {
      // Slower, finer rotation when zoomed in close
      const d = camera.position.length();
      controls.current.rotateSpeed = 0.04 + ((d - 2.12) / (11 - 2.12)) * 0.94;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      enablePan={false}
      minDistance={2.12}
      maxDistance={11}
      enableDamping
      dampingFactor={0.08}
      autoRotate={!drifting && !flyTarget}
      autoRotateSpeed={0.25}
      touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }}
    />
  );
}

// ---------------------------------------------------------------------------

function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface GlobeProps {
  stations: Station[];
  matchMask: Uint8Array;
  filtering: boolean;
  favIds: Set<string>;
  current: Station | null;
  playing: boolean;
  flyTarget: FlyTarget | null;
  drifting: boolean;
  onSelect: (s: Station) => void;
  /** Current loudness 0–1, or -1 when it can't be measured */
  getLevel?: () => number;
  /** Hidden-gems mode: quiet stations win their patch of the globe */
  preferQuiet?: boolean;
}

function Globe({ stations, matchMask, filtering, favIds, current, playing, flyTarget, drifting, onSelect, getLevel, preferQuiet = false }: GlobeProps) {
  // Even-density thinning: once for everyone, and again among the matches
  // when a search or filter is on
  const rank = preferQuiet ? rankQuiet : rankPopular;
  const levelsAll = useMemo(() => revealLevels(stations, null, rank), [stations, preferQuiet]); // eslint-disable-line react-hooks/exhaustive-deps
  const levels = useMemo(
    () => (filtering ? revealLevels(stations, matchMask, rank) : levelsAll),
    [filtering, matchMask, levelsAll] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [hover, setHover] = useState<Station | null>(null);
  // The playing station's label shows when you point at it, plus a short
  // peek when a new station starts (so you can see where you've landed)
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (!current) return;
    setPeek(true);
    const t = window.setTimeout(() => setPeek(false), 4000);
    return () => window.clearTimeout(t);
  }, [current?.id]);
  const [ok] = useState(webglOk);

  if (!ok) {
    return (
      <div className="h-full w-full flex items-center justify-center text-muted-foreground text-sm p-8 text-center">
        This device can't draw the 3D globe (WebGL is off). Search still works from the panel.
      </div>
    );
  }

  return (
    <Canvas
      // Further back on narrow phone screens so the whole planet fits
      camera={{ position: [0, 1.2, typeof window !== "undefined" && window.innerWidth / window.innerHeight < 0.7 ? 10.5 : 7.2], fov: 45 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      style={{ touchAction: "none" }}
    >
      <color attach="background" args={["#070914"]} />
      <Stars />
      <Suspense fallback={null}>
        <Earth />
      </Suspense>
      <StationDots stations={stations} matchMask={matchMask} filtering={filtering} favIds={favIds} levels={levels} levelsAll={levelsAll} />
      {current && <NowPlayingMarker station={current} playing={playing} getLevel={getLevel} />}
      {hover && hover.id !== current?.id && <StationLabel station={hover} />}
      {current && ((hover && hover.id === current.id) || (peek && !hover)) && <StationLabel station={current} />}
      <Picker stations={stations} matchMask={matchMask} levels={levels} onHover={setHover} onSelect={onSelect} />
      <CameraRig flyTarget={flyTarget} drifting={drifting} />
    </Canvas>
  );
}

// A faint, static starfield far behind the globe
function Stars() {
  const geom = useMemo(() => {
    const n = 1500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  return (
    <points geometry={geom}>
      <pointsMaterial size={0.18} color="#9aa3d6" transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  );
}

export default memo(Globe);
