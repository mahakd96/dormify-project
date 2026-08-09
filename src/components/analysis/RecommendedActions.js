import React from 'react';
import { ArrowLeftRight, ArrowRightLeft, CheckCircle2 } from 'lucide-react';

// Converts real signals (already computed in analysisUtils.buildRecommendedActions)
// into forward-looking, actionable cards - distinct in wording from the
// Attention Queue above (which states *problems*; this states *next steps*).
// Never performs an allocation or transfer itself - every card only routes
// to an existing workflow/filtered view.
function RecommendedActions({ actions, t, isHebrew, onAction }) {
  const ArrowIcon = isHebrew ? ArrowLeftRight : ArrowRightLeft;

  return (
    <div className="an-section-card">
      <h2>{t.recommendedActionsTitle}</h2>
      <p className="an-section-sub">{t.recommendedActionsSubtitle}</p>

      {actions.length === 0 ? (
        <div className="an-empty-state">
          <CheckCircle2 size={28} color="#10b981" />
          <strong>{t.noActionsTitle}</strong>
          <span>{t.noActionsSub}</span>
        </div>
      ) : (
        <ul className="an-actions-list">
          {actions.map((item) => {
            const clickable = Boolean(item.action);
            return (
              <li key={item.id} className="an-action-card">
                <div className="an-action-body">
                  <span className="an-action-title">{isHebrew ? item.titleHe : item.titleEn}</span>
                  <span className="an-action-desc">{isHebrew ? item.descHe : item.descEn}</span>
                </div>
                <button
                  type="button"
                  className="an-action-cta"
                  disabled={!clickable}
                  title={!clickable ? t.actionUnavailable : undefined}
                  onClick={clickable ? () => onAction(item.action) : undefined}
                >
                  <ArrowIcon size={14} />
                  {isHebrew ? item.ctaHe : item.ctaEn}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default RecommendedActions;