import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  AlertTriangle,
  Users,
  BedDouble,
  ArrowRight,
  Clock3,
  MapPin,
  SlidersHorizontal,
  ShieldCheck,
  Info,
  Sparkles,
} from 'lucide-react';

function AllocationResultsPage({ language = 'he' }) {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    result = null,
    summary = null,
    constraints = {},
    region = null,
    generatedAt = null,
  } = location.state || {};

  const t = useMemo(
    () =>
      ({
        he: {
          title: 'תוצאות השיבוץ',
          subtitle: 'פירוט מלא של תוצאות הרצת האלגוריתם',
          noDataTitle: 'אין נתוני תוצאות להצגה',
          noDataText: 'נראה שהדף נפתח בלי נתוני שיבוץ. אפשר לחזור לעמוד השיבוץ ולהריץ שוב או לפתוח תוצאות מיד אחרי ההרצה.',
          backToAllocation: 'חזרה לעמוד השיבוץ',
          region: 'אזור',
          generatedAt: 'זמן יצירה',
          assigned: 'שובצו בהצלחה',
          roommateMatches: 'התאמות שותפים',
          conflicts: 'התנגשויות',
          studentsToAssign: 'סטודנטים לשיבוץ',
          availableBeds: 'מיטות פנויות',
          assignedStudents: 'סטודנטים ששובצו',
          totalStudents: 'סה״כ סטודנטים',
          occupancyRate: 'שיעור תפוסה',
          activeConstraints: 'אילוצים פעילים',
          systemSummary: 'תקציר מערכת',
          runHighlights: 'תובנות מהריצה',
          enabled: 'פעיל',
          disabled: 'כבוי',
          strict: 'חובה',
          flexible: 'גמיש',
          critical: 'קריטי',
          weight: 'משקל',
          yes: 'כן',
          no: 'לא',
          noAssignmentsTable: 'לא התקבלה טבלת שיבוצים מפורטת מהשרת.',
          assignmentsTitle: 'שיבוצים מפורטים',
          student: 'סטודנט',
          studentId: 'מספר סטודנט',
          room: 'חדר',
          bed: 'מיטה',
          apartment: 'דירה',
          building: 'בניין',
          status: 'סטטוס',
          successMessage: 'ההרצה הושלמה והנתונים הבסיסיים זמינים להצגה.',
          cautionMessage: 'כדי להציג טבלת שיבוצים מלאה, השרת צריך להחזיר גם רשימת assignments בתוך result.',
          summaryBoxTitle: 'תמונת מצב',
        },
        en: {
          title: 'Allocation Results',
          subtitle: 'Full details of the algorithm run results',
          noDataTitle: 'No result data to display',
          noDataText: 'It looks like this page was opened without allocation data. You can go back to the allocation page and run again, or open results right after a run.',
          backToAllocation: 'Back to Allocation',
          region: 'Region',
          generatedAt: 'Generated At',
          assigned: 'Successfully Assigned',
          roommateMatches: 'Roommate Matches',
          conflicts: 'Conflicts',
          studentsToAssign: 'Students To Assign',
          availableBeds: 'Available Beds',
          assignedStudents: 'Assigned Students',
          totalStudents: 'Total Students',
          occupancyRate: 'Occupancy Rate',
          activeConstraints: 'Active Constraints',
          systemSummary: 'System Summary',
          runHighlights: 'Run Highlights',
          enabled: 'Enabled',
          disabled: 'Disabled',
          strict: 'Strict',
          flexible: 'Flexible',
          critical: 'Critical',
          weight: 'Weight',
          yes: 'Yes',
          no: 'No',
          noAssignmentsTable: 'No detailed assignments table was returned from the server.',
          assignmentsTitle: 'Detailed Assignments',
          student: 'Student',
          studentId: 'Student ID',
          room: 'Room',
          bed: 'Bed',
          apartment: 'Apartment',
          building: 'Building',
          status: 'Status',
          successMessage: 'The run completed and the main metrics are available.',
          cautionMessage: 'To display a full assignments table, the backend should also return an assignments list inside result.',
          summaryBoxTitle: 'Overview',
        },
      }[language] || {
        title: 'Allocation Results',
        subtitle: 'Full details of the algorithm run results',
        noDataTitle: 'No result data to display',
        noDataText: 'It looks like this page was opened without allocation data.',
        backToAllocation: 'Back to Allocation',
        region: 'Region',
        generatedAt: 'Generated At',
        assigned: 'Successfully Assigned',
        roommateMatches: 'Roommate Matches',
        conflicts: 'Conflicts',
        studentsToAssign: 'Students To Assign',
        availableBeds: 'Available Beds',
        assignedStudents: 'Assigned Students',
        totalStudents: 'Total Students',
        occupancyRate: 'Occupancy Rate',
        activeConstraints: 'Active Constraints',
        systemSummary: 'System Summary',
        runHighlights: 'Run Highlights',
        enabled: 'Enabled',
        disabled: 'Disabled',
        strict: 'Strict',
        flexible: 'Flexible',
        critical: 'Critical',
        weight: 'Weight',
        yes: 'Yes',
        no: 'No',
        noAssignmentsTable: 'No detailed assignments table was returned from the server.',
        assignmentsTitle: 'Detailed Assignments',
        student: 'Student',
        studentId: 'Student ID',
        room: 'Room',
        bed: 'Bed',
        apartment: 'Apartment',
        building: 'Building',
        status: 'Status',
        successMessage: 'The run completed and the main metrics are available.',
        cautionMessage: 'To display a full assignments table, the backend should also return an assignments list inside result.',
        summaryBoxTitle: 'Overview',
      }),
    [language]
  );

  const assignments = Array.isArray(result?.assignments) ? result.assignments : [];

  const constraintLabelMap = useMemo(
    () => ({
      sameGender: language === 'he' ? 'אותו מגדר בדירה' : 'Same gender in apartment',
      sameReligion: language === 'he' ? 'אותה דת בדירה' : 'Same religion in apartment',
      roommateMatch: language === 'he' ? 'התאמת שותפים מבוקשים' : 'Match roommate requests',
      priorityFirst: language === 'he' ? 'סטודנטים בעדיפות קודם' : 'Priority students first',
      roommatePositiveOnly: language === 'he' ? '100% תשובות חיוביות למבקשים להיות יחד' : '100% positive roommate matches',
      ReligiousTogether: language === 'he' ? '100% התאמות חיוביות דירת דתיים/ות' : '100% positive religious apartment matches',
      sectorMatching: language === 'he' ? 'התאמה לפי שייכות' : 'Sector matching',
      avoidYearMix_1_with_3_4: language === 'he' ? 'לא לשבץ שנה א׳ עם שנה ג׳/ד׳' : 'Avoid mixing 1st year with 3rd/4th',
      avoidAtudaimWithHasmaha: language === 'he' ? 'לא לשבץ הסמכה עם עתודאים' : 'Avoid mixing graduate with atudaim',
    }),
    [language]
  );

  const formattedGeneratedAt = generatedAt
    ? new Date(generatedAt).toLocaleString(language === 'he' ? 'he-IL' : 'en-US')
    : '-';

  const formattedOccupancy =
    typeof summary?.occupancy_rate === 'number' || typeof summary?.occupancy_rate === 'string'
      ? `${Number(summary.occupancy_rate || 0).toFixed(1)}%`
      : '0%';

  const goBack = () => navigate('/allocation');

  if (!result) {
    return (
      <div className="allocation-results-page">
        <div className="results-shell">
          <div className="empty-card">
            <div className="empty-icon">
              <Info size={28} />
            </div>
            <h1>{t.noDataTitle}</h1>
            <p>{t.noDataText}</p>
            <button className="primary-btn" onClick={goBack}>
              <ArrowRight size={18} />
              {t.backToAllocation}
            </button>
          </div>
        </div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="allocation-results-page">
      <div className="results-shell">
        <div className="results-topbar">
          <div className="title-block">
            <div className="eyebrow">
              <Sparkles size={16} />
              <span>{t.runHighlights}</span>
            </div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>

          <button className="secondary-btn" onClick={goBack}>
            <ArrowRight size={18} />
            {t.backToAllocation}
          </button>
        </div>

        <div className="meta-row">
          <div className="meta-card">
            <div className="meta-icon blue">
              <MapPin size={18} />
            </div>
            <div>
              <div className="meta-label">{t.region}</div>
              <div className="meta-value">
                {region?.name || region?.name_en || '-'}
              </div>
            </div>
          </div>

          <div className="meta-card">
            <div className="meta-icon purple">
              <Clock3 size={18} />
            </div>
            <div>
              <div className="meta-label">{t.generatedAt}</div>
              <div className="meta-value">{formattedGeneratedAt}</div>
            </div>
          </div>
        </div>

        <div className="hero-kpis">
          <div className="hero-card success">
            <div className="hero-icon">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <div className="hero-number">{result?.successful_assignments || 0}</div>
              <div className="hero-label">{t.assigned}</div>
            </div>
          </div>

          <div className="hero-card info">
            <div className="hero-icon">
              <Users size={24} />
            </div>
            <div>
              <div className="hero-number">{result?.roommate_matches || 0}</div>
              <div className="hero-label">{t.roommateMatches}</div>
            </div>
          </div>

          <div className="hero-card warning">
            <div className="hero-icon">
              <AlertTriangle size={24} />
            </div>
            <div>
              <div className="hero-number">{result?.conflicts || 0}</div>
              <div className="hero-label">{t.conflicts}</div>
            </div>
          </div>
        </div>

        <div className="content-grid">
          <div className="left-col">
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <ShieldCheck size={18} />
                  <span>{t.summaryBoxTitle}</span>
                </div>
              </div>

              <div className="summary-grid">
                <div className="summary-item">
                  <div className="summary-item-icon">
                    <Users size={18} />
                  </div>
                  <div>
                    <div className="summary-item-value">{summary?.unassigned_students || 0}</div>
                    <div className="summary-item-label">{t.studentsToAssign}</div>
                  </div>
                </div>

                <div className="summary-item">
                  <div className="summary-item-icon">
                    <BedDouble size={18} />
                  </div>
                  <div>
                    <div className="summary-item-value">{summary?.available_beds || 0}</div>
                    <div className="summary-item-label">{t.availableBeds}</div>
                  </div>
                </div>

                <div className="summary-item">
                  <div className="summary-item-icon">
                    <CheckCircle2 size={18} />
                  </div>
                  <div>
                    <div className="summary-item-value">{summary?.assigned_students || result?.successful_assignments || 0}</div>
                    <div className="summary-item-label">{t.assignedStudents}</div>
                  </div>
                </div>

                <div className="summary-item">
                  <div className="summary-item-icon">
                    <Users size={18} />
                  </div>
                  <div>
                    <div className="summary-item-value">{summary?.total_students || 0}</div>
                    <div className="summary-item-label">{t.totalStudents}</div>
                  </div>
                </div>

                <div className="summary-item wide">
                  <div className="summary-item-icon">
                    <SlidersHorizontal size={18} />
                  </div>
                  <div>
                    <div className="summary-item-value">{formattedOccupancy}</div>
                    <div className="summary-item-label">{t.occupancyRate}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <SlidersHorizontal size={18} />
                  <span>{t.activeConstraints}</span>
                </div>
              </div>

              <div className="constraints-list">
                {Object.entries(constraints || {}).map(([key, value]) => (
                  <div key={key} className="constraint-card">
                    <div className="constraint-main">
                      <div className="constraint-name">
                        {constraintLabelMap[key] || key}
                      </div>
                      <div className="constraint-tags">
                        <span className={`tag ${value?.enabled ? 'green' : 'gray'}`}>
                          {value?.enabled ? t.enabled : t.disabled}
                        </span>
                        <span className={`tag ${value?.strict ? 'red' : 'blue'}`}>
                          {value?.strict ? t.strict : t.flexible}
                        </span>
                        {value?.critical && (
                          <span className="tag orange">{t.critical}</span>
                        )}
                      </div>
                    </div>

                    <div className="constraint-weight">
                      <span>{t.weight}</span>
                      <div className="weight-track">
                        <div
                          className="weight-fill"
                          style={{ width: `${Math.max(0, Math.min(10, Number(value?.weight || 0))) * 10}%` }}
                        />
                      </div>
                      <strong>{Number(value?.weight || 0)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="right-col">
            <div className="panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Info size={18} />
                  <span>{t.systemSummary}</span>
                </div>
              </div>

              <div className="message-stack">
                <div className="message success-msg">
                  <CheckCircle2 size={18} />
                  <span>{t.successMessage}</span>
                </div>

                <div className="message warn-msg">
                  <AlertTriangle size={18} />
                  <span>{t.cautionMessage}</span>
                </div>
              </div>
            </div>

            <div className="panel assignments-panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Users size={18} />
                  <span>{t.assignmentsTitle}</span>
                </div>
              </div>

              {assignments.length === 0 ? (
                <div className="empty-table-state">
                  <AlertTriangle size={18} />
                  <span>{t.noAssignmentsTable}</span>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="assignments-table">
                    <thead>
                      <tr>
                        <th>{t.student}</th>
                        <th>{t.studentId}</th>
                        <th>{t.building}</th>
                        <th>{t.apartment}</th>
                        <th>{t.room}</th>
                        <th>{t.bed}</th>
                        <th>{t.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map((item, index) => (
                        <tr key={index}>
                          <td>{item?.student_name || '-'}</td>
                          <td>{item?.student_id || '-'}</td>
                          <td>{item?.building_name || item?.building || '-'}</td>
                          <td>{item?.apartment_number || item?.apartment || '-'}</td>
                          <td>{item?.room_number || item?.room || '-'}</td>
                          <td>{item?.bed_number || item?.bed || '-'}</td>
                          <td>
                            <span className="table-status">
                              {item?.status || 'assigned'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{styles}</style>
    </div>
  );
}

const styles = `
  :root{
    --bg: #f5f7fb;
    --card: #ffffff;
    --text: #0f172a;
    --muted: #64748b;
    --border: rgba(15,23,42,0.08);
    --shadow: 0 14px 40px rgba(15,23,42,0.08);
    --shadow-soft: 0 8px 24px rgba(15,23,42,0.06);
    --blue: #2563eb;
    --blue-soft: rgba(37,99,235,0.10);
    --green: #059669;
    --green-soft: rgba(5,150,105,0.10);
    --orange: #d97706;
    --orange-soft: rgba(217,119,6,0.12);
    --red: #dc2626;
    --red-soft: rgba(220,38,38,0.10);
    --purple: #7c3aed;
    --purple-soft: rgba(124,58,237,0.10);
    --radius-xl: 24px;
    --radius-lg: 18px;
    --radius-md: 14px;
  }

  .allocation-results-page{
    min-height: 100vh;
    background:
      radial-gradient(circle at top right, rgba(37,99,235,0.05), transparent 28%),
      radial-gradient(circle at top left, rgba(124,58,237,0.05), transparent 24%),
      var(--bg);
    padding: 24px;
  }

  .results-shell{
    max-width: 1300px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .results-topbar{
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    background: rgba(255,255,255,0.75);
    border: 1px solid rgba(255,255,255,0.75);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(10px);
    border-radius: var(--radius-xl);
    padding: 22px;
  }

  .title-block h1{
    margin: 0;
    font-size: 32px;
    line-height: 1.05;
    font-weight: 950;
    letter-spacing: -0.03em;
    color: var(--text);
  }

  .title-block p{
    margin: 8px 0 0;
    color: var(--muted);
    font-size: 14px;
    font-weight: 700;
  }

  .eyebrow{
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    background: rgba(255,255,255,0.9);
    border: 1px solid var(--border);
    color: var(--blue);
    font-size: 12px;
    font-weight: 900;
    margin-bottom: 12px;
  }

  .primary-btn,
  .secondary-btn{
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border-radius: 14px;
    padding: 12px 16px;
    font-family: inherit;
    font-size: 14px;
    font-weight: 900;
    cursor: pointer;
    transition: 0.18s ease;
    white-space: nowrap;
  }

  .primary-btn{
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: white;
    border: 1px solid rgba(37,99,235,0.25);
    box-shadow: 0 10px 20px rgba(37,99,235,0.20);
  }

  .secondary-btn{
    background: white;
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-soft);
  }

  .primary-btn:hover,
  .secondary-btn:hover{
    transform: translateY(-1px);
  }

  .meta-row{
    display: grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap: 14px;
  }

  .meta-card{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-soft);
    padding: 16px;
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .meta-icon{
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .meta-icon.blue{
    background: var(--blue-soft);
    color: var(--blue);
  }

  .meta-icon.purple{
    background: var(--purple-soft);
    color: var(--purple);
  }

  .meta-label{
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .meta-value{
    margin-top: 4px;
    color: var(--text);
    font-size: 15px;
    font-weight: 900;
  }

  .hero-kpis{
    display: grid;
    grid-template-columns: repeat(3, minmax(0,1fr));
    gap: 14px;
  }

  .hero-card{
    border-radius: var(--radius-xl);
    padding: 20px;
    border: 1px solid transparent;
    display: flex;
    align-items: center;
    gap: 14px;
    box-shadow: var(--shadow-soft);
    min-height: 110px;
  }

  .hero-card.success{
    background: linear-gradient(135deg, rgba(5,150,105,0.12), rgba(5,150,105,0.06));
    border-color: rgba(5,150,105,0.18);
  }

  .hero-card.info{
    background: linear-gradient(135deg, rgba(37,99,235,0.12), rgba(37,99,235,0.06));
    border-color: rgba(37,99,235,0.18);
  }

  .hero-card.warning{
    background: linear-gradient(135deg, rgba(217,119,6,0.14), rgba(217,119,6,0.06));
    border-color: rgba(217,119,6,0.18);
  }

  .hero-icon{
    width: 52px;
    height: 52px;
    border-radius: 18px;
    background: rgba(255,255,255,0.85);
    border: 1px solid rgba(255,255,255,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .hero-number{
    font-size: 30px;
    line-height: 1;
    font-weight: 950;
    letter-spacing: -0.03em;
    color: var(--text);
  }

  .hero-label{
    margin-top: 6px;
    color: #334155;
    font-size: 13px;
    font-weight: 800;
  }

  .content-grid{
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 16px;
    align-items: start;
  }

  .left-col,
  .right-col{
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .panel{
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow);
    padding: 18px;
  }

  .panel-header{
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title{
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: var(--text);
    font-weight: 950;
  }

  .summary-grid{
    display: grid;
    grid-template-columns: repeat(2, minmax(0,1fr));
    gap: 12px;
  }

  .summary-item{
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    padding: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .summary-item.wide{
    grid-column: span 2;
  }

  .summary-item-icon{
    width: 40px;
    height: 40px;
    border-radius: 14px;
    background: rgba(37,99,235,0.08);
    color: var(--blue);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .summary-item-value{
    font-size: 22px;
    font-weight: 950;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .summary-item-label{
    margin-top: 3px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .constraints-list{
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .constraint-card{
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    background: rgba(15,23,42,0.02);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .constraint-main{
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: flex-start;
  }

  .constraint-name{
    color: var(--text);
    font-weight: 900;
    font-size: 14px;
    line-height: 1.5;
  }

  .constraint-tags{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .tag{
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 900;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .tag.green{
    background: var(--green-soft);
    color: var(--green);
    border-color: rgba(5,150,105,0.16);
  }

  .tag.gray{
    background: rgba(15,23,42,0.05);
    color: #475569;
    border-color: rgba(15,23,42,0.08);
  }

  .tag.red{
    background: var(--red-soft);
    color: var(--red);
    border-color: rgba(220,38,38,0.16);
  }

  .tag.blue{
    background: var(--blue-soft);
    color: var(--blue);
    border-color: rgba(37,99,235,0.16);
  }

  .tag.orange{
    background: var(--orange-soft);
    color: var(--orange);
    border-color: rgba(217,119,6,0.16);
  }

  .constraint-weight{
    display: grid;
    grid-template-columns: 52px 1fr 32px;
    gap: 10px;
    align-items: center;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .weight-track{
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: rgba(15,23,42,0.08);
    overflow: hidden;
  }

  .weight-fill{
    height: 100%;
    border-radius: 999px;
    background: linear-gradient(90deg, #2563eb, #7c3aed);
  }

  .message-stack{
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .message{
    display: flex;
    align-items: center;
    gap: 10px;
    border-radius: var(--radius-lg);
    padding: 14px;
    font-size: 13px;
    font-weight: 800;
    line-height: 1.6;
    border: 1px solid transparent;
  }

  .success-msg{
    background: var(--green-soft);
    color: var(--green);
    border-color: rgba(5,150,105,0.16);
  }

  .warn-msg{
    background: var(--orange-soft);
    color: var(--orange);
    border-color: rgba(217,119,6,0.16);
  }

  .assignments-panel{
    min-height: 420px;
  }

  .empty-table-state{
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px;
    border-radius: var(--radius-lg);
    background: rgba(15,23,42,0.03);
    border: 1px dashed rgba(15,23,42,0.12);
    color: var(--muted);
    font-weight: 800;
  }

  .table-wrap{
    overflow: auto;
    border-radius: 16px;
    border: 1px solid var(--border);
  }

  .assignments-table{
    width: 100%;
    border-collapse: collapse;
    min-width: 760px;
    background: white;
  }

  .assignments-table thead th{
    position: sticky;
    top: 0;
    background: #f8fafc;
    color: #334155;
    font-size: 12px;
    font-weight: 900;
    text-align: start;
    padding: 14px 12px;
    border-bottom: 1px solid var(--border);
  }

  .assignments-table tbody td{
    padding: 14px 12px;
    border-bottom: 1px solid rgba(15,23,42,0.06);
    color: var(--text);
    font-size: 13px;
    font-weight: 700;
    vertical-align: middle;
  }

  .assignments-table tbody tr:hover{
    background: rgba(37,99,235,0.03);
  }

  .table-status{
    display: inline-flex;
    align-items: center;
    padding: 6px 10px;
    border-radius: 999px;
    background: var(--green-soft);
    color: var(--green);
    font-size: 12px;
    font-weight: 900;
    border: 1px solid rgba(5,150,105,0.16);
  }

  .empty-card{
    max-width: 760px;
    margin: 80px auto 0;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 28px;
    box-shadow: var(--shadow);
    padding: 34px;
    text-align: center;
  }

  .empty-icon{
    width: 64px;
    height: 64px;
    margin: 0 auto 16px;
    border-radius: 20px;
    background: var(--blue-soft);
    color: var(--blue);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-card h1{
    margin: 0;
    color: var(--text);
    font-size: 28px;
    font-weight: 950;
    letter-spacing: -0.03em;
  }

  .empty-card p{
    max-width: 560px;
    margin: 12px auto 0;
    color: var(--muted);
    font-size: 14px;
    line-height: 1.8;
    font-weight: 700;
  }

  .empty-card .primary-btn{
    margin-top: 20px;
  }

  @media (max-width: 1100px){
    .content-grid{
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 860px){
    .hero-kpis,
    .meta-row,
    .summary-grid{
      grid-template-columns: 1fr;
    }

    .summary-item.wide{
      grid-column: span 1;
    }

    .results-topbar{
      flex-direction: column;
      align-items: stretch;
    }

    .constraint-main{
      flex-direction: column;
    }

    .constraint-tags{
      justify-content: flex-start;
    }
  }

  @media (max-width: 640px){
    .allocation-results-page{
      padding: 14px;
    }

    .title-block h1{
      font-size: 26px;
    }

    .hero-number{
      font-size: 26px;
    }
  }
`;

export default AllocationResultsPage;