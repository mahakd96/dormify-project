import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search, Loader2, Star, Accessibility, UserX, CheckCircle2, AlertTriangle,
  X, Building2, Home, DoorOpen, BedDouble, Users, Info, ShieldAlert, Send,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { assistedAllocationAPI, regionsAPI, dormInventoryAPI, requestsAPI } from '../services/api';
import AssistedCandidateBrowser from '../components/AssistedCandidateBrowser';

// Real, already-used Hebrew labels (BuildingsPage.js) - reused here rather
// than re-derived, so an apartment/building's gender value reads identically
// on every page.
const CATEGORY_LABEL_HE = { male: 'זכר', female: 'נקבה', mixed: 'מעורב' };
const RESTRICTION_LABEL_HE = { male: 'בנים בלבד', female: 'בנות בלבד', '': 'ללא הגבלה' };

const TAB_LABEL_HE = {
  needs_placement: 'לטיפול',
  accessibility: 'נגישות',
  unassigned: 'לא משובצים',
  resolved: 'טופלו',
};

const REASON_LABEL_HE = {
  NO_ACCEPTED_DORM_TYPE: 'לא הוגדר סוג מעונות לסטודנט',
  NO_PHYSICAL_FREE_BEDS_IN_ACCEPTED_DORM: 'אין מיטות פנויות בסוג המעונות שאליו התקבל/ה',
  HOUSING_TYPE_OR_GENDER_MISMATCH: 'המיטות הפנויות אינן תואמות למגדר/סוג הדיור',
  BUILDING_GENDER_RESTRICTION: 'מיטות פנויות קיימות, אך חסומות עקב הגבלת מגדר בבניין',
  RELIGION_OR_EXISTING_OCCUPANT_INCOMPATIBILITY: 'מיטות פנויות קיימות, אך אינן תואמות דתית',
  OTHER_HARD_CONSTRAINT_CONFLICT: 'לא נמצאה מיטה מתאימה',
};

const STATUS_LABEL_HE = {
  recommended: 'מומלץ',
  possible: 'אפשרי',
  override_required: 'דורש חריגה',
};

function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="aa-spin" />;
}

function MetricChip({ label, value, active, onClick, tone }) {
  return (
    <button type="button" className={`aa-metric aa-metric-${tone}${active ? ' aa-metric-active' : ''}`} onClick={onClick}>
      <span className="aa-metric-value">{value}</span>
      <span className="aa-metric-label">{label}</span>
    </button>
  );
}

function GroupBadge({ group }) {
  if (group === 'accessibility') return <span className="aa-badge aa-badge-accessibility"><Accessibility size={11} /> נגישות</span>;
  if (group === 'resolved') return <span className="aa-badge aa-badge-resolved"><CheckCircle2 size={11} /> טופל</span>;
  return <span className="aa-badge aa-badge-unassigned"><UserX size={11} /> לא משובץ</span>;
}

function StudentRow({ student, selected, onSelect }) {
  return (
    <button type="button" className={`aa-row${selected ? ' aa-row-selected' : ''}`} onClick={() => onSelect(student.student_db_id)}>
      <div className="aa-row-top">
        <span className="aa-row-name">{student.full_name}</span>
        <span className="aa-row-id">{student.student_id}</span>
        {student.is_priority && <Star size={12} className="aa-row-priority" fill="currentColor" />}
      </div>
      <div className="aa-row-tags">
        <GroupBadge group={student.group} />
        {student.gender_display && <span className="aa-tag">{student.gender_display}</span>}
        {student.region && <span className="aa-tag">{student.region}</span>}
        {student.accepted_dorm_type && <span className="aa-tag">{student.accepted_dorm_type}</span>}
        {student.is_transfer_requested && <span className="aa-tag aa-tag-transfer">בהעברה</span>}
      </div>
    </button>
  );
}

function ConfigOpportunityCard({ opportunity, canApply, onApply, applying, helpsSelected }) {
  const isApartment = opportunity.type === 'apartment_category';
  const currentLabel = isApartment
    ? CATEGORY_LABEL_HE[opportunity.current_category] || opportunity.current_category
    : RESTRICTION_LABEL_HE[opportunity.current_restriction] ?? opportunity.current_restriction;
  const proposedLabel = isApartment
    ? CATEGORY_LABEL_HE[opportunity.proposed_category] || opportunity.proposed_category
    : RESTRICTION_LABEL_HE[opportunity.proposed_restriction] ?? opportunity.proposed_restriction;
  const location = isApartment
    ? `בניין ${opportunity.building_number ?? ''} · דירה ${opportunity.apartment_number ?? ''}`
    : `בניין ${opportunity.building_number ?? ''}`;

  return (
    <div className={`aa-tier2-card${helpsSelected ? ' aa-tier2-card-highlight' : ''}`}>
      <div className="aa-tier2-head">
        <Building2 size={14} />
        <span className="aa-tier2-loc">{location}</span>
        <span className="aa-tier2-flip">{currentLabel} ← {proposedLabel}</span>
      </div>
      <div className="aa-tier2-impact">
        <span>{opportunity.unlocked_bed_count} מיטות יתפנו</span>
        <span>·</span>
        <span>מתאים ל־{opportunity.affected_student_count} סטודנטים בתור</span>
        {helpsSelected && <span className="aa-tier2-badge">רלוונטי לסטודנט/ית הנבחר/ת</span>}
      </div>
      {canApply ? (
        <button type="button" className="aa-btn aa-btn-secondary" disabled={applying} onClick={() => onApply(opportunity)}>
          {applying ? <Spinner size={13} /> : 'שינוי הגדרה'}
        </button>
      ) : (
        <span className="aa-tier2-locked"><Info size={12} /> נדרש מנהל לשינוי הגדרת דירה</span>
      )}
    </div>
  );
}

// Inline selection + confirmation panel - lives inside the main workspace
// (never a popup). Straightforward for a recommended/possible pick; for an
// override_required pick it expands to show every violated rule and its
// consequence, and requires a documented reason before the (visually
// distinct, cautionary) override button is enabled.
function SelectionPanel({ student, selection, onClear, onConfirm, confirming, error, note, onNoteChange }) {
  const isOverride = selection.assisted_status === 'override_required';
  return (
    <div className={`aa-selection-panel${isOverride ? ' aa-selection-panel-override' : ''}`}>
      <div className="aa-selection-head">
        <CheckCircle2 size={16} />
        <span>השיבוץ שנבחר</span>
        <button type="button" className="aa-icon-btn aa-selection-clear" onClick={onClear}><X size={13} /> נקה</button>
      </div>
      <div className="aa-selection-path">
        <span className="aa-sel-line"><Users size={12} /> סטודנט/ית: {student?.full_name}</span>
        <span className="aa-sel-line"><Building2 size={12} /> בניין: {selection.building_number}</span>
        <span className="aa-sel-line"><Home size={12} /> דירה: {selection.apartment_number}</span>
        <span className="aa-sel-line"><DoorOpen size={12} /> חדר: {selection.room_name}</span>
        <span className="aa-sel-line"><BedDouble size={12} /> מיטה: {selection.single_bed_room ? 'מקום יחיד' : selection.bed_label}</span>
      </div>
      <div className="aa-selection-status">
        <span className={`aa-pill aa-pill-${selection.assisted_status}`}>{STATUS_LABEL_HE[selection.assisted_status]}</span>
      </div>

      {selection.matched_reasons?.length > 0 && (
        <ul className="aa-selection-reasons aa-selection-reasons-good">
          {selection.matched_reasons.map((r, i) => <li key={i}><CheckCircle2 size={12} /> {r.label}</li>)}
        </ul>
      )}
      {selection.warnings?.length > 0 && (
        <ul className="aa-selection-reasons aa-selection-reasons-warn">
          {selection.warnings.map((r, i) => <li key={i}><AlertTriangle size={12} /> {r.label}</li>)}
        </ul>
      )}

      {isOverride && (
        <div className="aa-override-box">
          <div className="aa-override-title"><ShieldAlert size={14} /> חריגה מכללי השיבוץ</div>
          <ul className="aa-selection-reasons aa-selection-reasons-violation">
            {selection.override_violations.map((v, i) => (
              <li key={i}>
                <div><ShieldAlert size={12} /> {v.label}</div>
                {v.consequence && <div className="aa-violation-consequence">{v.consequence}</div>}
              </li>
            ))}
          </ul>
          <label className="aa-field-label">סיבת החריגה</label>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="לדוגמה: אין מקום אחר תואם באזור"
          />
        </div>
      )}

      {error && <div className="aa-modal-error"><AlertTriangle size={13} /> {error}</div>}

      <button
        type="button"
        className={`aa-btn ${isOverride ? 'aa-btn-danger' : 'aa-btn-primary'} aa-confirm-btn`}
        disabled={confirming || (isOverride && !note.trim())}
        onClick={onConfirm}
      >
        {confirming ? <Spinner size={13} /> : (isOverride ? 'אישור שיבוץ בחריגה' : 'אישור שיבוץ')}
      </button>
    </div>
  );
}

function ConfirmDialog({ title, onCancel, onConfirm, confirming, error, confirmLabel, children, danger }) {
  return (
    <div className="aa-modal-backdrop" onClick={onCancel}>
      <div className="aa-modal" onClick={(e) => e.stopPropagation()}>
        <div className="aa-modal-head">
          <h3>{title}</h3>
          <button type="button" className="aa-icon-btn" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="aa-modal-body">{children}</div>
        {error && <div className="aa-modal-error"><AlertTriangle size={13} /> {error}</div>}
        <div className="aa-modal-footer">
          <button type="button" className="aa-btn aa-btn-ghost" onClick={onCancel}>ביטול</button>
          <button
            type="button"
            className={`aa-btn ${danger ? 'aa-btn-danger' : 'aa-btn-primary'}`}
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? <Spinner size={13} /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AssistedAllocationPage() {
  const { user, isCentralAdmin, isRegionBoss, canAssistAllocation } = useAuth();
  const isBoss = isCentralAdmin() || isRegionBoss();

  const [regions, setRegions] = useState([]);
  const [region, setRegion] = useState('');

  const [tab, setTab] = useState('needs_placement');
  const [genderFilter, setGenderFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [queueData, setQueueData] = useState({ counts: {}, students: [] });
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [rec, setRec] = useState(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState('');
  const [selectedBed, setSelectedBed] = useState(null);
  const [overrideNote, setOverrideNote] = useState('');

  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [configDialog, setConfigDialog] = useState(null); // { opportunity, submitting, error }
  const [transferDialog, setTransferDialog] = useState(null); // { reason, submitting, error }

  useEffect(() => {
    if (isCentralAdmin()) {
      regionsAPI.getAll().then(setRegions).catch(() => setRegions([]));
    }
  }, []); // eslint-disable-line

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true);
    setQueueError('');
    try {
      const params = { tab };
      if (isCentralAdmin() && region) params.region = region;
      if (genderFilter) params.gender = genderFilter;
      if (search) params.search = search;
      const data = await assistedAllocationAPI.getQueue(params);
      setQueueData(data);
    } catch (err) {
      console.error('Failed to load assisted allocation queue:', err);
      setQueueError('לא ניתן לטעון את תור השיבוץ כרגע');
    } finally {
      setQueueLoading(false);
    }
  }, [tab, region, genderFilter, search]); // eslint-disable-line

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const selectStudent = (id) => {
    setSelectedId(id);
    setDetail(null); setDetailError('');
    setRec(null); setRecError(''); setSelectedBed(null); setOverrideNote('');
    setActionError(''); setSuccessMessage('');
  };

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    setDetailLoading(true);
    assistedAllocationAPI.getStudentDetail(selectedId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setDetailError(e.message || 'שגיאה בטעינת פרטי הסטודנט'); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  const fetchRecommendations = useCallback(async () => {
    if (!selectedId) return;
    setRecLoading(true);
    setRecError('');
    try {
      const data = await assistedAllocationAPI.getRecommendations(selectedId);
      setRec(data);
    } catch (e) {
      setRecError(e.message || 'שגיאה בטעינת אפשרויות שיבוץ');
    } finally {
      setRecLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { fetchRecommendations(); }, [fetchRecommendations]);

  const refreshAfterAction = () => {
    fetchQueue();
    const keepId = selectedId;
    setSelectedId(null);
    setTimeout(() => selectStudent(keepId), 0);
  };

  const handleSelectBed = (selection) => {
    setSelectedBed(selection);
    setOverrideNote('');
    setActionError('');
  };

  const handleConfirmSelection = async () => {
    if (!selectedBed) return;
    setConfirming(true);
    setActionError('');
    try {
      if (selectedBed.assisted_status === 'override_required') {
        await assistedAllocationAPI.override(selectedId, selectedBed.bed_id, overrideNote.trim());
        setSuccessMessage('השיבוץ בוצע בחריגה');
      } else {
        await assistedAllocationAPI.assign(selectedId, selectedBed.bed_id);
        setSuccessMessage('הסטודנט שובץ בהצלחה');
      }
      refreshAfterAction();
    } catch (e) {
      setActionError(e.message || 'השיבוץ נכשל');
    } finally {
      setConfirming(false);
    }
  };

  const openConfigDialog = (opportunity) => setConfigDialog({ opportunity, submitting: false, error: '' });

  const confirmConfigChange = async () => {
    const { opportunity } = configDialog;
    setConfigDialog((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      if (opportunity.type === 'apartment_category') {
        await dormInventoryAPI.updateApartment(opportunity.apartment_id, { category: opportunity.proposed_category });
      } else {
        await dormInventoryAPI.updateBuilding(opportunity.building_id, { gender_restriction: opportunity.proposed_restriction });
      }
      setConfigDialog(null);
      setSuccessMessage('הגדרת הדירה עודכנה');
      fetchQueue();
      fetchRecommendations();
    } catch (e) {
      setConfigDialog((prev) => ({ ...prev, submitting: false, error: e.message || 'עדכון ההגדרה נכשל' }));
    }
  };

  const openTransferDialog = () => setTransferDialog({ reason: '', submitting: false, error: '' });

  const confirmTransfer = async () => {
    if (!transferDialog?.reason?.trim()) {
      setTransferDialog((prev) => ({ ...prev, error: 'יש להזין סיבה' }));
      return;
    }
    setTransferDialog((prev) => ({ ...prev, submitting: true, error: '' }));
    try {
      await requestsAPI.create({
        student: selectedId,
        request_type: 'region_transfer',
        reason: transferDialog.reason.trim(),
        priority: 'high',
      });
      setTransferDialog(null);
      setSuccessMessage('בקשת ההעברה נשלחה');
      refreshAfterAction();
    } catch (e) {
      setTransferDialog((prev) => ({ ...prev, submitting: false, error: e.message || 'שליחת הבקשה נכשלה' }));
    }
  };

  const counts = queueData.counts || {};
  const students = queueData.students || [];

  const emptyQueueMessage = useMemo(() => {
    if (queueLoading || students.length > 0) return null;
    if (tab === 'accessibility') return 'כל שיבוצי הנגישות הושלמו';
    if (tab === 'unassigned') return 'כל הסטודנטים באזור שובצו';
    if (tab === 'resolved') return 'אין פעולות שיבוץ שבוצעו עדיין';
    return 'אין סטודנטים הממתינים לטיפול';
  }, [queueLoading, students.length, tab]);

  const noCandidatesInDormType = !recLoading && !recError && rec?.candidates && (rec.candidates.total_valid_beds || 0) === 0;

  return (
    <div className="aa-page">
      <div className="aa-header">
        <div className="aa-header-title">
          <h1>שיבוץ מסייע</h1>
          <p>נגישות, סטודנטים לא משובצים ושיבוץ בסיוע הצוות</p>
        </div>
        {isCentralAdmin() && (
          <select className="aa-region-select" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">כל האזורים</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        )}
      </div>

      <div className="aa-metrics">
        <MetricChip label={TAB_LABEL_HE.needs_placement} value={counts.needs_placement ?? '—'} tone="blue" active={tab === 'needs_placement'} onClick={() => setTab('needs_placement')} />
        <MetricChip label={TAB_LABEL_HE.accessibility} value={counts.accessibility_pending ?? '—'} tone="violet" active={tab === 'accessibility'} onClick={() => setTab('accessibility')} />
        <MetricChip label={TAB_LABEL_HE.unassigned} value={counts.unassigned ?? '—'} tone="amber" active={tab === 'unassigned'} onClick={() => setTab('unassigned')} />
        <MetricChip label={TAB_LABEL_HE.resolved} value={counts.resolved ?? '—'} tone="green" active={tab === 'resolved'} onClick={() => setTab('resolved')} />
        <MetricChip label="בהעברה" value={counts.transfer_requested ?? '—'} tone="gray" active={false} onClick={() => {}} />
      </div>

      <div className="aa-body">
        <div className="aa-queue">
          <div className="aa-queue-controls">
            <div className="aa-search">
              <Search size={14} />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="חיפוש לפי שם / ת.ז..." />
            </div>
            <select value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
              <option value="">כל המגדרים</option>
              <option value="male">זכר</option>
              <option value="female">נקבה</option>
            </select>
          </div>

          <div className="aa-queue-list">
            {queueLoading ? (
              <div className="aa-center-pad"><Spinner /></div>
            ) : queueError ? (
              <div className="aa-error-pane">{queueError}</div>
            ) : emptyQueueMessage ? (
              <div className="aa-empty-pane">{emptyQueueMessage}</div>
            ) : (
              students.map((s) => (
                <StudentRow key={s.student_db_id} student={s} selected={s.student_db_id === selectedId} onSelect={selectStudent} />
              ))
            )}
          </div>
        </div>

        <div className="aa-detail">
          {!selectedId ? (
            <div className="aa-empty-pane aa-empty-pane-large">בחרו סטודנט מהרשימה כדי להתחיל</div>
          ) : detailLoading ? (
            <div className="aa-center-pad"><Spinner /></div>
          ) : detailError ? (
            <div className="aa-error-pane">{detailError}</div>
          ) : detail ? (
            <>
              {successMessage && (
                <div className="aa-success-banner">
                  <CheckCircle2 size={14} /> {successMessage}
                  <button type="button" className="aa-icon-btn" onClick={() => setSuccessMessage('')}><X size={13} /></button>
                </div>
              )}

              <div className="aa-student-summary">
                <div className="aa-student-summary-head">
                  <h2>{detail.student.full_name}</h2>
                  <GroupBadge group={detail.student.group} />
                </div>
                <div className="aa-fact-grid">
                  <div><span>ת.ז</span><strong>{detail.student.student_id}</strong></div>
                  <div><span>מגדר</span><strong>{detail.student.gender_display || '—'}</strong></div>
                  <div><span>דת</span><strong>{detail.student.religion_display || '—'}</strong></div>
                  <div><span>אזור</span><strong>{detail.student.region || '—'}</strong></div>
                  <div><span>סוג מעונות</span><strong>{detail.student.accepted_dorm_type || '—'}</strong></div>
                  <div><span>סוג דיור</span><strong>{detail.student.housing_type_display || '—'}</strong></div>
                </div>
                {detail.student.is_priority && (
                  <div className="aa-note-line aa-note-priority"><Star size={13} fill="currentColor" /> עדיפות{detail.student.priority_reason ? ` — ${detail.student.priority_reason}` : ''}</div>
                )}
                {detail.student.accessibility_flag && (
                  <div className="aa-note-line aa-note-accessibility">
                    <Accessibility size={13} />
                    נגישות{detail.student.medical_reason ? ` — ${detail.student.medical_reason}` : ''}
                    {detail.student.disability_percent ? ` (${detail.student.disability_percent}%)` : ''}
                  </div>
                )}
                {detail.roommate_requests?.length > 0 && (
                  <div className="aa-note-line"><Users size={13} /> בקשת שותף: {detail.roommate_requests.map((r) => r.name).join(', ')}</div>
                )}
              </div>

              {detail.reason && (
                <div className="aa-reason-banner">
                  <AlertTriangle size={14} />
                  <div>
                    <div className="aa-reason-title">{REASON_LABEL_HE[detail.reason.reason_code] || 'לא נמצא שיבוץ מתאים'}</div>
                    {detail.reason.inventory_breakdown?.length > 0 && (
                      <div className="aa-reason-breakdown">
                        {detail.reason.inventory_breakdown.map((b, i) => (
                          <span key={i} className="aa-tag">{b.category_display} · {b.apartment_type_display}: {b.free_beds} פנויות</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {actionError && <div className="aa-error-pane">{actionError}</div>}

              <div className="aa-tiers">
                <section className="aa-tier">
                  <h3>אפשרויות שיבוץ{rec?.accepted_dorm_type ? ` — ${rec.accepted_dorm_type.name}` : ''}</h3>
                  {recLoading ? (
                    <div className="aa-center-pad"><Spinner /></div>
                  ) : recError ? (
                    <div className="aa-error-pane">{recError}</div>
                  ) : rec?.candidates ? (
                    <>
                      <AssistedCandidateBrowser
                        candidates={rec.candidates}
                        selectedBedId={selectedBed?.bed_id ?? null}
                        onSelectBed={handleSelectBed}
                      />
                      {selectedBed && (
                        <SelectionPanel
                          student={detail.student}
                          selection={selectedBed}
                          onClear={() => handleSelectBed(null)}
                          onConfirm={handleConfirmSelection}
                          confirming={confirming}
                          error={actionError}
                          note={overrideNote}
                          onNoteChange={setOverrideNote}
                        />
                      )}
                    </>
                  ) : null}
                </section>

                {(rec?.config_opportunities?.length > 0 || rec?.has_unsafe_config_candidates) && (
                  <section className="aa-tier">
                    <h3>אפשרויות לשינוי הגדרת דירה</h3>
                    <p className="aa-tier-hint">לפעמים המלאי קיים, אך הגדרת דירה/בניין מונעת שיבוץ — שינוי ההגדרה יפתח מיטות לשיבוץ ויחשב מחדש את האפשרויות</p>
                    {rec.config_opportunities?.length > 0 && (
                      <div className="aa-tier2-list">
                        {rec.config_opportunities.map((o, i) => (
                          <ConfigOpportunityCard
                            key={i}
                            opportunity={o}
                            canApply={isBoss}
                            applying={configDialog?.opportunity === o && configDialog?.submitting}
                            onApply={openConfigDialog}
                            helpsSelected={!!o.helps_selected_student}
                          />
                        ))}
                      </div>
                    )}
                    {rec.has_unsafe_config_candidates && (
                      <div className="aa-tier2-note">
                        <Info size={13} />
                        קיימות מיטות פנויות נוספות בדירות מאוכלסות, ולכן לא ניתן לשנות את הגדרתן
                      </div>
                    )}
                  </section>
                )}

                <section className="aa-tier">
                  <h3>שליחה להעברה</h3>
                  <p className="aa-tier-hint">
                    {noCandidatesInDormType
                      ? 'לא נמצא שיבוץ מתאים בסוג המעונות שאושר לסטודנט/ית — ניתן לשלוח בקשת העברה לבדיקת אפשרויות נוספות'
                      : 'אין פתרון מתאים בסוג המעונות שאושר לסטודנט/ית? ניתן לשלוח בקשת העברה לבדיקה מחוץ לסוג המעונות הנוכחי'}
                  </p>
                  <button type="button" className={`aa-btn ${noCandidatesInDormType ? 'aa-btn-primary' : 'aa-btn-secondary'}`} onClick={openTransferDialog}>
                    <Send size={13} /> יצירת בקשת העברה
                  </button>
                </section>
              </div>

              {detail.history?.length > 0 && (
                <section className="aa-tier">
                  <h3>היסטוריית פעולות</h3>
                  <div className="aa-history-list">
                    {detail.history.map((h, i) => (
                      <div key={i} className="aa-history-row">
                        <span className="aa-tag">{h.action_type_display}</span>
                        <span>{h.actor_name || '—'}</span>
                        {h.note && <span className="aa-history-note">{h.note}</span>}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : null}
        </div>
      </div>

      {configDialog && (
        <ConfirmDialog
          title="שינוי הגדרת דירה"
          onCancel={() => setConfigDialog(null)}
          onConfirm={confirmConfigChange}
          confirming={configDialog.submitting}
          error={configDialog.error}
          confirmLabel="אישור שינוי"
        >
          <div className="aa-note-line">
            {configDialog.opportunity.type === 'apartment_category'
              ? `בניין ${configDialog.opportunity.building_number} · דירה ${configDialog.opportunity.apartment_number}`
              : `בניין ${configDialog.opportunity.building_number}`}
          </div>
          <div className="aa-tier2-flip">
            {configDialog.opportunity.type === 'apartment_category'
              ? `${CATEGORY_LABEL_HE[configDialog.opportunity.current_category]} ← ${CATEGORY_LABEL_HE[configDialog.opportunity.proposed_category]}`
              : `${RESTRICTION_LABEL_HE[configDialog.opportunity.current_restriction]} ← ${RESTRICTION_LABEL_HE[configDialog.opportunity.proposed_restriction]}`}
          </div>
          <div className="aa-note-line">{configDialog.opportunity.unlocked_bed_count} מיטות יתפנו לשיבוץ</div>
        </ConfirmDialog>
      )}

      {transferDialog && (
        <ConfirmDialog
          title="בקשת העברה לאזור אחר"
          onCancel={() => setTransferDialog(null)}
          onConfirm={confirmTransfer}
          confirming={transferDialog.submitting}
          error={transferDialog.error}
          confirmLabel="שליחת בקשה"
        >
          <label className="aa-field-label">סיבה</label>
          <textarea
            rows={3}
            value={transferDialog.reason}
            onChange={(e) => setTransferDialog((prev) => ({ ...prev, reason: e.target.value }))}
            placeholder="לדוגמה: אין מקום פנוי באזור התואם לסטודנט"
          />
        </ConfirmDialog>
      )}

      <style>{`
        .aa-page { padding: 24px; direction: rtl; font-family: inherit; color: #172b4d; }
        .aa-spin { animation: aa-spin 0.8s linear infinite; }
        @keyframes aa-spin { to { transform: rotate(360deg); } }

        .aa-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 16px; }
        .aa-header-title h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
        .aa-header-title p { color: #5e6c84; font-size: 13.5px; }
        .aa-region-select { border: 1px solid #dfe1e6; border-radius: 8px; padding: 8px 12px; font-family: inherit; font-size: 13px; background: #fff; }

        .aa-metrics { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px; }
        .aa-metric {
          display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
          padding: 10px 16px; border-radius: 10px; border: 1px solid transparent;
          background: #fff; box-shadow: 0 1px 2px rgba(23,43,77,0.08); cursor: pointer; font-family: inherit;
          min-width: 96px;
        }
        .aa-metric-value { font-size: 19px; font-weight: 700; }
        .aa-metric-label { font-size: 12px; color: #5e6c84; }
        .aa-metric-active { border-color: currentColor; }
        .aa-metric-blue { color: #0052cc; }
        .aa-metric-violet { color: #5243aa; }
        .aa-metric-amber { color: #974f0c; }
        .aa-metric-green { color: #006644; }
        .aa-metric-gray { color: #5e6c84; cursor: default; }

        .aa-body { display: grid; grid-template-columns: 320px 1fr; gap: 16px; align-items: start; }
        @media (max-width: 980px) { .aa-body { grid-template-columns: 1fr; } }

        .aa-queue { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(23,43,77,0.1); padding: 14px; display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 220px); }
        .aa-queue-controls { display: flex; flex-direction: column; gap: 8px; }
        .aa-search { display: flex; align-items: center; gap: 8px; border: 1px solid #dfe1e6; border-radius: 8px; padding: 8px 10px; }
        .aa-search svg { color: #97a0af; }
        .aa-search input { border: none; outline: none; flex: 1; font-family: inherit; font-size: 13px; }
        .aa-queue-controls select { border: 1px solid #dfe1e6; border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 13px; }
        .aa-queue-list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }

        .aa-row { display: flex; flex-direction: column; gap: 6px; text-align: right; border: 1px solid #ebecf0; border-radius: 10px; padding: 10px 12px; background: #fff; cursor: pointer; font-family: inherit; }
        .aa-row:hover { background: #f8f9fb; }
        .aa-row-selected { border-color: #4c9aff; background: #deebff; }
        .aa-row-top { display: flex; align-items: center; gap: 6px; }
        .aa-row-name { font-weight: 700; font-size: 14px; }
        .aa-row-id { font-size: 11.5px; color: #97a0af; }
        .aa-row-priority { color: #974f0c; margin-inline-start: auto; }
        .aa-row-tags { display: flex; flex-wrap: wrap; gap: 5px; }

        .aa-tag { font-size: 11px; background: #f4f5f7; color: #42526e; padding: 2px 8px; border-radius: 999px; }
        .aa-tag-transfer { background: #eae6ff; color: #5243aa; }

        .aa-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
        .aa-badge-accessibility { background: #eae6ff; color: #5243aa; }
        .aa-badge-unassigned { background: #fff7e6; color: #974f0c; }
        .aa-badge-resolved { background: #e3fcef; color: #006644; }

        .aa-detail { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(23,43,77,0.1); padding: 18px; min-height: 400px; }
        .aa-center-pad { display: flex; justify-content: center; padding: 30px; color: #97a0af; }
        .aa-empty-pane { text-align: center; padding: 24px; color: #97a0af; font-size: 13.5px; }
        .aa-empty-pane-large { padding: 100px 24px; }
        .aa-error-pane { background: #ffebe6; color: #bf2600; border-radius: 8px; padding: 12px 14px; font-size: 13.5px; margin-bottom: 10px; }

        .aa-success-banner { display: flex; align-items: center; gap: 8px; background: #e3fcef; color: #006644; border-radius: 8px; padding: 10px 12px; font-size: 13.5px; font-weight: 600; margin-bottom: 14px; }
        .aa-success-banner .aa-icon-btn { margin-inline-start: auto; }

        .aa-student-summary { border-bottom: 1px solid #ebecf0; padding-bottom: 14px; margin-bottom: 14px; }
        .aa-student-summary-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .aa-student-summary-head h2 { font-size: 18px; font-weight: 700; }
        .aa-fact-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin-bottom: 8px; }
        .aa-fact-grid div { display: flex; flex-direction: column; gap: 2px; }
        .aa-fact-grid span { font-size: 11.5px; color: #97a0af; }
        .aa-fact-grid strong { font-size: 13.5px; font-weight: 600; }
        .aa-note-line { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #42526e; margin-top: 6px; }
        .aa-note-priority { color: #974f0c; }
        .aa-note-accessibility { color: #5243aa; }

        .aa-reason-banner { display: flex; gap: 10px; background: #fff7e6; border: 1px solid #ffc400; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
        .aa-reason-banner svg { color: #974f0c; flex-shrink: 0; margin-top: 2px; }
        .aa-reason-title { font-weight: 700; font-size: 13.5px; margin-bottom: 6px; }
        .aa-reason-breakdown { display: flex; flex-wrap: wrap; gap: 6px; }

        .aa-tiers { display: flex; flex-direction: column; gap: 22px; }
        .aa-tier h3 { font-size: 14.5px; font-weight: 700; margin-bottom: 8px; }
        .aa-tier-hint { font-size: 12.5px; color: #5e6c84; margin-bottom: 10px; }

        .aa-tier2-list { display: flex; flex-direction: column; gap: 8px; }
        .aa-tier2-card { border: 1px solid #ebecf0; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
        .aa-tier2-card-highlight { border-color: #4c9aff; background: #f0f7ff; }
        .aa-tier2-head { display: flex; align-items: center; gap: 8px; font-size: 13px; }
        .aa-tier2-head svg { color: #5e6c84; }
        .aa-tier2-flip { font-weight: 700; }
        .aa-tier2-impact { font-size: 12.5px; color: #5e6c84; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        .aa-tier2-badge { font-size: 11px; font-weight: 800; color: #0052cc; background: #deebff; border-radius: 999px; padding: 2px 8px; }
        .aa-tier2-locked { font-size: 12px; color: #97a0af; display: flex; align-items: center; gap: 4px; }
        .aa-tier2-note { font-size: 12px; color: #97a0af; display: flex; align-items: center; gap: 5px; margin-top: 8px; }

        .aa-history-list { display: flex; flex-direction: column; gap: 6px; }
        .aa-history-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #42526e; }
        .aa-history-note { color: #97a0af; }

        .aa-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; padding: 9px 16px; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
        .aa-btn-primary { background: #0052cc; color: #fff; }
        .aa-btn-secondary { background: #f4f5f7; color: #172b4d; border-color: #dfe1e6; }
        .aa-btn-ghost { background: transparent; color: #42526e; }
        .aa-btn-danger { background: #b45309; color: #fff; }
        .aa-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .aa-icon-btn { background: none; border: none; cursor: pointer; color: #5e6c84; display: flex; align-items: center; gap: 3px; font-family: inherit; font-size: 12px; }

        /* Inline selection + confirmation panel - part of the main
           workspace, not a modal. Cautionary (amber), not alarming (red),
           for the override case. */
        .aa-selection-panel { margin-top: 14px; display: flex; flex-direction: column; gap: 10px; background: #f0f7ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 16px; }
        .aa-selection-panel-override { background: #fffbeb; border-color: #fcd34d; }
        .aa-selection-head { display: flex; align-items: center; gap: 8px; color: #1d4ed8; font-weight: 800; font-size: 14.5px; }
        .aa-selection-panel-override .aa-selection-head { color: #92400e; }
        .aa-selection-clear { margin-inline-start: auto; }
        .aa-selection-path { display: flex; flex-direction: column; gap: 4px; font-weight: 700; font-size: 13.5px; }
        .aa-sel-line { display: flex; align-items: center; gap: 6px; }
        .aa-sel-line svg { color: #3b82f6; flex-shrink: 0; }
        .aa-selection-status { display: flex; }
        .aa-pill { border-radius: 999px; padding: 3px 12px; font-size: 12px; font-weight: 800; }
        .aa-pill-recommended { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
        .aa-pill-possible { background: #dbeafe; color: #1d4ed8; border: 1px solid #93c5fd; }
        .aa-pill-override_required { background: #fef3c7; color: #b45309; border: 1px solid #fcd34d; }

        .aa-selection-reasons { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
        .aa-selection-reasons li { display: flex; align-items: flex-start; gap: 6px; font-size: 12.5px; }
        .aa-selection-reasons-good li { color: #15803d; }
        .aa-selection-reasons-warn li { color: #974f0c; }
        .aa-selection-reasons-violation li { flex-direction: column; gap: 2px; color: #ae2e24; background: #fff0ee; border-radius: 8px; padding: 8px 10px; }
        .aa-selection-reasons-violation li > div:first-child { display: flex; align-items: center; gap: 6px; font-weight: 700; }
        .aa-violation-consequence { font-size: 12px; color: #7a271a; font-weight: 500; margin-inline-start: 18px; }

        .aa-override-box { display: flex; flex-direction: column; gap: 8px; }
        .aa-override-title { display: flex; align-items: center; gap: 6px; font-weight: 800; color: #92400e; font-size: 13px; }
        .aa-field-label { font-size: 12.5px; font-weight: 600; color: #5e6c84; margin-top: 2px; }
        .aa-override-box textarea, .aa-modal-body textarea { width: 100%; border: 1px solid #dfe1e6; border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 13px; resize: vertical; }

        .aa-confirm-btn { align-self: flex-start; margin-top: 4px; }

        .aa-modal-backdrop { position: fixed; inset: 0; background: rgba(9,30,66,0.5); display: flex; align-items: center; justify-content: center; z-index: 200; padding: 16px; }
        .aa-modal { background: #fff; border-radius: 14px; max-width: 460px; width: 100%; padding: 18px; direction: rtl; }
        .aa-modal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .aa-modal-head h3 { font-size: 16px; font-weight: 700; }
        .aa-modal-body { display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; }
        .aa-modal-error { background: #ffebe6; color: #bf2600; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; margin-top: 8px; }
        .aa-modal-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      `}</style>
    </div>
  );
}
