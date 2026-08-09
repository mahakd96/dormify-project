import React, { useRef } from 'react';

// Accessible tab navigation (WAI-ARIA tabs pattern): role="tablist"/"tab",
// aria-selected, roving tabindex, and arrow-key navigation. Works
// identically in RTL and LTR because it navigates by DOM order, which the
// browser already reverses visually under dir="rtl" - no direction-specific
// logic needed here.
function AnalysisTabs({ tabs, activeTab, onChange, ariaLabel }) {
  const refs = useRef({});

  const focusTab = (id) => {
    refs.current[id]?.focus();
  };

  const handleKeyDown = (e, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    let nextIndex = index;
    if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    else if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    onChange(next.id);
    focusTab(next.id);
  };

  return (
    <div className="an-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const selected = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(el) => { refs.current[tab.id] = el; }}
            type="button"
            role="tab"
            id={`an-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`an-tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={`an-tab-btn ${selected ? 'active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default AnalysisTabs;
