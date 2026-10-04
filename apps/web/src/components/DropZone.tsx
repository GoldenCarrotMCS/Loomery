import { useCallback, useRef, useState } from "react";
import { useI18n } from "../i18n/index.js";
import { RichText } from "../i18n/RichText.js";

// Includes double extensions (.tar.gz), so match by suffix, not the last dot.
const VALID_EXTENSIONS = [".zip", ".mcpack", ".tar.gz", ".tgz"];
const MAX_FILE_SIZE = 512 * 1024 * 1024;
/**
 * Cap on the combined upload. Merging decompresses every pack into one tree in
 * the worker at once, so several large packs that each pass the per-file check
 * can still exhaust the tab's memory mid-conversion — which surfaces as a blank
 * crash rather than an error. Bound the total instead.
 */
const MAX_TOTAL_SIZE = 1024 * 1024 * 1024;

function PackageIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 8.5 12 4 3 8.5v7L12 20l9-4.5v-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M3 8.5 12 13l9-4.5M12 13v7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Staging area for the Java pack(s) to convert.
 *
 * More than one may be dropped: a Bedrock client can only be sent a single
 * pack, so a server running a stack of them (base + furniture + HUD) needs them
 * merged into one. Order is priority — the pack at the top wins any file two
 * packs both define, matching how Minecraft applies a pack list — so the list
 * is reorderable rather than a plain set.
 *
 * In the two-column layout the rail already shows the staged list, so this
 * renders only the drop target once something is staged.
 */
export function DropZone({
  onFiles,
  selected,
}: {
  onFiles: (files: File[]) => void;
  /** Staged packs in priority order; selection doesn't start the conversion. */
  selected: File[];
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const add = useCallback(
    (files: File[]) => {
      const accepted: File[] = [];
      const rejected: string[] = [];
      const isDuplicate = (f: File, list: File[]): boolean =>
        list.some((s) => s.name === f.name && s.size === f.size);
      let total = selected.reduce((n, f) => n + f.size, 0);
      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (!VALID_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
          rejected.push(t("drop.notSupported", { name: file.name }));
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          rejected.push(t("drop.tooBig", { name: file.name, limit: Math.round(MAX_FILE_SIZE / 1024 / 1024) }));
          continue;
        }
        // Check the incoming batch too, not just what is already staged: two
        // copies of one pack dropped together would otherwise both be added and
        // then collide on their React key, making the reorder buttons act on
        // the wrong row.
        if (isDuplicate(file, selected) || isDuplicate(file, accepted)) {
          rejected.push(t("drop.duplicate", { name: file.name }));
          continue;
        }
        if (total + file.size > MAX_TOTAL_SIZE) {
          rejected.push(t("drop.overTotal", { name: file.name, limit: Math.round(MAX_TOTAL_SIZE / 1024 / 1024) }));
          continue;
        }
        total += file.size;
        accepted.push(file);
      }
      // Report every rejection, even when something else in the same drop was
      // accepted — otherwise files vanish silently.
      setError(rejected.length > 0 ? rejected.join(" · ") : null);
      if (accepted.length > 0) onFiles([...selected, ...accepted]);
    },
    [onFiles, selected, t],
  );

  const total = selected.reduce((n, f) => n + f.size, 0);
  const hasFiles = selected.length > 0;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label={t("drop.title")}
        className={`dropzone${dragging ? " is-dragging" : ""}${hasFiles ? " has-files" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          dragCounter.current++;
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragCounter.current--;
          if (dragCounter.current <= 0) {
            dragCounter.current = 0;
            setDragging(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragCounter.current = 0;
          setDragging(false);
          add([...e.dataTransfer.files]);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        {!hasFiles && (
          <div className="dropzone-icon">
            <PackageIcon />
          </div>
        )}
        <div className="dropzone-title">
          {!hasFiles
            ? t("drop.title")
            : selected.length === 1
              ? selected[0]!.name
              : t("rail.packsCount", { count: selected.length })}
        </div>
        <div className="dropzone-sub">
          {!hasFiles
            ? t("drop.sub")
            : `${t("drop.another", { size: (total / 1024 / 1024).toFixed(1) })}`}
        </div>
        {!hasFiles && <div className="idle-hero-pill">{t("drop.pick")}</div>}
        {error !== null && (
          <div className="dropzone-error">
            <RichText text={error} />
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".zip,.mcpack,.tar.gz,.tgz,application/gzip"
          style={{ display: "none" }}
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
