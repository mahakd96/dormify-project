import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { allocationAPI, inboxAPI } from '../services/api';
import {
  Play, Settings, Check, AlertTriangle, Users, Home, RefreshCw,
  Lock, Bell, Mail, Calendar, Loader, XCircle
} from 'lucide-react';

function AllocationPage({ language }) {
  const { isCentralAdmin, getUserRegion, canRunAllocation, user } = useAuth();

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [inboxItem, setInboxItem] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  const [constraints, setConstraints] = useState({
    sameGender: { enabled: true, strict: true, critical: true },
    sameReligion: { enabled: true, strict: false, critical: false },
    roommateMatch: { enabled: true, strict: true, critical: false },
    priorityFirst: { enabled: true, strict: true, critical: true },
    roommatePositiveOnly: { enabled: true, strict: true, critical: true },
    ReligiousTogether: { enabled: true, strict: true, critical: true },
    sectorMatching: { enabled: true, strict: true, critical: false },
    avoidYearMix_1_with_3_4: { enabled: true, strict: false, critical: false },
    avoidAtudaimWithHasmaha: { enabled: true, strict: false, critical: false },
  });

  const t = {
    he: {
      title: 'שיבוץ סטודנטים',
      subtitle: 'הפעלת אלגוריתם השיבוץ החכם',
      runAllocation: 'הפעל שיבוץ',
      running: 'מריץ שיבוץ...',
      constraints: 'אילוצי שיבוץ',
      sameGender: 'אותו מגדר בדירה',
      sameReligion: 'אותה דת בדירה',
      roommateMatch: 'התאמת שותפים מבוקשים',
      priorityFirst: 'סטודנטים בעדיפות קודם',
      roommatePositiveOnly: '100% תשובות חיוביות למבקשים להיות יחד',
      ReligiousTogether: '100% התאמות חיוביות דירת דתיים/ות',
      sectorMatching: 'התאמה לפי שייכות',
      avoidYearMix_1_with_3_4: 'לא לשבץ שנה א׳ עם שנה ג׳/ד׳',
      avoidAtudaimWithHasmaha: 'לא לשבץ הסמכה עם עתודאים',
      strict: 'חובה',
      flexible: 'גמיש',
      critical: 'קריטי',
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
    },
    en: {
      title: 'Student Allocation',
      subtitle: 'Run the smart allocation algorithm',
      runAllocation: 'Run Allocation',
      running: 'Running allocation...',
      constraints: 'Allocation Constraints',
      sameGender: 'Same gender in apartment',
      sameReligion: 'Same religion in apartment',
      roommateMatch: 'Match roommate requests',
      priorityFirst: 'Priority students first',
      roommatePositiveOnly: '100% positive roommate matches',
      ReligiousTogether: '100% positive religious apartment matches',
      sectorMatching: 'Sector matching',
      avoidYearMix_1_with_3_4: 'Avoid mixing 1st year with 3rd/4th',
      avoidAtudaimWithHasmaha: 'Avoid mixing graduate with atudaim',
      strict: 'Strict',
      flexible: 'Flexible',
      critical: 'Critical',
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
    }
  }[language];

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Get allocation summary
      const summaryData = await allocationAPI.getSummary();
      setSummary(summaryData);

      // Get latest inbox item for region managers
      if (!isCentralAdmin()) {
        try {
          const inboxData = await inboxAPI.getLatest();
          if (inboxData.inbox) {
            setInboxItem(inboxData.inbox);
            // Mark as viewed if pending
            if (inboxData.inbox.status === 'pending') {
              await inboxAPI.markViewed(inboxData.inbox.id);
            }
          }
        } catch (err) {
          // No inbox item - that's okay
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleConstraintEnabled = (key) => {
    const current = constraints[key];
    if (current.critical) return;

    setConstraints({
      ...constraints,
      [key]: { ...current, enabled: !current.enabled }
    });
  };

  const runAllocation = async () => {
    setIsRunning(true);
    setProgress(0);
    setResult(null);

    // Simulate progress
    const progressInterval = setInterval(() => {
      setProgress(prev => Math.min(prev + 5, 90));
    }, 200);

    try {
      const response = await allocationAPI.run(getUserRegion());

      clearInterval(progressInterval);
      setProgress(100);

      setResult(response.result);

      // Mark inbox as processed
      if (inboxItem) {
        await inboxAPI.markProcessed(inboxItem.id);
      }

      // Reload data
      await loadData();

    } catch (err) {
      clearInterval(progressInterval);
      setError(err.message);
    } finally {
      setIsRunning(false);
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
          <button onClick={loadData}>נסה שוב</button>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="allocation-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        {summary?.region && (
          <span className="region-badge">
            {language === 'he' ? summary.region.name : summary.region.name_en}
          </span>
        )}
      </div>

      {/* Inbox Notification */}
      {inboxItem && (
        <div className="inbox-notification">
          <div className="notification-header">
            <div className="notification-icon">
              <Bell size={24} />
            </div>
            <div className="notification-title">
              <h3>{t.notification}</h3>
              <span className="batch-tag">
                {t.batchId}: #{inboxItem.batch}
              </span>
            </div>
          </div>

          <div className="notification-content">
            <div className="main-message">
              <Mail size={20} />
              <span>
                <strong>{inboxItem.students_count}</strong> {t.receivedStudents}
              </span>
            </div>

            <div className="notification-meta">
              <div className="meta-item">
                <Calendar size={16} />
                <span>{t.receivedAt}: {new Date(inboxItem.created_at).toLocaleDateString('he-IL')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="allocation-grid">
        {/* Stats Row */}
        <div className="stats-row">
          <div className="stat-card">
            <Users size={24} />
            <div>
              <span className="number">{summary?.unassigned_students || 0}</span>
              <span className="label">{t.studentsToAssign}</span>
            </div>
          </div>
          <div className="stat-card">
            <Home size={24} />
            <div>
              <span className="number">{summary?.available_beds || 0}</span>
              <span className="label">{t.availableBeds}</span>
            </div>
          </div>
        </div>

        {/* Students Breakdown */}
        {summary?.students_by_category && (
          <div className="breakdown-card">
            <h3>{t.studentsBreakdown}</h3>
            <div className="breakdown-grid">
              <div className="breakdown-item">
                <span className="count">{summary.students_by_category.new || 0}</span>
                <span className="label">{t.newStudents}</span>
              </div>
              <div className="breakdown-item">
                <span className="count">{summary.students_by_category.continuing || 0}</span>
                <span className="label">{t.continuing}</span>
              </div>
              <div className="breakdown-item">
                <span className="count">{summary.students_by_category.transfer || 0}</span>
                <span className="label">{t.transfers}</span>
              </div>
              <div className="breakdown-item priority">
                <span className="count">{summary.priority_students || 0}</span>
                <span className="label">{t.priorityStudents}</span>
              </div>
            </div>
          </div>
        )}

        {/* Constraints */}
        <div className="constraints-card">
          <h3><Settings size={18} /> {t.constraints}</h3>

          <div className="constraints-list">
            {Object.entries(constraints).map(([key, value]) => (
              <div key={key} className={`constraint-item ${value.critical ? 'critical' : ''}`}>
                <label className={`constraint-toggle ${value.critical ? 'locked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={value.enabled}
                    disabled={value.critical}
                    onChange={() => toggleConstraintEnabled(key)}
                  />
                  <span className="constraint-text">
                    {t[key]}
                    {value.critical && (
                      <span className="critical-chip">
                        <Lock size={12} /> {t.critical}
                      </span>
                    )}
                  </span>
                </label>

                <span className={`constraint-type ${value.strict ? 'strict' : 'flexible'}`}>
                  {value.strict ? t.strict : t.flexible}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Run Section */}
        <div className="run-section">
          {(summary?.unassigned_students || 0) > 0 ? (
            <>
              <button
                className="run-btn"
                onClick={runAllocation}
                disabled={isRunning || !canRunAllocation()}
              >
                {isRunning ? (
                  <>
                    <RefreshCw size={20} className="spin" />
                    {t.running}
                  </>
                ) : (
                  <>
                    <Play size={20} />
                    {t.runAllocation}
                  </>
                )}
              </button>

              {isRunning && (
                <div className="progress-section">
                  <div className="progress-bar">
                    <div className="progress-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <span>{progress}%</span>
                </div>
              )}
            </>
          ) : (
            <div className="no-students">
              <Check size={32} />
              <p>{t.noStudents}</p>
            </div>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="results-card">
            <h3>{t.results}</h3>
            <div className="results-grid">
              <div className="result-item success">
                <Check size={20} />
                <span className="number">{result.successful_assignments}</span>
                <span className="label">{t.assigned}</span>
              </div>
              <div className="result-item info">
                <Users size={20} />
                <span className="number">{result.roommate_matches}</span>
                <span className="label">{t.roommateMatches}</span>
              </div>
              <div className="result-item warning">
                <AlertTriangle size={20} />
                <span className="number">{result.conflicts}</span>
                <span className="label">{t.conflicts}</span>
              </div>
            </div>
            <button className="view-btn">{t.viewResults}</button>
          </div>
        )}
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .allocation-page { padding: 24px; }
  .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .page-header p { color: #64748b; }
  .region-badge { background: linear-gradient(135deg, #3d9fe0, #2563eb); color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px; }

  .loading-state, .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 400px;
    color: #64748b;
    gap: 16px;
  }
  .error-state { color: #dc2626; }
  .error-message { font-size: 14px; color: #94a3b8; }
  .error-state button { 
    padding: 8px 16px; 
    background: #3d9fe0; 
    color: white; 
    border: none; 
    border-radius: 8px; 
    cursor: pointer; 
  }

  /* Inbox Notification */
  .inbox-notification {
    background: linear-gradient(135deg, #dbeafe, #ede9fe);
    border: 1px solid #93c5fd;
    border-radius: 16px;
    padding: 20px;
    margin-bottom: 24px;
  }

  .notification-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 16px;
  }

  .notification-icon {
    width: 48px;
    height: 48px;
    background: white;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #2563eb;
  }

  .notification-title h3 {
    font-size: 16px;
    font-weight: 600;
    color: #1e3a8a;
    margin-bottom: 4px;
  }

  .batch-tag {
    font-size: 12px;
    background: #2563eb;
    color: white;
    padding: 2px 8px;
    border-radius: 8px;
  }

  .notification-content {
    background: white;
    border-radius: 12px;
    padding: 16px;
  }

  .main-message {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 18px;
    color: #1e293b;
    padding-bottom: 12px;
    border-bottom: 1px solid #e5e7eb;
  }

  .main-message svg { color: #2563eb; }

  .notification-meta {
    display: flex;
    gap: 24px;
    margin-top: 12px;
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #64748b;
  }

  /* Main Grid */
  .allocation-grid { max-width: 700px; margin: 0 auto; }

  .stats-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }

  .stat-card {
    display: flex;
    align-items: center;
    gap: 16px;
    background: white;
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }

  .stat-card svg { color: #3d9fe0; }
  .stat-card .number { display: block; font-size: 28px; font-weight: 700; color: #1e293b; }
  .stat-card .label { font-size: 14px; color: #64748b; }

  /* Breakdown Card */
  .breakdown-card {
    background: white;
    padding: 20px;
    border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    margin-bottom: 24px;
  }

  .breakdown-card h3 {
    font-size: 14px;
    color: #64748b;
    margin-bottom: 16px;
  }

  .breakdown-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }

  .breakdown-item {
    text-align: center;
    padding: 12px;
    background: #f8fafc;
    border-radius: 10px;
  }

  .breakdown-item .count {
    display: block;
    font-size: 24px;
    font-weight: 700;
    color: #1e293b;
  }

  .breakdown-item .label {
    font-size: 12px;
    color: #64748b;
  }

  .breakdown-item.priority {
    background: #fef3c7;
  }

  .breakdown-item.priority .count {
    color: #d97706;
  }

  /* Constraints */
  .constraints-card {
    background: white;
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    margin-bottom: 24px;
  }

  .constraints-card h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    margin-bottom: 20px;
    color: #64748b;
  }

  .constraints-list { display: flex; flex-direction: column; gap: 12px; }

  .constraint-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: #f8fafc;
    border-radius: 10px;
  }

  .constraint-item.critical {
    border: 1px solid #fecaca;
    background: #fff1f2;
  }

  .constraint-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .constraint-toggle.locked { cursor: not-allowed; opacity: 0.95; }
  .constraint-toggle input { width: 18px; height: 18px; }

  .constraint-text { display: inline-flex; align-items: center; gap: 10px; }

  .critical-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 999px;
    background: #fee2e2;
    color: #b91c1c;
    font-weight: 600;
  }

  .constraint-type {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 12px;
    font-weight: 600;
    white-space: nowrap;
  }

  .constraint-type.strict { background: #fee2e2; color: #dc2626; }
  .constraint-type.flexible { background: #dbeafe; color: #2563eb; }

  /* Run Section */
  .run-section { margin-bottom: 24px; }

  .run-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 16px;
    background: linear-gradient(135deg, #059669, #047857);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 18px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s;
  }

  .run-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(5, 150, 105, 0.4); }
  .run-btn:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }

  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .progress-section { margin-top: 16px; }
  .progress-bar { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #3d9fe0, #2563eb); transition: width 0.3s; }
  .progress-section span { display: block; text-align: center; margin-top: 8px; font-size: 14px; color: #64748b; }

  .no-students {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 40px;
    background: #d1fae5;
    border-radius: 16px;
    color: #059669;
  }

  /* Results */
  .results-card {
    background: white;
    padding: 24px;
    border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }

  .results-card h3 { font-size: 16px; margin-bottom: 20px; }
  .results-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; }

  .result-item { text-align: center; padding: 16px; border-radius: 12px; }
  .result-item.success { background: #d1fae5; color: #059669; }
  .result-item.info { background: #dbeafe; color: #2563eb; }
  .result-item.warning { background: #fef3c7; color: #d97706; }

  .result-item .number { display: block; font-size: 24px; font-weight: 700; margin: 8px 0 4px; }
  .result-item .label { font-size: 12px; }

  .view-btn {
    width: 100%;
    padding: 12px;
    background: #f1f5f9;
    border: none;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
  }

  .view-btn:hover { background: #e2e8f0; }
`;

export default AllocationPage;