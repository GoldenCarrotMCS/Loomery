import { useMemo, useState } from "react";
import type { ConvertResult } from "@loomery/core";
import { useI18n } from "../i18n/index.js";

function download(name: string, data: Uint8Array | string, mime: string) {
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: mime })
      // Blob honours a view's byteOffset/byteLength, so passing the Uint8Array
      // directly avoids duplicating the whole archive in memory at the one
      // click the user cannot cheaply retry.
      : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Status → dot class + catalogue key. Dots instead of emoji so colour carries meaning. */
const STATUS_META: Record<string, { dot: string; key: string }> = {
  converted: { dot: "dot-converted", key: "result.statusConverted" },
  approximated: { dot: "dot-approximated", key: "result.statusApproximated" },
  skipped: { dot: "dot-skipped", key: "result.statusSkipped" },
  error: { dot: "dot-error", key: "result.statusError" },
};

const STATUS_ORDER = ["all", "converted", "approximated", "skipped", "error"] as const;

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 9.5v4M12 16.6v.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PanelTitle({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="panel-head">
      <span className="panel-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="panel-title">{title}</div>
        {sub !== undefined && <div className="panel-sub">{sub}</div>}
      </div>
    </div>
  );
}

export function ResultView({
  result,
  packName,
  onReset,
}: {
  result: ConvertResult;
  packName: string;
  onReset: () => void;
}) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<string>("all");
  const { summary, entries } = result.report;

  const visible = useMemo(
    () => (filter === "all" ? entries : entries.filter((e) => e.status === filter)),
    [entries, filter],
  );

  const statusLabel = (status: string): string =>
    STATUS_META[status] !== undefined ? t(STATUS_META[status]!.key) : status;

  const stats: { key: string; className: string; label: string }[] = [
    { key: "converted", className: "ok", label: t("result.statConverted") },
    { key: "approximated", className: "warn", label: t("result.statApproximated") },
    { key: "skipped", className: "", label: t("result.statSkipped") },
    { key: "error", className: "err", label: t("result.statErrors") },
  ];

  return (
    <div>
      <div className="results-head">
        <div className="results-title">
          <span className="results-check">
            <CheckIcon />
          </span>
          {t("result.done")}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onReset}>
          {t("result.again")}
        </button>
      </div>

      <div className="summary-grid">
        {stats.map((s) => (
          <div key={s.key} className={`stat ${s.className}`}>
            <div className="stat-value">{summary[s.key as keyof typeof summary] ?? 0}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="downloads">
        <button
          className="btn btn-primary"
          onClick={() => download(`${packName}.mcpack`, result.mcpack, "application/zip")}
        >
          ⬇ {packName}.mcpack
        </button>
        {result.geyserMappings !== undefined && (
          <button
            className="btn btn-accent-outline"
            onClick={() => download("geyser_mappings.json", result.geyserMappings!, "application/json")}
          >
            ⬇ geyser_mappings.json
          </button>
        )}
        {result.geyserBlockMappings !== undefined && (
          <button
            className="btn btn-accent-outline"
            onClick={() => download("geyser_blocks.json", result.geyserBlockMappings!, "application/json")}
          >
            ⬇ geyser_blocks.json
          </button>
        )}
        {result.displayEntityMappings !== undefined && (
          <button
            className="btn btn-accent-outline"
            onClick={() => download("geyser_displayentity_mappings.yml", result.displayEntityMappings!, "text/yaml")}
          >
            ⬇ {t("result.furnitureMappings")}
          </button>
        )}
        {result.displayEntityConfig !== undefined && (
          <button
            className="btn btn-warn"
            onClick={() => download("geyserdisplayentity_config.yml", result.displayEntityConfig!, "text/yaml")}
          >
            ⬇ {t("result.furnitureConfig")}
          </button>
        )}
        {result.modelEngineInput !== undefined && (
          <button
            className="btn btn-accent-outline"
            onClick={() => download("modelengine_input.zip", result.modelEngineInput!, "application/zip")}
          >
            ⬇ {t("result.modelEngine")}
          </button>
        )}
        <button
          className="btn"
          onClick={() =>
            download("conversion_report.json", JSON.stringify(result.report, null, 2), "application/json")
          }
        >
          ⬇ {t("result.reportJson")}
        </button>
      </div>

      <RequiredPlugins result={result} />

      <SetupGuide result={result} />

      <ConfigNudgeBanner entries={result.report.entries} onReset={onReset} />

      <PerfPanel timings={result.timings} />

      <div className="report-block">
        <PanelTitle
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
          }
          title={t("result.reportTitle")}
          sub={t("result.reportSub")}
        />

        <div className="chips">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              className={`chip${filter === s ? " is-active" : ""}`}
              aria-pressed={filter === s}
              onClick={() => setFilter(s)}
            >
              {s === "all" ? (
                <>
                  {t("result.all")} ({entries.length})
                </>
              ) : (
                <>
                  <span className={`dot ${STATUS_META[s]?.dot ?? ""}`} />
                  {statusLabel(s)} ({summary[s as keyof typeof summary] ?? 0})
                </>
              )}
            </button>
          ))}
        </div>

        <div className="report-scroll">
          <table className="report">
            <thead>
              <tr>
                <th>{t("result.columnStatus")}</th>
                <th>{t("result.columnStage")}</th>
                <th>{t("result.columnSource")}</th>
                <th>{t("result.columnDetail")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 2000).map((e, i) => (
                <tr key={i}>
                  <td className="cell-status" data-status={e.status}>
                    <span className={`dot ${STATUS_META[e.status]?.dot ?? ""}`} />
                    {statusLabel(e.status)}
                  </td>
                  <td>{e.stage}</td>
                  <td className="cell-source">{e.source}</td>
                  <td className="cell-detail">
                    {e.detail ?? (e.outputs && e.outputs.length > 0 ? e.outputs.join("; ") : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <div className="report-more">{t("result.empty")}</div>}
          {visible.length > 2000 && (
            <div className="report-more">{t("result.more", { count: visible.length - 2000 })}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Collapsible performance breakdown: per-stage durations + hot-op costs. */
function PerfPanel({ timings }: { timings: ConvertResult["timings"] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const stages = [...timings.stages].filter((s) => s.ms > 0).sort((a, b) => b.ms - a.ms);
  const total = timings.totalMs;
  return (
    <div className="panel" style={{ padding: open ? 20 : "14px 20px" }}>
      <button className="disclosure" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="disclosure-caret">▶</span>
        {t("result.perf", { total: fmtMs(total) })}
      </button>
      {open && (
        <div className="perf-grid">
          <div>
            <div className="perf-col-title">{t("result.perfStage")}</div>
            {stages.map((s) => (
              <PerfBar key={s.name} label={s.name} ms={s.ms} total={total} />
            ))}
          </div>
          <div>
            <div className="perf-col-title">{t("result.perfOps")}</div>
            {timings.ops.slice(0, 8).map((o) => (
              <PerfBar key={o.category} label={`${o.category} ×${o.count}`} ms={o.totalMs} total={total} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PerfBar({ label, ms, total }: { label: string; ms: number; total: number }) {
  const pct = total > 0 ? Math.round((ms / total) * 100) : 0;
  return (
    <div className="perf-row">
      <div className="perf-row-head">
        <span className="perf-name">{label}</span>
        <span className="perf-value">
          {fmtMs(ms)} · {pct}%
        </span>
      </div>
      <div className="perf-track">
        <div className="perf-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The Geyser plugins/extensions needed to actually use the converted output,
 * shown conditionally on what the conversion produced. */
function RequiredPlugins({ result }: { result: ConvertResult }) {
  const { t } = useI18n();
  const plugins: { name: string; url: string; note: string }[] = [
    { name: t("plugins.geyser"), url: "https://geysermc.org/download?project=geyser", note: t("plugins.geyserNote") },
    { name: t("plugins.floodgate"), url: "https://geysermc.org/download?project=floodgate", note: t("plugins.floodgateNote") },
  ];
  if (result.displayEntityMappings !== undefined) {
    plugins.push({
      name: t("plugins.displayEntity"),
      url: "https://github.com/GeyserExtensionists/GeyserDisplayEntity",
      note: t("plugins.displayEntityNote"),
    });
  }
  if (result.modelEngineInput !== undefined) {
    plugins.push(
      {
        name: t("plugins.modelEngine"),
        url: "https://github.com/GeyserExtensionists/GeyserModelEngine",
        note: t("plugins.modelEngineNote"),
      },
      {
        name: t("plugins.utils"),
        url: "https://github.com/GeyserExtensionists/GeyserUtils",
        note: t("plugins.utilsNote"),
      },
    );
  }

  return (
    <div className="panel">
      <PanelTitle
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3 4 6.5v5c0 4.6 3.2 8.4 8 9.5 4.8-1.1 8-4.9 8-9.5v-5L12 3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        }
        title={t("plugins.title")}
        sub={t("plugins.sub")}
      />
      <ul className="tick-list">
        {plugins.map((p) => (
          <li key={p.name}>
            <span className="tick">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.name}
              </a>
              <span style={{ color: "var(--muted)" }}> — {p.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Step-by-step install guide for the converted output, per artifact type. */
function SetupGuide({ result }: { result: ConvertResult }) {
  const { t } = useI18n();
  const code = (text: string) => <code>{text}</code>;
  const sections: { title: string; steps: React.ReactNode[] }[] = [];

  // 1. Base pack — always.
  const baseSteps: React.ReactNode[] = [<>{t("guide.base1")}</>, <>{t("guide.base2")}</>];
  if (result.geyserMappings !== undefined || result.geyserBlockMappings !== undefined) {
    const files = [
      result.geyserMappings && "geyser_mappings.json",
      result.geyserBlockMappings && "geyser_blocks.json",
    ]
      .filter(Boolean)
      .join(", ");
    baseSteps.push(<>{t("guide.base3", { files })}</>);
  }
  if (result.geyserBlockMappings !== undefined) {
    baseSteps.push(<>{t("guide.base4")}</>);
  }
  baseSteps.push(<>{t("guide.base5")}</>);
  sections.push({ title: t("guide.baseTitle"), steps: baseSteps });

  // 2. Furniture.
  if (result.displayEntityMappings !== undefined) {
    const f: React.ReactNode[] = [<>{t("guide.furniture1")}</>, <>{t("guide.furniture2")}</>];
    if (result.displayEntityConfig !== undefined) {
      f.push(
        <>
          {t("guide.furniture3")} <span className="req-tag">{t("guide.required")}</span>
        </>,
      );
    }
    f.push(<>{t("guide.furniture4")}</>);
    sections.push({ title: t("guide.furnitureTitle"), steps: f });
  }

  // 3. ModelEngine mobs.
  if (result.modelEngineInput !== undefined) {
    const n = result.displayEntityMappings !== undefined ? 3 : 2;
    sections.push({
      title: t("guide.mobTitle", { n }),
      steps: [
        <>{t("guide.mob1")}</>,
        <>{t("guide.mob2")}</>,
        <>{t("guide.mob3")}</>,
        <>{t("guide.mob4")}</>,
        <>{t("guide.mob5")}</>,
        <>{t("guide.mob6")}</>,
      ],
    });
  }

  return (
    <div className="panel">
      <PanelTitle
        icon={
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 4.5h11a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M5 16.5h13" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        }
        title={t("guide.title")}
        sub={t("guide.sub")}
      />
      <div>
        {sections.map((s) => (
          <div key={s.title} className="guide-section">
            <div className="guide-title">{s.title}</div>
            <ol className="guide-steps">
              {s.steps.map((step, i) => (
                <li key={i}>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigNudgeBanner({
  entries,
  onReset,
}: {
  entries: ConvertResult["report"]["entries"];
  onReset: () => void;
}) {
  const { t } = useI18n();
  const nudge = entries.find((e) => e.stage === "config-nudge");
  if (nudge === undefined) return null;
  return (
    <div className="callout callout-warn" role="status">
      <span className="callout-icon">
        <WarnIcon />
      </span>
      <div className="callout-body">
        <div className="callout-title">{t("nudge.title")}</div>
        <p className="callout-text">{nudge.detail}</p>
        <button className="btn btn-warn btn-sm" style={{ justifySelf: "flex-start", marginTop: 4 }} onClick={onReset}>
          {t("nudge.action")}
        </button>
      </div>
    </div>
  );
}
