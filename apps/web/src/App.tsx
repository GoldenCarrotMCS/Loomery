import { useCallback, useEffect, useRef, useState } from "react";
import { wrap, proxy, transfer, type Remote } from "comlink";
import type { ConvertResult } from "@loomery/core";
import type { WorkerApi } from "./worker/convert.worker.js";
import { packNameFor, packNamesFor, uploadLabelFor } from "./packNaming.js";
import { DropZone } from "./components/DropZone.js";
import { ProgressView } from "./components/ProgressView.js";
import { ResultView } from "./components/ResultView.js";
import { Intro } from "./components/Intro.js";
import { FeatureGrid, PluginRoster, Faq } from "./components/Marketing.js";
import { I18nProvider, useI18n, type LocaleId } from "./i18n/index.js";
import { RichText } from "./i18n/RichText.js";

type Phase =
  | { kind: "idle" }
  | { kind: "converting"; stage: string; done: number; total: number; fileName: string }
  | { kind: "done"; result: ConvertResult; fileName: string; packName: string }
  | { kind: "error"; message: string };

/** Inline SVG so the UI carries no icon-font or image dependency. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  );
}

function LanguageSwitcher() {
  const { locale, setLocale, locales } = useI18n();
  return (
    <label className="lang" title="Language">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as LocaleId)}
        aria-label="Language"
      >
        {locales.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** App-level i18n wrapper, so the inner component can use the hook. */
export function App() {
  return (
    <I18nProvider>
      <LoomeryApp />
    </I18nProvider>
  );
}

function LoomeryApp() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [attachableMaterial, setAttachableMaterial] = useState("entity_alphatest_one_sided");
  const [modernBaseItem, setModernBaseItem] = useState("minecraft:paper");
  const [maxAnimationFrames, setMaxAnimationFrames] = useState(0);
  const [optimizePack, setOptimizePack] = useState(true);
  const [maxCompression, setMaxCompression] = useState(false);
  const [animate2dHeldItems, setAnimate2dHeldItems] = useState(false);
  const [oxipngLevel, setOxipngLevel] = useState(4);
  const [showOptions, setShowOptions] = useState(false);
  const [configZips, setConfigZips] = useState<{ name: string; bytes: Uint8Array }[]>([]);
  // The pack is staged on drop, not converted — the user adds config zips and
  // tweaks options first, then presses Convert.
  const [packFiles, setPackFiles] = useState<File[]>([]);
  // Both refs point at the same worker: the raw handle so it can be terminated,
  // the comlink proxy for calls.
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Remote<WorkerApi> | null>(null);
  /**
   * Incremented on every cancel. Reading the staged files happens before the
   * worker exists, so Cancel during that window terminated nothing and the
   * in-flight run went on to spawn a worker and overwrite the idle screen with
   * a result the user had already dismissed. Each run captures the value and
   * drops its own updates once it no longer matches.
   */
  const runId = useRef(0);

  /**
   * Rejects if the worker dies. A worker that never starts — its chunk missing,
   * a parse error, module workers blocked — leaves every comlink call pending
   * forever, so the screen sat on the first stage with nothing to explain it.
   * Racing the call against this turns that into an error the user can act on.
   */
  const workerFailedRef = useRef<Promise<never> | null>(null);

  const getWorker = useCallback((): { api: Remote<WorkerApi>; failed: Promise<never> } => {
    if (apiRef.current === null || workerFailedRef.current === null) {
      const worker = new Worker(new URL("./worker/convert.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      apiRef.current = wrap<WorkerApi>(worker);
      const failed = new Promise<never>((_resolve, reject) => {
        worker.onerror = (event: ErrorEvent): void => {
          reject(
            new Error(
              `The background converter failed to start${event.message !== "" ? `: ${event.message}` : ""}. ` +
                `Reload the page and try again — if it keeps happening, your browser may be blocking module workers.`,
            ),
          );
        };
        worker.onmessageerror = (): void => {
          reject(new Error("The background converter sent a message this page could not read. Reload and try again."));
        };
      });
      // Only a running conversion awaits this; keep the browser from logging an
      // unhandled rejection while nothing is.
      failed.catch(() => {});
      workerFailedRef.current = failed;
    }
    return { api: apiRef.current, failed: workerFailedRef.current };
  }, []);

  const terminateWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    apiRef.current = null;
    workerFailedRef.current = null;
  }, []);

  const startConvert = useCallback(
    async (files: File[]) => {
      const myRun = runId.current;
      const stale = (): boolean => runId.current !== myRun;
      // Naming lives in packNaming.ts because packagingStage derives both
      // manifest UUIDs from packName — a constant name for merged packs gave
      // every merge the same identity, so two different merged packs would
      // overwrite each other on the Bedrock client.
      const packName = packNameFor(files);
      const label = uploadLabelFor(files);
      setPhase({ kind: "converting", stage: "reading files", done: 0, total: 1, fileName: label });
      try {
        // Read concurrently — order is merge priority, and Promise.all keeps it.
        // Sequential reads left the UI pinned at 0% for seconds on a big stack.
        const packs = await Promise.all(
          files.map(async (f) => new Uint8Array(await f.arrayBuffer())),
        );
        if (stale()) return;
        const { api, failed } = getWorker();
        const result = await Promise.race([failed, api.convert(
          transfer(packs, packs.map((p) => p.buffer)),
          {
            packName,
            packNames: packNamesFor(files),
            attachableMaterial, modernBaseItem, maxAnimationFrames, optimizePack, maxCompression, animate2dHeldItems,
          },
          proxy((stage: string, done: number, total: number) => {
            if (stale()) return;
            setPhase({ kind: "converting", stage, done, total, fileName: label });
          }),
          configZips.map((c) => {
            // Copy once — configZips state may be reused on a later conversion,
            // and transfer() neuters the buffer we hand off.
            const copy = c.bytes.slice();
            return transfer(copy, [copy.buffer]);
          }),
          oxipngLevel,
        )]);
        if (stale()) return;
        setPhase({ kind: "done", result, fileName: label, packName });
      } catch (err) {
        if (stale()) return;
        setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [getWorker, attachableMaterial, modernBaseItem, maxAnimationFrames, optimizePack, maxCompression, animate2dHeldItems, oxipngLevel, configZips],
  );

  // Terminate the worker on unmount to avoid leaking a thread.
  useEffect(() => {
    return () => { terminateWorker(); };
  }, [terminateWorker]);

  const cancelConversion = useCallback(() => {
    runId.current++;
    terminateWorker();
    setPhase({ kind: "idle" });
  }, [terminateWorker]);

  const busy = phase.kind === "converting";
  const canConvert = packFiles.length > 0 && !busy;

  return (
    <div className="shell">
      <header className="app-header">
        <div className="brand-row">
          <div className="brand">
            <span className="brand-mark">
              <BrandMark />
            </span>
            <span className="brand-name">Loomery</span>
          </div>
          <LanguageSwitcher />
        </div>
        <p className="tagline">
          <RichText text={t("header.tagline")} />
        </p>
        <div className="badge-row">
          <span className="badge">
            <span className="badge-dot" />
            {t("header.badgeLocal")}
          </span>
          <span className="badge">{t("header.badgePrivate")}</span>
          <span className="badge">{t("header.badgeOpenSource")}</span>
        </div>
      </header>

      {/* Scroll-driven hero: the 3D item disassembly that explains what the
          converter does, before the tool itself. */}
      <Intro />

      <div className="layout">
        {/* Left rail: everything the user configures, sticky so Convert and the
            staged pack list stay reachable while the workspace scrolls. */}
        <aside className="rail">
          <div className="rail-card">
            <div className="rail-card-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M21 8.5 12 4 3 8.5v7L12 20l9-4.5v-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                <path d="M3 8.5 12 13l9-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
              {t("rail.packs")}
            </div>
            {packFiles.length === 0 ? (
              <div className="rail-empty">
                <strong>{t("rail.empty")}</strong>
                <span>{t("rail.emptyHint")}</span>
              </div>
            ) : (
              <div className="rail-body">
                <div className="staged-note">
                  {packFiles.length === 1 ? t("rail.stagedHint") : <RichText text={t("rail.mergeHint")} />}
                </div>
                <div className="staged-rows">
                  {packFiles.map((file, i) => (
                    <div key={`${file.name}:${file.size}`} className="staged-row">
                      <span className="staged-index">{i + 1}</span>
                      <span className="staged-name" title={file.name}>
                        {file.name}
                      </span>
                      <span className="staged-size">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() => {
                          const next = [...packFiles];
                          if (i === 0) return;
                          const [item] = next.splice(i, 1);
                          next.splice(i - 1, 0, item!);
                          setPackFiles(next);
                        }}
                        disabled={i === 0}
                        aria-label={t("rail.moveUp")}
                        title={t("rail.moveUp")}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={() => {
                          const next = [...packFiles];
                          if (i === packFiles.length - 1) return;
                          const [item] = next.splice(i, 1);
                          next.splice(i + 1, 0, item!);
                          setPackFiles(next);
                        }}
                        disabled={i === packFiles.length - 1}
                        aria-label={t("rail.moveDown")}
                        title={t("rail.moveDown")}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="mini-btn mini-btn-danger"
                        onClick={() => setPackFiles(packFiles.filter((_, j) => j !== i))}
                        aria-label={t("rail.remove")}
                        title={t("rail.remove")}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rail-card">
            <div className="rail-card-title">{t("rail.options")}</div>
            <div className="rail-body">
              <label className="check">
                <input type="checkbox" checked={optimizePack} onChange={(e) => setOptimizePack(e.target.checked)} />
                <span>
                  <span className="check-title">{t("rail.optimize")}</span>
                  <span className="check-body">{t("rail.optimizeHint")}</span>
                </span>
              </label>
              {optimizePack && (
                <label className="check">
                  <input type="checkbox" checked={maxCompression} onChange={(e) => setMaxCompression(e.target.checked)} />
                  <span>
                    <span className="check-title">{t("rail.maxCompress")}</span>
                    <span className="check-body">{t("rail.maxCompressHint")}</span>
                  </span>
                </label>
              )}
              {optimizePack && maxCompression && (
                <div className="check-sub">
                  <div className="field-label">
                    {t("rail.effort", {
                      level: oxipngLevel,
                      tone:
                        oxipngLevel === 4 ? t("rail.effortFast") : oxipngLevel === 6 ? t("rail.effortSlow") : t("rail.effortBalanced"),
                    })}
                  </div>
                  <input
                    className="range"
                    type="range"
                    min={4}
                    max={6}
                    step={1}
                    value={oxipngLevel}
                    onChange={(e) => setOxipngLevel(Number(e.target.value))}
                    aria-label={t("rail.effort", { level: oxipngLevel, tone: "" })}
                  />
                  <span className="field-hint">{t("rail.effortHint")}</span>
                </div>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={animate2dHeldItems}
                  onChange={(e) => setAnimate2dHeldItems(e.target.checked)}
                />
                <span>
                  <span className="check-title">{t("rail.animate2d")}</span>
                  <span className="check-body">{t("rail.animate2dHint")}</span>
                </span>
              </label>

              <button className="disclosure" aria-expanded={showOptions} onClick={() => setShowOptions((v) => !v)}>
                <span className="disclosure-caret">▶</span>
                {t("rail.advanced")}
              </button>
              {showOptions && (
                <div className="rail-body">
                  <label className="field">
                    <span className="field-label">{t("rail.material")}</span>
                    <select
                      className="select"
                      value={attachableMaterial}
                      onChange={(e) => setAttachableMaterial(e.target.value)}
                    >
                      <option value="entity_alphatest_one_sided">entity_alphatest_one_sided (default)</option>
                      <option value="entity_alphatest">entity_alphatest</option>
                      <option value="entity">entity (opaque)</option>
                      <option value="entity_alphablend">entity_alphablend</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">{t("rail.baseItem")}</span>
                    <input
                      className="input"
                      value={modernBaseItem}
                      onChange={(e) => setModernBaseItem(e.target.value)}
                      placeholder="minecraft:paper"
                    />
                    <span className="field-hint">{t("rail.baseItemHint")}</span>
                  </label>
                  <label className="field">
                    <span className="field-label">{t("rail.frames")}</span>
                    <select
                      className="select"
                      value={maxAnimationFrames}
                      onChange={(e) => setMaxAnimationFrames(Number(e.target.value))}
                    >
                      <option value={0}>{t("rail.framesFull")}</option>
                      <option value={20}>{t("rail.framesN", { n: 20 })}</option>
                      <option value={10}>{t("rail.framesN", { n: 10 })}</option>
                      <option value={5}>{t("rail.framesN", { n: 5 })}</option>
                      <option value={1}>{t("rail.framesN", { n: 1 })}</option>
                    </select>
                    <span className="field-hint">{t("rail.framesHint")}</span>
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="rail-card">
            <div className="rail-card-title">{t("rail.configs")}</div>
            <div className="rail-body">
              <span className="field-hint">{t("rail.configsHint")}</span>
              <input
                className="file-input"
                type="file"
                accept=".zip"
                multiple
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  const loaded = await Promise.all(
                    files.map(async (file) => ({
                      name: file.name,
                      bytes: new Uint8Array(await file.arrayBuffer()),
                    })),
                  );
                  setConfigZips(loaded);
                }}
              />
              {configZips.length > 0 && (
                <div className="rail-configs">
                  <div className="badge" style={{ alignSelf: "flex-start" }}>
                    <span className="badge-dot" />
                    {configZips.length === 1
                      ? configZips[0]!.name
                      : t("rail.configsCount", { count: configZips.length })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rail-actions">
            <button
              className="btn btn-primary btn-lg"
              onClick={() => {
                if (canConvert) void startConvert(packFiles);
              }}
              disabled={!canConvert}
            >
              {t("convert.action")}
            </button>
            <span className="field-hint" style={{ textAlign: "center" }}>
              {packFiles.length === 0 ? t("convert.needPack") : t("convert.ready")}
            </span>
          </div>
        </aside>

        {/* Right column: the workspace, plus the reference content below it. */}
        <div className="main-col">
          <section className="workspace">
            <div className="workspace-bar">
              <span className="workspace-label">
                <span className="badge-dot" />
                {t("work.workspace")}
              </span>
              {phase.kind === "converting" && <span className="workspace-stage">{phase.stage}</span>}
            </div>

            {phase.kind === "idle" && (
              <DropZone onFiles={setPackFiles} selected={packFiles} />
            )}

            {phase.kind === "converting" && (
              <ProgressView
                stage={phase.stage}
                done={phase.done}
                total={phase.total}
                fileName={phase.fileName}
                onCancel={cancelConversion}
              />
            )}

            {phase.kind === "done" && (
              <ResultView
                result={phase.result}
                packName={phase.packName}
                onReset={() => setPhase({ kind: "idle" })}
              />
            )}

            {phase.kind === "error" && (
              <div className="callout callout-err" role="alert">
                <span className="callout-icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M12 7.5v5.5M12 16.2v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </span>
                <div className="callout-body" style={{ flex: 1 }}>
                  <div className="callout-title">{t("error.title")}</div>
                  <p className="callout-text">{phase.message}</p>
                  <button
                    className="btn btn-sm"
                    style={{ justifySelf: "flex-start", marginTop: 4 }}
                    onClick={() => setPhase({ kind: "idle" })}
                  >
                    {t("error.retry")}
                  </button>
                </div>
              </div>
            )}
          </section>

          <FeatureGrid />
          <PluginRoster />
          <Faq />
        </div>
      </div>

      <footer className="footer">
        <div>{t("footer.local")}</div>
        <div className="footer-links">
          <a href="https://github.com/GoldenCarrotMCS/Loomery" target="_blank" rel="noopener noreferrer">
            {t("footer.source")}
          </a>
          <span className="footer-sep">·</span>
          <a href="https://geysermc.org/wiki/geyser/custom-items/" target="_blank" rel="noopener noreferrer">
            {t("footer.docs")}
          </a>
          <span className="footer-sep">·</span>
          <span>{t("footer.license")}</span>
        </div>
      </footer>
    </div>
  );
}
