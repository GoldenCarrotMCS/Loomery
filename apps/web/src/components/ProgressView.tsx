import { useI18n } from "../i18n/index.js";

export function ProgressView({
  stage,
  done,
  total,
  fileName,
  onCancel,
}: {
  stage: string;
  done: number;
  total: number;
  fileName: string;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress-card" role="status" aria-live="polite">
      <div className="progress-head">
        <div className="progress-title" title={fileName}>
          {t("work.converting", { name: fileName })}
        </div>
        <div className="progress-pct">{pct}%</div>
      </div>
      <div className="progress-stage">{t("work.stage", { stage, done, total })}</div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("work.converting", { name: fileName })}
      >
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-hint">{t("work.cancelHint")}</div>
      {onCancel && (
        <div className="progress-actions">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>
            {t("work.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
