import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "../i18n/index.js";

/**
 * Scroll-driven hero: a Java Edition item — flat pixel layers with alpha, the
 * way Java actually renders an item — dissolves into a textured Bedrock cube.
 *
 * The metaphor is literal, not decorative. Java draws an item as stacked
 * `layer0…layerN` planes; Bedrock needs six textured faces on real geometry. So
 * the timeline is the conversion:
 *
 *   0.00–0.24  the sprite, flat and whole            (Java)
 *   0.24–0.54  the layers peel apart and dissolve    (the conversion)
 *   0.54–0.80  six faces fly in and overshoot        (Bedrock geometry)
 *   0.80–1.00  hero pose, bloom, sparks              (the result)
 *
 * How it is built:
 *  - Pixel art is generated on a canvas at build-free runtime: a faceted gem
 *    sprite with per-pixel alpha for the Java layers, and a dithered block
 *    texture per face for Bedrock. Hand-drawn data URLs would be opaque binary
 *    blobs in the repo; this is readable code that scales to any DPI.
 *  - Pure CSS 3D (`perspective` + `preserve-3d`), no WebGL, no dependency.
 *  - Scroll sets a *target*; a rAF loop damps toward it. Direct scroll-linking
 *    stutters on trackpads and snaps on wheel flicks.
 *  - Purely decorative: `aria-hidden`, with every point also stated in the
 *    captions, so assistive tech loses nothing.
 *  - `prefers-reduced-motion` renders the finished cube and drops the runway.
 */

const N = 16; // Logical pixels per texture — Minecraft's native item resolution.
const PX = 6; // Device pixels per logical pixel, so the art stays crisp.
const SIZE = N * PX;

/** Faces: resting rotation, Bedrock-side brightness, and a hue for its texture. */
const FACES: { rotX: number; rotY: number; hue: number; light: number }[] = [
  { rotX: 0, rotY: 0, hue: 168, light: 0.92 },
  { rotX: 0, rotY: 180, hue: 160, light: 0.78 },
  { rotX: 0, rotY: 90, hue: 176, light: 0.85 },
  { rotX: 0, rotY: -90, hue: 152, light: 0.85 },
  { rotX: 90, rotY: 0, hue: 188, light: 1.08 },
  { rotX: -90, rotY: 0, hue: 146, light: 0.62 },
];

const JAVA_LAYERS = 4;
const HALF = 66; // Cube half-size in px.
const EXPLODE_R = 210; // Peak travel of a face at full disassembly.

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Smoothstep: eases a 0..1 segment so phases meet without a visible kink. */
const ease = (t: number): number => t * t * (3 - 2 * t);
/** Map v from [a,b] to 0..1, clamped. */
const range = (v: number, a: number, b: number): number => clamp01((v - a) / (b - a));

/** Deterministic per-pixel hash, so a texture is identical on every run. */
function noise(x: number, y: number): number {
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  return (h % 1000) / 1000;
}

function withContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/**
 * A faceted gem with real transparency — the Java item sprite.
 *
 * Drawn as a rhombus whose per-pixel lightness falls off along a light vector
 * from the upper left, with a hard outline on the silhouette and a two-pixel
 * specular sparkle. The alpha outside the silhouette is what makes it read as a
 * sprite rather than a card, and it is the reason the Java layers must be a
 * different element set from the opaque Bedrock faces.
 */
function gemSprite(): string {
  const ctx = withContext();
  if (ctx === null) return "";

  const halfWidth = [1, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 1];
  const cx = 7.5;
  const body = new Set<string>();
  const put = (x: number, y: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x * PX, y * PX, PX, PX);
  };

  // Body first: lightness swept along a light vector pointing up-left.
  for (let y = 0; y < N; y++) {
    const hw = halfWidth[y]!;
    const x0 = Math.round(cx - hw + 0.5);
    const x1 = Math.round(cx + hw - 0.5);
    for (let x = x0; x <= x1; x++) {
      body.add(`${x},${y}`);
      const dx = (x - cx) / 7.5;
      const dy = (y - 7.5) / 7.5;
      // Two facets meet on the diagonal, which is what gives a gem its cut.
      const facet = dx + dy < 0 ? 0 : 1;
      const l = 0.74 - 0.22 * (dx * 0.5 + dy * 0.5) - facet * 0.1 + noise(x, y) * 0.03;
      put(x, y, `hsl(347 76% ${(clamp01(l) * 100).toFixed(0)}%)`);
    }
  }

  // Outline: any body pixel with a non-body 4-neighbour. This is the single
  // biggest readability win in pixel art — without it the sprite is a blob.
  for (const key of [...body]) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    const edge =
      !body.has(`${x - 1},${y}`) ||
      !body.has(`${x + 1},${y}`) ||
      !body.has(`${x},${y - 1}`) ||
      !body.has(`${x},${y + 1}`);
    if (edge) put(x, y, "hsl(347 66% 20%)");
  }

  // Specular sparkle + a secondary glint, the touches that make it feel lit.
  put(5, 4, "hsl(350 100% 92%)");
  put(6, 3, "hsl(350 100% 96%)");
  put(6, 5, "hsl(350 90% 80%)");
  put(10, 11, "hsl(350 90% 76%)");

  return ctx.canvas.toDataURL("image/png");
}

/**
 * A Bedrock block-face texture: dithered base, darker 1px border, a couple of
 * lighter clusters and a lit top edge. That border-plus-dither is what a real
 * Bedrock texture looks like up close, and it is what stops the closed cube
 * from reading as a flat gradient box.
 */
function faceTexture(hue: number): string {
  const ctx = withContext();
  if (ctx === null) return "";

  const put = (x: number, y: number, color: string): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x * PX, y * PX, PX, PX);
  };

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = noise(x + hue, y + hue * 2);
      const border = x === 0 || y === 0 || x === N - 1 || y === N - 1;
      const cluster = (x * 3 + y * 5) % 11 < 2 && !border;
      const l = border ? 0.2 : cluster ? 0.42 : 0.32 + n * 0.1;
      put(x, y, `hsl(${hue} 42% ${(l * 100).toFixed(0)}%)`);
    }
  }
  // Lit top edge and a darker bottom edge fake upward light on the face.
  for (let x = 1; x < N - 1; x++) {
    put(x, 1, `hsl(${hue} 48% 46%)`);
    put(x, N - 2, `hsl(${hue} 44% 22%)`);
  }

  return ctx.canvas.toDataURL("image/png");
}

/** Deterministic particle field, so the sparks are stable across renders. */
function sparkField(count: number): { angle: number; radius: number; size: number; delay: number }[] {
  const out: { angle: number; radius: number; size: number; delay: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + noise(i, 7) * 0.9;
    out.push({ angle: a, radius: 0.6 + noise(i, 13) * 0.5, size: 2 + Math.round(noise(i, 21) * 3), delay: noise(i, 31) });
  }
  return out;
}

export function Intro() {
  const { t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);

  const textures = useMemo(
    () => ({
      sprite: gemSprite(),
      faces: FACES.map((f) => faceTexture(f.hue)),
    }),
    [],
  );
  const sparks = useMemo(() => sparkField(20), []);

  useEffect(() => {
    const section = sectionRef.current;
    const scene = sceneRef.current;
    if (section === null || scene === null) return;

    const javaLayers = [...scene.querySelectorAll<HTMLElement>(".iso-java")];
    const faces = [...scene.querySelectorAll<HTMLElement>(".iso-face")];
    const sparkEls = [...scene.querySelectorAll<HTMLElement>(".iso-spark")];
    const cube = scene.querySelector<HTMLElement>(".iso-cube");
    const floor = scene.querySelector<HTMLElement>(".iso-floor");
    const bloom = scene.querySelector<HTMLElement>(".iso-bloom");
    const captions = [...scene.parentElement!.querySelectorAll<HTMLElement>(".intro-caption")];
    const dots = [...scene.parentElement!.querySelectorAll<HTMLElement>(".intro-dot")];
    const rail = scene.parentElement!.querySelector<HTMLElement>(".intro-rail-fill");
    const javaTag = scene.parentElement!.querySelector<HTMLElement>(".intro-tag-java");
    const bedrockTag = scene.parentElement!.querySelector<HTMLElement>(".intro-tag-bedrock");
    if (cube === null) return;

    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    const readScroll = (): number => {
      const rect = section.getBoundingClientRect();
      const travel = rect.height - globalThis.innerHeight;
      if (travel <= 0) return 1;
      return clamp01(-rect.top / travel);
    };

    const paint = (p: number): void => {
      const spin = lerp(-30, 22, ease(p));
      const tilt = lerp(-22, -10, ease(p));
      const push = lerp(0.9, 1.1, ease(range(p, 0.55, 1)));
      cube.style.transform = `rotateX(${tilt}deg) rotateY(${spin}deg) scale(${push})`;

      // --- Java sprite: whole, then peeled apart and dissolved. -------------
      const peel = range(p, 0.22, 0.55);
      const dissolve = range(p, 0.34, 0.62);
      for (let i = 0; i < javaLayers.length; i++) {
        const el = javaLayers[i]!;
        const mid = i - (JAVA_LAYERS - 1) / 2;
        // Before the peel the layers breathe apart by a pixel or two, which is
        // enough to hint that the sprite is already stacked.
        const idle = 2.4 * Math.sin(p * Math.PI * 3 + i);
        const z = lerp(mid * 7 + idle, mid * 46, ease(peel));
        const spread = mid * 26 * ease(peel);
        el.style.transform = `translate3d(${spread}px, ${-spread * 0.35}px, ${z}px) rotateZ(${mid * 7 * ease(peel)}deg)`;
        el.style.opacity = String((1 - dissolve) * lerp(0.7, 1, clamp01(p * 5)));
        el.style.filter = `saturate(${lerp(0.9, 0.3, dissolve)}) brightness(${lerp(1, 1.5, dissolve)})`;
      }

      // --- Bedrock faces: fly in from a wide orbit, overshoot, settle. ------
      const appear = range(p, 0.3, 0.74);
      const settle = range(p, 0.62, 0.86);
      for (let i = 0; i < faces.length; i++) {
        const el = faces[i]!;
        const face = FACES[i]!;
        if (appear <= 0) {
          el.style.opacity = "0";
          continue;
        }
        // Each face approaches from its own direction, so the assembly reads as
        // six parts converging rather than one object scaling up.
        const dirX = Math.sin((i / faces.length) * Math.PI * 2) * EXPLODE_R;
        const dirY = Math.cos((i / faces.length) * Math.PI * 2) * EXPLODE_R * 0.62;
        const a = ease(appear);
        const overshoot = Math.sin(ease(settle) * Math.PI) * 1.06;
        const x = lerp(dirX, 0, a) * (1 - ease(settle) * 0) + overshoot * lerp(dirX, 0, a) * 0.06;
        const y = lerp(dirY, 0, a) + overshoot * lerp(dirY, 0, a) * 0.06;
        const z = lerp(EXPLODE_R * 0.6, HALF, a);
        el.style.transform = `translate3d(${x}px, ${y}px, ${z}px) rotateX(${lerp(face.rotX + 220, face.rotX, a)}deg) rotateY(${lerp(
          face.rotY + 200,
          face.rotY,
          a,
        )}deg)`;
        el.style.opacity = String(ease(appear));
      }

      // --- Sparks: burst outward as the faces converge. ---------------------
      const burst = Math.sin(range(p, 0.3, 0.95) * Math.PI);
      for (let i = 0; i < sparkEls.length; i++) {
        const el = sparkEls[i]!;
        const s = sparks[i]!;
        const r = (60 + s.radius * 150) * range(p, 0.3, 1);
        el.style.transform = `translate3d(${Math.cos(s.angle) * r}px, ${Math.sin(s.angle) * r * 0.7}px, ${lerp(
          -40,
          90,
          s.delay,
        )}px)`;
        el.style.opacity = String(burst * (0.25 + s.delay * 0.75));
      }

      // --- Environment: floor opens up, bloom swells at the hero pose. ------
      if (floor !== null) {
        floor.style.opacity = String(lerp(0.25, 0.85, ease(range(p, 0.15, 0.9))));
        floor.style.transform = `rotateX(74deg) translateZ(${lerp(-60, -110, ease(p))}px) scale(${lerp(0.8, 1.25, ease(p))})`;
      }
      if (bloom !== null) {
        bloom.style.opacity = String(range(p, 0.6, 1) * 0.85);
        bloom.style.transform = `translate(-50%, -50%) scale(${lerp(0.7, 1.35, ease(range(p, 0.55, 1)))})`;
      }

      // --- Captions, dots, rail, end labels. --------------------------------
      const step = p < 0.3 ? 0 : p < 0.62 ? 1 : 2;
      captions.forEach((el, i) => {
        const active = i === step;
        el.style.opacity = active ? "1" : "0";
        el.style.transform = active ? "translateY(0)" : "translateY(14px)";
      });
      dots.forEach((el, i) => el.classList.toggle("is-active", i === step));
      if (rail !== null) rail.style.width = `${(p * 100).toFixed(1)}%`;
      if (javaTag !== null) javaTag.style.opacity = String(1 - range(p, 0.18, 0.42));
      if (bedrockTag !== null) bedrockTag.style.opacity = String(range(p, 0.62, 0.88));
    };

    if (reduced) {
      section.dataset.reduced = "true";
      paint(1);
      return;
    }

    let frame = 0;
    let running = true;
    const tick = (): void => {
      if (!running) return;
      const target = readScroll();
      const delta = target - progressRef.current;
      // Damped follow; snap when close so the loop idles instead of burning a
      // frame's work on an invisible sub-pixel change.
      progressRef.current = Math.abs(delta) < 0.0004 ? target : progressRef.current + delta * 0.14;
      paint(progressRef.current);
      frame = globalThis.requestAnimationFrame(tick);
    };

    paint(0);
    frame = globalThis.requestAnimationFrame(tick);
    return () => {
      running = false;
      globalThis.cancelAnimationFrame(frame);
    };
  }, [sparks]);

  const steps: { title: string; desc: string }[] = [
    { title: t("intro.step1Title"), desc: t("intro.step1Desc") },
    { title: t("intro.step2Title"), desc: t("intro.step2Desc") },
    { title: t("intro.step3Title"), desc: t("intro.step3Desc") },
  ];
  const specs: { value: string; label: string }[] = [
    { value: t("intro.specLayersValue"), label: t("intro.specLayers") },
    { value: t("intro.specFacesValue"), label: t("intro.specFaces") },
    { value: t("intro.specGeoValue"), label: t("intro.specGeo") },
  ];

  return (
    <section className="intro" ref={sectionRef} aria-label={t("intro.title")}>
      <div className="intro-sticky">
        <div className="intro-grid-lines" aria-hidden="true" />

        <div className="intro-inner">
          <div className="intro-copy">
            <span className="intro-badge">{t("intro.badge")}</span>
            <h2 className="intro-title">{t("intro.title")}</h2>
            <p className="intro-sub">{t("intro.sub")}</p>

            <div className="intro-steps">
              {steps.map((s, i) => (
                <div className="intro-caption" key={i}>
                  <span className="intro-step-num">{i + 1}</span>
                  <div>
                    <div className="intro-step-title">{s.title}</div>
                    <p className="intro-step-desc">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="intro-specs">
              {specs.map((s) => (
                <div className="intro-spec" key={s.label}>
                  <span className="intro-spec-value">{s.value}</span>
                  <span className="intro-spec-label">{s.label}</span>
                </div>
              ))}
            </div>

            <div className="intro-rail">
              <div className="intro-rail-tags">
                <span className="intro-tag intro-tag-java">{t("intro.javaLabel")}</span>
                <span className="intro-tag intro-tag-bedrock">{t("intro.bedrockLabel")}</span>
              </div>
              <div className="intro-rail-track">
                <div className="intro-rail-fill" />
              </div>
              <div className="intro-dots">
                {steps.map((_, i) => (
                  <span className="intro-dot" key={i} />
                ))}
              </div>
            </div>
          </div>

          {/* Decorative — the captions carry all of the meaning. */}
          <div className="intro-stage" ref={sceneRef} aria-hidden="true">
            <div className="iso-scene">
              <div className="iso-bloom" />
              <div className="iso-floor" />

              <div className="iso-cube">
                {/* Java: four alpha sprites, stacked in Z. */}
                {Array.from({ length: JAVA_LAYERS }, (_, i) => (
                  <div
                    className="iso-java"
                    key={`j${i}`}
                    style={{ backgroundImage: `url(${textures.sprite})` }}
                  />
                ))}
                {/* Bedrock: six opaque textured faces. */}
                {FACES.map((f, i) => (
                  <div
                    className="iso-face"
                    key={`f${i}`}
                    data-face={i}
                    style={{ backgroundImage: `url(${textures.faces[i]})`, filter: `brightness(${f.light})` }}
                  />
                ))}
              </div>

              {sparks.map((s, i) => (
                <span
                  className="iso-spark"
                  key={`s${i}`}
                  style={{ width: s.size, height: s.size, animationDelay: `${s.delay * 0.9}s` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="intro-scroll-hint" aria-hidden="true">
          <span>{t("intro.scrollHint")}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </section>
  );
}
