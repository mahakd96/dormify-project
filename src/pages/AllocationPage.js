import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { allocationAPI, inboxAPI } from '../services/api';
import {
  Play,
  Settings,
  Check,
  AlertTriangle,
  Users,
  Home,
  RefreshCw,
  Lock,
  Bell,
  Mail,
  Calendar,
  Loader,
  XCircle,
} from 'lucide-react';

function AllocationPage({ language }) {
  // ✅ AuthContext now provides canRunAllocation() + getUserRegion() normalized
  const { isCentralAdmin, getUserRegion, canRunAllocation } = useAuth();

  // ✅ Use a stable boolean for effects (avoids re-running effect on every render)
  const central = isCentralAdmin?.() === true;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [summary, setSummary] = useState(null);
  const [inboxItem, setInboxItem] = useState(null);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const [constraints, setConstraints] = useState({
    sameGender: { enabled: true, strict: true, critical: true, weight: 10 },
    sameReligion: { enabled: true, strict: false, critical: false, weight: 6 },
    roommateMatch: { enabled: true, strict: true, critical: false, weight: 8 },
    priorityFirst: { enabled: true, strict: true, critical: true, weight: 10 },
    roommatePositiveOnly: { enabled: true, strict: true, critical: true, weight: 10 },
    ReligiousTogether: { enabled: true, strict: true, critical: true, weight: 9 },
    sectorMatching: { enabled: true, strict: true, critical: false, weight: 7 },
    avoidYearMix_1_with_3_4: { enabled: true, strict: false, critical: false, weight: 4 },
    avoidAtudaimWithHasmaha: { enabled: true, strict: false, critical: false, weight: 4 },
  });

  const t = {
    he: {
      title: 'שיבוץ סטודנטים',
      subtitle: 'הפעלת אלגוריתם השיבוץ החכם',
      runAllocation: 'הפעל שיבוץ',
      running: 'מריץ שיבוץ...',
      constraints: 'אילוצי שיבוץ',
      strict: 'חובה',
      flexible: 'גמיש',
      critical: 'קריטי',
      weight: 'משקל',
      weightHint: 'כמה חשוב האילוץ באופטימיזציה (0–10)',
      studentsToAssign: 'סטודנטים לשיבוץ',
      availableBeds: 'מיטות פנויות',
      results: 'תוצאות השיבוץ',
      assigned: 'שובצו בהצלחה',
      roommateMatches: 'התאמות שותפים',
      conflicts: 'התנגשויות',
      viewResults: 'צפה בתוצאות',
      noStudents: 'אין סטודנטים לשיבוץ',
      loading: 'טוען נתונים...',
      error: 'שגיאה בטעינת הנתונים',
      retry: 'נסה שוב',
      notification: 'הודעה מלשכת המעונות המרכזית',
      receivedStudents: 'התקבלו סטודנטים לשיבוץ',
      batchId: 'מספר קובץ',
      receivedAt: 'התקבל בתאריך',
      studentsBreakdown: 'פירוט סטודנטים',
      newStudents: 'חדשים',
      continuing: 'ממשיכים',
      transfers: 'מעברים',
      leaving: 'עוזבים',
      priorityStudents: 'סטודנטים בעדיפות',
      sameGender: 'אותו מגדר בדירה',
      sameReligion: 'אותה דת בדירה',
      roommateMatch: 'התאמת שותפים מבוקשים',
      priorityFirst: 'סטודנטים בעדיפות קודם',
      roommatePositiveOnly: '100% תשובות חיוביות למבקשים להיות יחד',
      ReligiousTogether: '100% התאמות חיוביות דירת דתיים/ות',
      sectorMatching: 'התאמה לפי שייכות',
      avoidYearMix_1_with_3_4: 'לא לשבץ שנה א׳ עם שנה ג׳/ד׳',
      avoidAtudaimWithHasmaha: 'לא לשבץ הסמכה עם עתודאים',
      noRegion: 'לא נמצא אזור למשתמש.',
    },
    en: {
      title: 'Student Allocation',
      subtitle: 'Run the smart allocation algorithm',
      runAllocation: 'Run Allocation',
      running: 'Running allocation...',
      constraints: 'Allocation Constraints',
      strict: 'Strict',
      flexible: 'Flexible',
      critical: 'Critical',
      weight: 'Weight',
      weightHint: 'How important in optimization (0–10)',
      studentsToAssign: 'Students to assign',
      availableBeds: 'Available beds',
      results: 'Allocation Results',
      assigned: 'Successfully assigned',
      roommateMatches: 'Roommate matches',
      conflicts: 'Conflicts',
      viewResults: 'View Results',
      noStudents: 'No students to assign',
      loading: 'Loading data...',
      error: 'Error loading data',
      retry: 'Try again',
      notification: 'Notification from Central Housing Office',
      receivedStudents: 'Students received for allocation',
      batchId: 'Batch ID',
      receivedAt: 'Received on',
      studentsBreakdown: 'Students breakdown',
      newStudents: 'New',
      continuing: 'Continuing',
      transfers: 'Transfers',
      leaving: 'Leaving',
      priorityStudents: 'Priority students',
      sameGender: 'Same gender in apartment',
      sameReligion: 'Same religion in apartment',
      roommateMatch: 'Match roommate requests',
      priorityFirst: 'Priority students first',
      roommatePositiveOnly: '100% positive roommate matches',
      ReligiousTogether: '100% positive religious apartment matches',
      sectorMatching: 'Sector matching',
      avoidYearMix_1_with_3_4: 'Avoid mixing 1st year with 3rd/4th',
      avoidAtudaimWithHasmaha: 'Avoid mixing graduate with atudaim',
      noRegion: 'User region was not found.',
    },
  }[language];

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const summaryData = await allocationAPI.getSummary();
        if (!alive) return;
        setSummary(summaryData);

        // ✅ avoid calling isCentralAdmin() inside effect dependencies and avoid function-ref dependency
        if (!central) {
          try {
            const inboxData = await inboxAPI.getLatest();
            if (!alive) return;

            if (inboxData?.inbox) {
              setInboxItem(inboxData.inbox);

              if (inboxData.inbox.status === 'pending') {
                await inboxAPI.markViewed(inboxData.inbox.id);
              }
            }
          } catch (e) {
            // keep silent for UX, but you can uncomment for debugging:
            // console.warn('inboxAPI.getLatest failed', e);
          }
        }
      } catch (err) {
        if (!alive) return;
        setError(err?.message || 'Unknown error');
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    };

    load();

    return () => {
      alive = false;
    };
  }, [central]);

  const toggleConstraintEnabled = (key) => {
    setConstraints((prev) => {
      const current = prev[key];
      if (!current || current.critical) return prev;
      return { ...prev, [key]: { ...current, enabled: !current.enabled } };
    });
  };

  const setConstraintWeight = (key, nextWeight) => {
    const w = Math.max(0, Math.min(10, Number(nextWeight)));
    setConstraints((prev) => {
      const current = prev[key];
      if (!current) return prev;
      return { ...prev, [key]: { ...current, weight: w } };
    });
  };

  const effectiveConfig = useMemo(() => {
    const out = {};
    Object.entries(constraints).forEach(([k, v]) => {
      out[k] = {
        enabled: !!v.enabled,
        strict: !!v.strict,
        critical: !!v.critical,
        weight: Number(v.weight) || 0,
      };
    });
    return out;
  }, [constraints]);

  const runAllocation = async () => {
    setIsRunning(true);
    setProgress(0);
    setResult(null);
    setError(null);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + 5, 90));
    }, 200);

    try {
      // ✅ Guard region id (prevents crashes & confusing “Unknown error”)
      const regionId = getUserRegion?.();
      if (!regionId) {
        clearInterval(progressInterval);
        setProgress(0);
        setIsRunning(false);
        setError(t.noRegion);
        return;
      }

      let response;
      try {
        response = await allocationAPI.run(regionId, { constraints: effectiveConfig });
      } catch {
        response = await allocationAPI.run(regionId);
      }

      clearInterval(progressInterval);
      setProgress(100);

      setResult(response?.result || null);

      if (inboxItem) {
        await inboxAPI.markProcessed(inboxItem.id);
      }

      try {
        const summaryData = await allocationAPI.getSummary();
        setSummary(summaryData);
      } catch (e) {
        // ignore
      }
    } catch (err) {
      clearInterval(progressInterval);
      setError(err?.message || 'Unknown error');
    } finally {
      setIsRunning(false);
      clearInterval(progressInterval);
    }
  };

  if (loading) {
    return (
      <div className="allocation-page">
        <div className="loading-state">
          <Loader size={40} className="spin" />
          <p>{t.loading}</p>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="allocation-page">
        <div className="error-state">
          <XCircle size={40} />
          <p>{t.error}</p>
          <p className="error-message">{error}</p>
          <button onClick={() => window.location.reload()}>{t.retry}</button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  // ✅ Now canRunAllocation exists in AuthContext (alias), so this won't crash
  const canRun = typeof canRunAllocation === 'function' ? canRunAllocation() : false;
  const hasStudents = (summary?.unassigned_students || 0) > 0;

  return (
    <div className="allocation-page">
      <div className="shell">
        <div className="topbar">
          <div className="titleBlock">
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>

          <div className="topbarRight">
            {summary?.region && (
              <span className="region-badge">
                {language === 'he' ? summary.region.name : summary.region.name_en}
              </span>
            )}

            {hasStudents ? (
              <button className="run-btn" onClick={runAllocation} disabled={isRunning || !canRun}>
                {isRunning ? (
                  <>
                    <RefreshCw size={18} className="spin" />
                    {t.running}
                  </>
                ) : (
                  <>
                    <Play size={18} />
                    {t.runAllocation}
                  </>
                )}
              </button>
            ) : (
              <span className="status-chip ok">
                <Check size={16} />
                {t.noStudents}
              </span>
            )}
          </div>
        </div>

        {isRunning && (
          <div className="progressWrap">
            <div className="progressBar">
              <div className="progressFill" style={{ width: `${progress}%` }} />
            </div>
            <span className="progressPct">{progress}%</span>
          </div>
        )}

        {inboxItem && (
          <div className="banner">
            <div className="bannerLeft">
              <div className="bannerIcon">
                <Bell size={20} />
              </div>
              <div className="bannerText">
                <div className="bannerTitle">
                  <span className="bannerHeading">{t.notification}</span>
                  <span className="chip">
                    {t.batchId}: #{inboxItem.batch}
                  </span>
                </div>
                <div className="bannerMain">
                  <Mail size={16} />
                  <span>
                    <strong>{inboxItem.students_count}</strong> {t.receivedStudents}
                  </span>
                </div>
                <div className="bannerMeta">
                  <Calendar size={14} />
                  <span>
                    {t.receivedAt}: {new Date(inboxItem.created_at).toLocaleDateString('he-IL')}
                  </span>
                </div>
              </div>
            </div>

            <div className="bannerRight">
              <span className={`status-chip ${inboxItem.status === 'pending' ? 'warn' : 'neutral'}`}>
                {inboxItem.status === 'pending' ? (
                  <>
                    <AlertTriangle size={16} /> {language === 'he' ? 'ממתין לטיפול' : 'Pending'}
                  </>
                ) : (
                  <>
                    <Check size={16} /> {language === 'he' ? 'נצפה' : 'Viewed'}
                  </>
                )}
              </span>
            </div>
          </div>
        )}

        <div className="grid">
          <div className="leftCol">
            <div className="card">
              <div className="cardHeader">
                <div className="cardTitle">
                  <Settings size={16} />
                  <span>{t.constraints}</span>
                </div>
                <span className="hint">{t.weightHint}</span>
              </div>

              <div className="constraintsTable">
                {Object.entries(constraints).map(([key, value]) => (
                  <div
                    key={key}
                    className={`row ${value.critical ? 'critical' : ''} ${!value.enabled ? 'disabled' : ''}`}
                  >
                    <div className="rowMain">
                      <label className={`toggle ${value.critical ? 'locked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={value.enabled}
                          disabled={value.critical}
                          onChange={() => toggleConstraintEnabled(key)}
                        />
                        <span className="labelText">
                          {t[key] || key}
                          {value.critical && (
                            <span className="miniChip">
                              <Lock size={12} /> {t.critical}
                            </span>
                          )}
                        </span>
                      </label>

                      <div className="weight">
                        <span className="wLabel">{t.weight}</span>
                        <input
                          type="range"
                          min="0"
                          max="10"
                          step="1"
                          value={value.weight}
                          disabled={!value.enabled}
                          onChange={(e) => setConstraintWeight(key, e.target.value)}
                        />
                        <span className="wValue">{value.weight}</span>
                      </div>
                    </div>

                    <span className={`pill ${value.strict ? 'strict' : 'flex'}`}>
                      {value.strict ? t.strict : t.flexible}
                    </span>
                  </div>
                ))}
              </div>

              {!canRun && (
                <div className="lockNote">
                  <Lock size={16} />
                  <span>
                    {language === 'he'
                      ? 'אין הרשאה להריץ שיבוץ בחשבון זה.'
                      : 'You do not have permission to run allocation on this account.'}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="rightCol">
            <div className="statsRow">
              <div className="stat">
                <div className="statIcon">
                  <Users size={18} />
                </div>
                <div>
                  <div className="statNum">{summary?.unassigned_students || 0}</div>
                  <div className="statLbl">{t.studentsToAssign}</div>
                </div>
              </div>
              <div className="stat">
                <div className="statIcon">
                  <Home size={18} />
                </div>
                <div>
                  <div className="statNum">{summary?.available_beds || 0}</div>
                  <div className="statLbl">{t.availableBeds}</div>
                </div>
              </div>
            </div>

            {summary?.students_by_category && (
              <div className="card">
                <div className="cardHeader compact">
                  <div className="cardTitle">
                    <Users size={16} />
                    <span>{t.studentsBreakdown}</span>
                  </div>
                </div>

                <div className="breakdown">
                  <div className="bItem">
                    <div className="bNum">{summary.students_by_category.new || 0}</div>
                    <div className="bLbl">{t.newStudents}</div>
                  </div>
                  <div className="bItem">
                    <div className="bNum">{summary.students_by_category.continuing || 0}</div>
                    <div className="bLbl">{t.continuing}</div>
                  </div>
                  <div className="bItem">
                    <div className="bNum">{summary.students_by_category.transfer || 0}</div>
                    <div className="bLbl">{t.transfers}</div>
                  </div>
                  <div className="bItem priority">
                    <div className="bNum">{summary.priority_students || 0}</div>
                    <div className="bLbl">{t.priorityStudents}</div>
                  </div>
                </div>
              </div>
            )}

            {result && (
              <div className="card">
                <div className="cardHeader compact">
                  <div className="cardTitle">
                    <Check size={16} />
                    <span>{t.results}</span>
                  </div>
                </div>

                <div className="results">
                  <div className="kpi ok">
                    <div className="kpiIcon">
                      <Check size={18} />
                    </div>
                    <div>
                      <div className="kpiNum">{result.successful_assignments}</div>
                      <div className="kpiLbl">{t.assigned}</div>
                    </div>
                  </div>

                  <div className="kpi info">
                    <div className="kpiIcon">
                      <Users size={18} />
                    </div>
                    <div>
                      <div className="kpiNum">{result.roommate_matches}</div>
                      <div className="kpiLbl">{t.roommateMatches}</div>
                    </div>
                  </div>

                  <div className="kpi warn">
                    <div className="kpiIcon">
                      <AlertTriangle size={18} />
                    </div>
                    <div>
                      <div className="kpiNum">{result.conflicts}</div>
                      <div className="kpiLbl">{t.conflicts}</div>
                    </div>
                  </div>
                </div>

                <button className="ghostBtn">{t.viewResults}</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  :root{
    --bg: #f6f8fc;
    --card: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --border: rgba(15,23,42,0.10);
    --shadow: 0 10px 30px rgba(15,23,42,0.08);
    --shadow2: 0 6px 18px rgba(15,23,42,0.08);
    --primary: #2563eb;
    --primarySoft: rgba(37,99,235,0.10);
    --ok: #047857;
    --okSoft: rgba(4,120,87,0.12);
    --warn: #b45309;
    --warnSoft: rgba(180,83,9,0.14);
    --danger: #b91c1c;
    --dangerSoft: rgba(185,28,28,0.12);
    --radius: 18px;
    --radius2: 14px;
  }

  .allocation-page{
    padding: 18px;
    background: var(--bg);
    min-height: calc(100vh - 40px);
  }

  .shell{
    max-width: 1080px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .topbar{
    position: sticky;
    top: 0;
    z-index: 5;
    background: linear-gradient(to bottom, rgba(246,248,252,1), rgba(246,248,252,0.88));
    backdrop-filter: blur(8px);
    border-radius: var(--radius);
    padding: 14px 14px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
  }

  .titleBlock h1{
    margin: 0;
    font-size: 22px;
    font-weight: 900;
    letter-spacing: -0.02em;
    color: var(--text);
  }

  .titleBlock p{
    margin: 6px 0 0;
    color: var(--muted);
    font-weight: 700;
    font-size: 13px;
  }

  .topbarRight{
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .region-badge{
    background: var(--primarySoft);
    border: 1px solid rgba(37,99,235,0.25);
    color: #1d4ed8;
    padding: 8px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 900;
    white-space: nowrap;
  }

  .run-btn{
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(4,120,87,0.25);
    background: linear-gradient(135deg, #059669, #047857);
    color: white;
    font-weight: 950;
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 10px 20px rgba(4,120,87,0.25);
    transition: transform 0.18s, filter 0.18s;
    font-family: inherit;
    white-space: nowrap;
  }

  .run-btn:hover{ transform: translateY(-1px); filter: brightness(0.98); }
  .run-btn:disabled{
    opacity: 0.65;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .status-chip{
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 900;
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.03);
    color: var(--text);
    white-space: nowrap;
  }
  .status-chip.ok{
    background: var(--okSoft);
    border-color: rgba(4,120,87,0.25);
    color: var(--ok);
  }
  .status-chip.warn{
    background: var(--warnSoft);
    border-color: rgba(180,83,9,0.25);
    color: var(--warn);
  }
  .status-chip.neutral{
    background: rgba(15,23,42,0.03);
    border-color: var(--border);
    color: var(--text);
  }

  .progressWrap{
    display:flex;
    align-items:center;
    gap: 10px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius2);
    padding: 10px 12px;
    box-shadow: var(--shadow2);
  }
  .progressBar{
    height: 10px;
    border-radius: 999px;
    background: rgba(15,23,42,0.08);
    overflow:hidden;
    flex: 1;
  }
  .progressFill{
    height: 100%;
    background: linear-gradient(90deg, rgba(37,99,235,0.75), rgba(5,150,105,0.75));
    transition: width 0.25s ease;
    border-radius: 999px;
  }
  .progressPct{
    width: 52px;
    text-align:right;
    font-size: 13px;
    font-weight: 950;
    color: var(--muted);
  }

  .banner{
    display:flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: linear-gradient(135deg, rgba(37,99,235,0.10), rgba(99,102,241,0.10));
    border: 1px solid rgba(37,99,235,0.18);
    border-radius: var(--radius);
    padding: 14px;
  }
  .bannerLeft{
    display:flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }
  .bannerIcon{
    width: 40px;
    height: 40px;
    border-radius: 14px;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(255,255,255,0.85);
    border: 1px solid rgba(255,255,255,0.6);
    color: #1d4ed8;
    flex-shrink: 0;
  }
  .bannerText{ min-width: 0; }
  .bannerTitle{
    display:flex;
    align-items:center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .bannerHeading{
    font-weight: 950;
    color: #1e3a8a;
    font-size: 13px;
  }
  .chip{
    font-size: 12px;
    font-weight: 950;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(255,255,255,0.85);
    border: 1px solid rgba(15,23,42,0.10);
    color: var(--text);
  }
  .bannerMain{
    display:flex;
    align-items:center;
    gap: 8px;
    margin-top: 8px;
    font-weight: 800;
    color: var(--text);
  }
  .bannerMeta{
    display:flex;
    align-items:center;
    gap: 8px;
    margin-top: 6px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .grid{
    display:grid;
    grid-template-columns: 1.25fr 0.9fr;
    gap: 14px;
    align-items:start;
  }

  .card{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 14px;
  }

  .cardHeader{
    display:flex;
    align-items:flex-start;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 10px;
    margin-bottom: 10px;
    border-bottom: 1px solid var(--border);
  }
  .cardHeader.compact{
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .cardTitle{
    display:flex;
    align-items:center;
    gap: 10px;
    font-weight: 950;
    color: var(--text);
  }
  .hint{
    font-size: 12px;
    color: var(--muted);
    font-weight: 800;
    text-align: right;
  }

  .constraintsTable{
    display:flex;
    flex-direction:column;
    gap: 10px;
  }

  .row{
    display:flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius2);
    background: rgba(15,23,42,0.02);
    border: 1px solid rgba(15,23,42,0.06);
  }
  .row.critical{
    background: rgba(185,28,28,0.06);
    border-color: rgba(185,28,28,0.14);
  }
  .row.disabled{
    opacity: 0.75;
  }

  .rowMain{
    display:flex;
    flex-direction:column;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .toggle{
    display:flex;
    align-items:center;
    gap: 10px;
    cursor: pointer;
    min-width: 0;
  }
  .toggle.locked{
    cursor: not-allowed;
  }
  .toggle input{
    width: 18px;
    height: 18px;
  }
  .labelText{
    display:inline-flex;
    align-items:center;
    gap: 10px;
    font-weight: 900;
    color: var(--text);
    min-width: 0;
    flex-wrap: wrap;
  }
  .miniChip{
    display:inline-flex;
    align-items:center;
    gap: 6px;
    font-size: 12px;
    font-weight: 950;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--dangerSoft);
    border: 1px solid rgba(185,28,28,0.18);
    color: var(--danger);
    white-space: nowrap;
  }

  .weight{
    display:grid;
    grid-template-columns: 64px 1fr 40px;
    align-items:center;
    gap: 10px;
  }
  .wLabel{
    font-size: 12px;
    font-weight: 900;
    color: var(--muted);
  }
  .weight input[type="range"]{
    width: 100%;
    accent-color: var(--primary);
  }
  .wValue{
    font-size: 12px;
    font-weight: 950;
    color: var(--text);
    padding: 6px 8px;
    border-radius: 12px;
    background: #fff;
    border: 1px solid var(--border);
    text-align:center;
  }

  .pill{
    height: fit-content;
    align-self: center;
    padding: 8px 10px;
    border-radius: 999px;
    font-weight: 950;
    font-size: 12px;
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.03);
    white-space: nowrap;
  }
  .pill.strict{
    background: var(--dangerSoft);
    border-color: rgba(185,28,28,0.18);
    color: var(--danger);
  }
  .pill.flex{
    background: var(--primarySoft);
    border-color: rgba(37,99,235,0.18);
    color: #1d4ed8;
  }

  .lockNote{
    margin-top: 12px;
    display:flex;
    align-items:center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius2);
    background: rgba(15,23,42,0.03);
    border: 1px solid var(--border);
    color: var(--muted);
    font-weight: 850;
    font-size: 13px;
  }

  .statsRow{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .stat{
    display:flex;
    align-items:center;
    gap: 12px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow2);
    padding: 14px;
  }

  .statIcon{
    width: 38px;
    height: 38px;
    border-radius: 14px;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(37,99,235,0.10);
    border: 1px solid rgba(37,99,235,0.16);
    color: #1d4ed8;
  }

  .statNum{
    font-size: 22px;
    font-weight: 950;
    color: var(--text);
    letter-spacing: -0.02em;
  }
  .statLbl{
    font-size: 12px;
    font-weight: 900;
    color: var(--muted);
    margin-top: 2px;
  }

  .breakdown{
    display:grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
  }
  .bItem{
    border-radius: var(--radius2);
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    padding: 12px;
    text-align:center;
  }
  .bItem.priority{
    background: var(--warnSoft);
    border-color: rgba(180,83,9,0.20);
  }
  .bNum{
    font-size: 20px;
    font-weight: 950;
    color: var(--text);
    letter-spacing: -0.02em;
  }
  .bItem.priority .bNum{
    color: var(--warn);
  }
  .bLbl{
    margin-top: 4px;
    font-size: 12px;
    font-weight: 900;
    color: var(--muted);
  }

  .results{
    display:grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .kpi{
    display:flex;
    align-items:center;
    gap: 12px;
    border-radius: var(--radius2);
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    padding: 12px;
  }
  .kpi.ok{
    background: var(--okSoft);
    border-color: rgba(4,120,87,0.20);
  }
  .kpi.info{
    background: var(--primarySoft);
    border-color: rgba(37,99,235,0.18);
  }
  .kpi.warn{
    background: var(--warnSoft);
    border-color: rgba(180,83,9,0.20);
  }
  .kpiIcon{
    width: 36px;
    height: 36px;
    border-radius: 14px;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(255,255,255,0.75);
    border: 1px solid rgba(255,255,255,0.6);
  }
  .kpi.ok .kpiIcon{ color: var(--ok); }
  .kpi.info .kpiIcon{ color: #1d4ed8; }
  .kpi.warn .kpiIcon{ color: var(--warn); }
  .kpiNum{
    font-size: 18px;
    font-weight: 950;
    color: var(--text);
    letter-spacing: -0.02em;
  }
  .kpiLbl{
    font-size: 12px;
    font-weight: 900;
    color: rgba(15,23,42,0.70);
    margin-top: 2px;
  }

  .ghostBtn{
    margin-top: 12px;
    width: 100%;
    padding: 12px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    color: var(--text);
    font-weight: 950;
    cursor: pointer;
    font-family: inherit;
  }
  .ghostBtn:hover{
    background: rgba(37,99,235,0.06);
    border-color: rgba(37,99,235,0.18);
    color: #1d4ed8;
  }

  .loading-state, .error-state{
    display:flex;
    flex-direction:column;
    align-items:center;
    justify-content:center;
    height: 400px;
    gap: 14px;
    border-radius: var(--radius);
    background: var(--card);
    border: 1px solid var(--border);
    box-shadow: var(--shadow2);
    max-width: 720px;
    margin: 0 auto;
  }

  .loading-state p{
    margin: 0;
    color: var(--muted);
    font-weight: 900;
  }

  .error-state{
    color: var(--danger);
  }
  .error-message{
    font-size: 13px;
    color: var(--muted);
    max-width: 520px;
    text-align:center;
    margin: -6px 0 0;
    font-weight: 800;
  }
  .error-state button{
    padding: 10px 14px;
    border-radius: 14px;
    border: 1px solid rgba(37,99,235,0.18);
    background: var(--primarySoft);
    color: #1d4ed8;
    font-weight: 950;
    cursor:pointer;
    font-family: inherit;
  }
  .error-state button:hover{
    background: rgba(37,99,235,0.14);
  }

  .spin{ animation: spin 1s linear infinite; }
  @keyframes spin{ from{ transform: rotate(0deg);} to{ transform: rotate(360deg);} }

  @media (max-width: 980px){
    .topbar{
      flex-direction: column;
      align-items: flex-start;
    }
    .topbarRight{
      justify-content:flex-start;
    }
    .grid{
      grid-template-columns: 1fr;
    }
    .breakdown{
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`;

export default AllocationPage;
