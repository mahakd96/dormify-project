import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { regions, students, apartments, rooms } from '../data/mockData';
import { Play, Settings, Check, AlertTriangle, Users, Home, RefreshCw, Lock } from 'lucide-react';

function AllocationPage({ language }) {
  const { isCentralAdmin, getUserRegion, canRunAllocation } = useAuth();
  const userRegion = getUserRegion();

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  /**
   * IMPORTANT:
   * - critical: must always be enabled (can't be toggled off)
   * - strict: must vs flexible indicator
   */
  const [constraints, setConstraints] = useState({
    // Existing constraints
    sameGender: { enabled: true, strict: true, critical: true },
    sameReligion: { enabled: true, strict: false, critical: false },
    roommateMatch: { enabled: true, strict: true, critical: false },
    priorityFirst: { enabled: true, strict: true, critical: true },

    // Added criteria
    roommatePositiveOnly: { enabled: true, strict: true, critical: true },        // 5.1.1
    ReligiousTogether: { enabled: true, strict: true, critical: true },           // 5.1.2
    sectorMatching: { enabled: true, strict: true, critical: false },              // 5.1.3
    avoidYearMix_1_with_3_4: { enabled: true, strict: false, critical: false },   // 5.1.4
    avoidAtudaimWithHasmaha: { enabled: true, strict: false, critical: false },   // 5.1.5
  });

  const regionStudents = isCentralAdmin()
    ? students
    : students.filter(s => s.regionId === userRegion);

  const unassignedStudents = regionStudents.filter(s => !s.isAssigned);

  const regionApartments = isCentralAdmin()
    ? apartments
    : apartments.filter(a => a.regionId === userRegion);

  const availableRooms = rooms.filter(r => {
    if (!isCentralAdmin() && r.regionId !== userRegion) return false;
    return r.currentOccupancy < r.capacity;
  });

  const t = {
    he: {
      title: 'שיבוץ סטודנטים',
      subtitle: 'הפעלת אלגוריתם השיבוץ החכם',
      runAllocation: 'הפעל שיבוץ',
      running: 'מריץ שיבוץ...',
      constraints: 'אילוצי שיבוץ',

      sameGender: 'אותו מגדר בדירה',
      sameReligion: '(יהודים/מוסלמים/דרוזים/נוצרים/מעורב) אותה דת בדירה',
      roommateMatch: 'התאמת שותפים מבוקשים',
      priorityFirst: 'סטודנטים בעדיפות קודם',

      roommatePositiveOnly: '100% תשובות חיוביות למבקשים להיות יחד ע"ב מקום פנוי',
      ReligiousTogether: '100% התאמות חיוביות דירת דתיים/ות (מקום פנוי)',
      sectorMatching: 'התאמה לפי שייכות (יהודים/ערבים)',
      avoidYearMix_1_with_3_4: 'לא לשבץ דיירי שנה א׳ עם שנה ג׳/ד׳',
      avoidAtudaimWithHasmaha: 'רצוי לא לשבץ סטודנטים מהסמכה עם עתודאים',

      strict: 'חובה',
      flexible: 'גמיש',
      critical: 'קריטי',
      studentsToAssign: 'סטודנטים לשיבוץ',
      availableRooms: 'חדרים פנויים',
      results: 'תוצאות השיבוץ',
      assigned: 'שובצו בהצלחה',
      roommateMatches: 'התאמות שותפים',
      conflicts: 'התנגשויות',
      viewResults: 'צפה בתוצאות',
      noStudents: 'אין סטודנטים לשיבוץ',
    },
    en: {
      title: 'Student Allocation',
      subtitle: 'Run the smart allocation algorithm',
      runAllocation: 'Run Allocation',
      running: 'Running allocation...',
      constraints: 'Allocation Constraints',

      sameGender: 'Same gender in apartment',
      sameReligion: 'Same religion/community in apartment',
      roommateMatch: 'Match roommate requests',
      priorityFirst: 'Priority students first',

      roommatePositiveOnly: '100% positive roommate matches (if capacity exists)',
      ReligiousTogether: '100% positive religious apartment matches (if capacity exists)',
      sectorMatching: 'Sector matching (community grouping)',
      avoidYearMix_1_with_3_4: 'Prefer not to mix 1st-year with 3rd/4th-year',
      avoidAtudaimWithHasmaha: 'Prefer not to mix graduate students with atudaim',

      strict: 'Strict',
      flexible: 'Flexible',
      critical: 'Critical',
      studentsToAssign: 'Students to assign',
      availableRooms: 'Available rooms',
      results: 'Allocation Results',
      assigned: 'Successfully assigned',
      roommateMatches: 'Roommate matches',
      conflicts: 'Conflicts',
      viewResults: 'View Results',
      noStudents: 'No students to assign',
    }
  }[language];

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

    // Simulate allocation process
    for (let i = 0; i <= 100; i += 5) {
      await new Promise(resolve => setTimeout(resolve, 100));
      setProgress(i);
    }

    // Mock results
    const totalToAssign = unassignedStudents.length;
    setResult({
      assigned: Math.floor(totalToAssign * 0.92),
      roommateMatches: Math.floor(totalToAssign * 0.3 * 0.75),
      conflicts: Math.floor(totalToAssign * 0.02),
      unassigned: Math.floor(totalToAssign * 0.08),
    });

    setIsRunning(false);
  };

  const currentRegion = regions.find(r => r.id === userRegion);

  return (
    <div className="allocation-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        {!isCentralAdmin() && currentRegion && (
          <span className="region-badge">
            {language === 'he' ? currentRegion.name : currentRegion.nameEn}
          </span>
        )}
      </div>

      <div className="allocation-grid">
        <div className="stats-row">
          <div className="stat-card">
            <Users size={24} />
            <div>
              <span className="number">{unassignedStudents.length}</span>
              <span className="label">{t.studentsToAssign}</span>
            </div>
          </div>
          <div className="stat-card">
            <Home size={24} />
            <div>
              <span className="number">{availableRooms.length}</span>
              <span className="label">{t.availableRooms}</span>
            </div>
          </div>
        </div>

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

                {/* Badge always visible */}
                <span className={`constraint-type ${value.strict ? 'strict' : 'flexible'}`}>
                  {value.strict ? t.strict : t.flexible}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="run-section">
          {unassignedStudents.length > 0 ? (
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

        {result && (
          <div className="results-card">
            <h3>{t.results}</h3>
            <div className="results-grid">
              <div className="result-item success">
                <Check size={20} />
                <span className="number">{result.assigned}</span>
                <span className="label">{t.assigned}</span>
              </div>
              <div className="result-item info">
                <Users size={20} />
                <span className="number">{result.roommateMatches}</span>
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

      <style>{`
        .allocation-page { padding: 24px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }
        .region-badge { background: linear-gradient(135deg, #3d9fe0, #2563eb); color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px; }

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
      `}</style>
    </div>
  );
}

export default AllocationPage;
