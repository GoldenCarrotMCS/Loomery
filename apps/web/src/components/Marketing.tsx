import { useState } from "react";
import { useI18n } from "../i18n/index.js";
import { RichTextItalic } from "../i18n/RichText.js";

/** Small stroked glyphs, one per feature card, so the grid reads at a glance. */
type Icon = "texture" | "sword" | "gem" | "model" | "cube" | "armor" | "wings" | "loop" | "bow" | "block" | "chair" | "mob" | "sound" | "font" | "frame" | "merge";

const ICON_PATHS: Record<Icon, string> = {
  texture: "M4 5h16v14H4zM4 9h16M9 9v10",
  sword: "M14.5 3.5 20 9l-9 9-3-3 9-9ZM5 19l3-3M8 16l-2 4",
  gem: "M12 3 4.5 8.5 12 21l7.5-12.5L12 3ZM4.5 8.5h15M12 3v18",
  model: "M12 3 3 7.5v9L12 21l9-4.5v-9L12 3ZM3 7.5 12 12l9-4.5M12 12v9",
  cube: "M6 6h12v12H6zM6 10h12M10 6v12",
  armor: "M12 3 6 5.5v5c0 4 2.6 7.3 6 8.5 3.4-1.2 6-4.5 6-8.5v-5L12 3ZM9 12h6",
  wings: "M4 10c4-3 8-3 8 0 0-3 4-3 8 0-2 4-5 6-8 6s-6-2-8-6Z",
  loop: "M4 9a4 4 0 0 1 4-4h8l-2.5-2.5M20 15a4 4 0 0 1-4 4H8l2.5 2.5",
  bow: "M6 4c8 2 8 14 0 16M6 4v16M18 12h-6m6 0-2-2m2 2-2 2",
  block: "M3 9.5 12 5l9 4.5-9 4.5-9-4.5ZM3 14.5l9 4.5 9-4.5",
  chair: "M7 4v10M17 4v10M5 14h14M9 14v6M15 14v6",
  mob: "M8 4h8v6a4 4 0 0 1-4 4 4 4 0 0 1-4-4V4ZM10 8h.01M14 8h.01M9 17v3M15 17v3",
  sound: "M11 5 6.5 9H3v6h3.5L11 19V5ZM15 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10",
  font: "M5 19 12 5l7 14M8 14h8",
  frame: "M4 4h16v16H4zM8 8h8v8H8z",
  merge: "M7 4v6a4 4 0 0 0 4 4h6M14 11l3 3-3 3M7 20v-6",
};

function FeatureIcon({ icon }: { icon: Icon }) {
  return (
    <span className="feature-icon" aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
        <path d={ICON_PATHS[icon]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

const FEATURES: { icon: Icon; key: string }[] = [
  { icon: "texture", key: "vanilla" },
  { icon: "sword", key: "legacyItems" },
  { icon: "gem", key: "modernItems" },
  { icon: "frame", key: "sprites" },
  { icon: "model", key: "models3d" },
  { icon: "armor", key: "armor" },
  { icon: "wings", key: "elytra" },
  { icon: "loop", key: "flipbooks" },
  { icon: "bow", key: "bowPull" },
  { icon: "block", key: "blocks" },
  { icon: "chair", key: "furniture" },
  { icon: "mob", key: "mobs" },
  { icon: "sound", key: "sounds" },
  { icon: "font", key: "fonts" },
  { icon: "texture", key: "paintings" },
  { icon: "merge", key: "merge" },
];

/** What the converter handles, so a visitor knows before uploading anything. */
export function FeatureGrid() {
  const { t } = useI18n();
  return (
    <section className="panel">
      <div className="section-head">
        <h2 className="section-title">{t("features.title")}</h2>
        <p className="section-sub">{t("features.sub")}</p>
      </div>
      <div className="feature-grid">
        {FEATURES.map((f) => (
          <article className="feature" key={f.key}>
            <FeatureIcon icon={f.icon} />
            <div>
              <div className="feature-title">{t(`features.${f.key}.title`)}</div>
              <p className="feature-desc">{t(`features.${f.key}.desc`)}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const PLUGINS: { name: string; kind: "item" | "hud" | "mob"; desc: string }[] = [
  {
    name: "Oraxen",
    kind: "item",
    desc: "Items, blocks, furniture and armor sets from plugins/Oraxen/items.",
  },
  {
    name: "Nexo",
    kind: "item",
    desc: "Templates, and item_model components resolved through the <item_id> placeholder.",
  },
  {
    name: "ItemsAdder",
    kind: "item",
    desc: "contents/<ns>/configs, including variant_of templates and material-less item models.",
  },
  {
    name: "CraftEngine",
    kind: "item",
    desc: "Namespaced items plus furniture definitions and cross-file element references.",
  },
  {
    name: "HMCCosmetics",
    kind: "hud",
    desc: "Back-cosmetic items, positioned for Bedrock's armor-stand rendering.",
  },
  {
    name: "Datapacks",
    kind: "item",
    desc: "Loot tables, recipes, advancements and functions that bind a model to a vanilla item.",
  },
  {
    name: "ModelEngine",
    kind: "mob",
    desc: ".bbmodel blueprints become a GeyserModelEngine input bundle.",
  },
  {
    name: "MythicMobs",
    kind: "mob",
    desc: "Mob bindings and blueprint folders, scanned from the config or the pack.",
  },
];

/**
 * Which server plugins the converter reads configs from. This is the answer to
 * "why would I upload a second zip", so it earns its own section rather than a
 * footnote on the upload control.
 */
export function PluginRoster() {
  const { t } = useI18n();
  const KIND_LABEL: Record<string, string> = {
    item: "items",
    hud: "cosmetics",
    mob: "mobs",
  };
  return (
    <section className="panel">
      <div className="section-head">
        <h2 className="section-title">{t("pluginsRow.title")}</h2>
        <p className="section-sub">{t("pluginsRow.sub")}</p>
      </div>
      <div className="plugin-grid">
        {PLUGINS.map((p) => (
          <article className="plugin-card" key={p.name}>
            <div className="plugin-name">{p.name}</div>
            <span className="plugin-kind">{KIND_LABEL[p.kind]}</span>
            <p className="plugin-desc">{p.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5"] as const;

/** Accordion of the questions that come up before and after a first conversion. */
export function Faq() {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>("q1");
  return (
    <section className="panel">
      <div className="section-head">
        <h2 className="section-title">{t("faq.title")}</h2>
      </div>
      <div className="faq">
        {FAQ_KEYS.map((key) => {
          const expanded = open === key;
          return (
            <div className="faq-item" key={key}>
              <button
                className="faq-q"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : key)}
              >
                <span>
                  <RichTextItalic text={t(`faq.${key}`)} />
                </span>
                <span className="faq-caret">▶</span>
              </button>
              {expanded && (
                <p className="faq-a">
                  <RichTextItalic text={t(`faq.a${key.slice(1)}`)} />
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
