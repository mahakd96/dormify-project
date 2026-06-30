import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { allocationAPI } from '../services/api';
import {
  AlertTriangle,
  Users,
  ArrowRight,
  Clock3,
  MapPin,
  Info,
  Sparkles,
} from 'lucide-react';

const getValue = (item, keys) => {
  for (const key of keys) {
    if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== '') {
      return item[key];
    }
  }
  return '';
};

const extractNumber = (value) => {
  if (value === undefined || value === null) return 0;

  const match = String(value).match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
};

const getBuilding = (item) =>
  getValue(item, ['building_number', 'building_name', 'building']);

const getApartment = (item) =>
  getValue(item, ['apartment_number', 'apartment']);

const getRoom = (item) =>
  getValue(item, ['room_number', 'room_name', 'room']);

const getBed = (item) =>
  getValue(item, ['bed_number', 'bed_label', 'bed']);

const sortAssignmentsByLocation = (assignments) => {
  return [...assignments].sort((a, b) => {
    const buildingCompare =
      extractNumber(getBuilding(a)) - extractNumber(getBuilding(b));

    if (buildingCompare !== 0) return buildingCompare;

    const apartmentCompare =
      extractNumber(getApartment(a)) - extractNumber(getApartment(b));

    if (apartmentCompare !== 0) return apartmentCompare;

    const roomCompare =
      extractNumber(getRoom(a)) - extractNumber(getRoom(b));

    if (roomCompare !== 0) return roomCompare;

    const bedCompare =
      extractNumber(getBed(a)) - extractNumber(getBed(b));

    if (bedCompare !== 0) return bedCompare;

    return String(getBuilding(a)).localeCompare(String(getBuilding(b)), 'he', {
      numeric: true,
    });
  });
};

const groupAssignmentsByBuilding = (assignments) => {
  const sortedAssignments = sortAssignmentsByLocation(assignments);

  return sortedAssignments.reduce((groups, item) => {
    const building = getBuilding(item) || 'ללא בניין';

    if (!groups[building]) {
      groups[building] = [];
    }

    groups[building].push(item);
    return groups;
  }, {});
};

function AllocationResultsPage({ language = 'he' }) {
  const location = useLocation();
  const navigate = useNavigate();

  const {
    result: routeResult = null,
    summary = null,
    region = null,
    generatedAt = null,
  } = location.state || {};

  const [serverResult, setServerResult] = useState(
    routeResult || {
      assignments: [],
      successful_assignments: 0,
      roommate_matches: 0,
      conflicts: 0,
    }
  );

  const [resultsLoading, setResultsLoading] = useState(true);
  const [resultsError, setResultsError] = useState(null);

  const result = serverResult || {
    assignments: [],
    successful_assignments: 0,
    roommate_matches: 0,
    conflicts: 0,
  };

  const t = useMemo(
    () =>
      ({
        he: {
          title: 'תוצאות השיבוץ',
          subtitle: 'תוצאות השיבוץ השמורות במערכת לפי אזור המשתמש',
          backToAllocation: 'חזרה לעמוד השיבוץ',
          region: 'אזור',
          generatedAt: 'זמן יצירה',
          assigned: 'שובצו בהצלחה',
          roommateMatches: 'התאמות שותפים',
          conflicts: 'התנגשויות',
          runHighlights: 'תוצאות מהמערכת',
          noAssignmentsTable: 'אין תוצאות להצגה',
          assignmentsTitle: 'שיבוצים מפורטים',
          student: 'סטודנט',
          studentId: 'מספר סטודנט',
          room: 'חדר',
          bed: 'מיטה',
          apartment: 'דירה',
          building: 'בניין',
          status: 'סטטוס',
          loadingResults: 'טוען תוצאות...',
          errorLoadingResults: 'שגיאה בטעינת תוצאות השיבוץ',
          assignmentsCount: 'שיבוצים',
          buildingStart: 'תחילת נתונים עבור',
        },
        en: {
          title: 'Allocation Results',
          subtitle: 'Saved allocation results according to the user region',
          backToAllocation: 'Back to Allocation',
          region: 'Region',
          generatedAt: 'Generated At',
          assigned: 'Successfully Assigned',
          roommateMatches: 'Roommate Matches',
          conflicts: 'Conflicts',
          runHighlights: 'System Results',
          noAssignmentsTable: 'No results to display.',
          assignmentsTitle: 'Detailed Assignments',
          student: 'Student',
          studentId: 'Student ID',
          room: 'Room',
          bed: 'Bed',
          apartment: 'Apartment',
          building: 'Building',
          status: 'Status',
          loadingResults: 'Loading results...',
          errorLoadingResults: 'Error loading allocation results',
          assignmentsCount: 'assignments',
          buildingStart: 'Starting data for',
        },
      }[language] || {
        title: 'Allocation Results',
        subtitle: 'Saved allocation results according to the user region',
        backToAllocation: 'Back to Allocation',
        region: 'Region',
        generatedAt: 'Generated At',
        assigned: 'Successfully Assigned',
        roommateMatches: 'Roommate Matches',
        conflicts: 'Conflicts',
        runHighlights: 'System Results',
        noAssignmentsTable: 'No results to display.',
        assignmentsTitle: 'Detailed Assignments',
        student: 'Student',
        studentId: 'Student ID',
        room: 'Room',
        bed: 'Bed',
        apartment: 'Apartment',
        building: 'Building',
        status: 'Status',
        loadingResults: 'Loading results...',
        errorLoadingResults: 'Error loading allocation results',
        assignmentsCount: 'assignments',
        buildingStart: 'Starting data for',
      }),
    [language]
  );

  useEffect(() => {
    const loadResults = async () => {
      setResultsLoading(true);
      setResultsError(null);

      try {
        const regionId =
          region?.id ||
          summary?.region?.id ||
          summary?.region_id ||
          null;

        const responseRaw = regionId
          ? await allocationAPI.getResults(regionId)
          : await allocationAPI.getResults();

        const data = responseRaw?.data || responseRaw;

        const assignmentsFromDb = Array.isArray(data?.assignments)
          ? data.assignments
          : [];

        setServerResult({
          ...(routeResult || {}),
          assignments: assignmentsFromDb,
          successful_assignments:
            Number(data?.count ?? assignmentsFromDb.length) || 0,
          roommate_matches: Number(routeResult?.roommate_matches) || 0,
          conflicts: Number(routeResult?.conflicts) || 0,
        });
      } catch (err) {
        console.error('Failed to load allocation results:', err);

        setResultsError(
          err?.response?.data?.error ||
            err?.message ||
            t.errorLoadingResults
        );

        setServerResult({
          ...(routeResult || {}),
          assignments: [],
          successful_assignments: 0,
          roommate_matches: Number(routeResult?.roommate_matches) || 0,
          conflicts: Number(routeResult?.conflicts) || 0,
        });
      } finally {
        setResultsLoading(false);
      }
    };

    loadResults();
  }, [
    t.errorLoadingResults,
    region?.id,
    summary?.region?.id,
    summary?.region_id,
    routeResult,
  ]);

  const assignments = Array.isArray(result?.assignments)
    ? result.assignments
    : [];

  const assignmentsByBuilding = useMemo(
    () => groupAssignmentsByBuilding(assignments),
    [assignments]
  );

  const allocationCreatedAt =
    generatedAt ||
    result?.run?.completed_at ||
    result?.run?.started_at ||
    summary?.latest_run?.completed_at ||
    summary?.latest_run?.started_at ||
    assignments?.[0]?.assigned_at ||
    null;

  const formattedGeneratedAt = allocationCreatedAt
    ? new Date(allocationCreatedAt).toLocaleString(
        language === 'he' ? 'he-IL' : 'en-US'
      )
    : '-';

  const displayRegion =
    region?.name ||
    region?.name_en ||
    summary?.region?.name ||
    summary?.region?.name_en ||
    assignments?.[0]?.region ||
    '-';

  const goBack = () => navigate('/allocation');

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
              <div className="meta-value">{displayRegion}</div>
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

        <div className="content-grid">
          <div className="right-col">
            <div className="panel assignments-panel">
              <div className="panel-header">
                <div className="panel-title">
                  <Users size={18} />
                  <span>{t.assignmentsTitle}</span>
                </div>
              </div>

              {resultsLoading ? (
                <div className="empty-table-state">
                  <Info size={18} />
                  <span>{t.loadingResults}</span>
                </div>
              ) : resultsError ? (
                <div className="empty-table-state error">
                  <AlertTriangle size={18} />
                  <span>{resultsError}</span>
                </div>
              ) : assignments.length === 0 ? (
                <div className="empty-table-state">
                  <Info size={18} />
                  <span>{t.noAssignmentsTable}</span>
                </div>
              ) : (
                <div className="building-results-list">
                  {Object.entries(assignmentsByBuilding).map(
                    ([building, buildingAssignments], buildingIndex) => (
                      <React.Fragment key={building}>
                        {buildingIndex > 0 && (
                          <div className="building-separator">
                            <span>
                              {t.buildingStart} {t.building} {building}
                            </span>
                          </div>
                        )}

                        <div className="building-results-card">
                          <div className="building-results-header">
                            <div>
                              <div className="building-title">
                                {t.building} {building}
                              </div>
                              <div className="building-subtitle">
                                {buildingAssignments.length} {t.assignmentsCount}
                              </div>
                            </div>
                          </div>

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
                                {buildingAssignments.map((item, index) => (
                                  <tr
                                    key={`${item?.student_id || 'student'}-${building}-${index}`}
                                  >
                                    <td>
                                      {item?.student_name || item?.full_name || '-'}
                                    </td>
                                    <td>{item?.student_id || '-'}</td>
                                    <td>{getBuilding(item) || '-'}</td>
                                    <td>{getApartment(item) || '-'}</td>
                                    <td>{getRoom(item) || '-'}</td>
                                    <td>{getBed(item) || '-'}</td>
                                    <td>
                                      <span className="table-status">
                                        {item?.assignment_status ||
                                          item?.status ||
                                          'assigned'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </React.Fragment>
                    )
                  )}
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
    --red: #dc2626;
    --red-soft: rgba(220,38,38,0.10);
    --purple: #7c3aed;
    --purple-soft: rgba(124,58,237,0.10);
    --radius-xl: 24px;
    --radius-lg: 18px;
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
    background: white;
    color: var(--text);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-soft);
  }

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

  .content-grid{
    display: grid;
    grid-template-columns: 1fr;
    gap: 16px;
    align-items: start;
  }

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

  .assignments-panel{
    min-height: 420px;
  }

  .building-results-list{
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .building-results-card{
    background: #ffffff;
    border: 1px solid var(--border);
    border-radius: 20px;
    overflow: hidden;
    box-shadow: var(--shadow-soft);
  }

  .building-separator{
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 10px 0 0;
    position: relative;
  }

  .building-separator::before{
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: linear-gradient(
      to left,
      transparent,
      rgba(37, 99, 235, 0.85),
      transparent
    );
  }

  .building-separator span{
    position: relative;
    z-index: 1;
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid rgba(37, 99, 235, 0.30);
    border-radius: 999px;
    padding: 10px 24px;
    font-size: 13px;
    font-weight: 950;
    box-shadow: 0 8px 20px rgba(37, 99, 235, 0.14);
  }

  .building-results-header{
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 18px 22px;
    background: linear-gradient(135deg, #eaf2ff, #f8fbff);
    border-bottom: 2px solid rgba(37, 99, 235, 0.18);
    border-right: 6px solid #2563eb;
  }

  .building-title{
    color: var(--text);
    font-size: 18px;
    font-weight: 950;
  }

  .building-subtitle{
    margin-top: 4px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 800;
  }

  .building-results-card .table-wrap{
    border: none;
    border-radius: 0;
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

  .empty-table-state.error{
    background: var(--red-soft);
    color: var(--red);
    border-color: rgba(220,38,38,0.18);
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

  @media (max-width: 860px){
    .meta-row{
      grid-template-columns: 1fr;
    }

    .results-topbar{
      flex-direction: column;
      align-items: stretch;
    }
  }

  @media (max-width: 640px){
    .allocation-results-page{
      padding: 14px;
    }

    .title-block h1{
      font-size: 26px;
    }
  }
`;

export default AllocationResultsPage;