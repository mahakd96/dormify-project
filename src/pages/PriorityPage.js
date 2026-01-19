// SpecialRequestsPage.js - For Central Admin to manage special requests
import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { students, regions, buildings, apartments, rooms, specialRequests } from '../data/mockData';
import { Star, Plus, MapPin, ArrowRight, Filter, Search, Lock, Home } from 'lucide-react';

function PriorityPage({ language }) {
  const { canAssignPriority } = useAuth();

  const [statusFilter, setStatusFilter] = useState('pending'); // pending | approved | rejected | all
  const [typeFilter, setTypeFilter] = useState('all'); // all | transfer | accessibility | medical | other
  const [searchQuery, setSearchQuery] = useState('');

  const t = {
    he: {
      title: 'סטודנטים עם בקשות מיוחדות',
      subtitle: 'ניהול בקשות חריגות: העברה, נגישות וצרכים מיוחדים',
      addRequest: 'הוסף בקשה',
      search: 'חיפוש לפי שם / מספר סטודנט...',
      status: 'סטטוס',
      type: 'סוג בקשה',
      pending: 'ממתין',
      approved: 'אושר',
      rejected: 'נדחה',
      all: 'הכל',
      transfer: 'העברה',
      accessibility: 'נגישות',
      medical: 'רפואי',
      other: 'אחר',

      now: 'מגורים נוכחיים',
      requestedDormType: 'יעד מבוקש (סוג מעונות)',
      availability: 'זמינות באזור היעד',

      needs: 'צרכים',
      note: 'הערה',
      noData: 'אין בקשות להצגה',
      noAccess: 'אין לך הרשאה לדף זה',

      floorPref: 'קומה',
      elevator: 'מעלית',
      accessible: 'חדר נגיש',
      nearEntrance: 'קרוב לכניסה',
      unknown: 'לא ידוע',
      bedsFree: 'מיטות פנויות',
      outOf: 'מתוך',
    },
    en: {
      title: 'Students with Special Requests',
      subtitle: 'Manage exceptional requests: transfers, accessibility, and special needs',
      addRequest: 'Add Request',
      search: 'Search by name / student number...',
      status: 'Status',
      type: 'Request Type',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      all: 'All',
      transfer: 'Transfer',
      accessibility: 'Accessibility',
      medical: 'Medical',
      other: 'Other',

      now: 'Current Living',
      requestedDormType: 'Requested Dorm Type',
      availability: 'Target availability',

      needs: 'Needs',
      note: 'Note',
      noData: 'No requests to display',
      noAccess: 'You do not have access to this page',

      floorPref: 'Floor',
      elevator: 'Elevator',
      accessible: 'Accessible room',
      nearEntrance: 'Near entrance',
      unknown: 'Unknown',
      bedsFree: 'Free beds',
      outOf: 'out of',
    }
  }[language];

  if (!canAssignPriority()) {
    return (
      <div className="no-access">
        <p>{t.noAccess}</p>
      </div>
    );
  }

  // ---------- helpers ----------
  const findStudent = (studentInternalId) => students.find(s => s.id === studentInternalId);

  const getRegionName = (regionId) => {
    const r = regions.find(x => x.id === regionId);
    if (!r) return t.unknown;
    return language === 'he' ? r.name : r.nameEn;
  };

  const getBuildingName = (buildingId) => {
    const b = buildings.find(x => x.id === buildingId);
    return b?.name || t.unknown;
  };

  const getApartmentLabel = (apartmentId) => {
    const a = apartments.find(x => x.id === apartmentId);
    if (!a) return t.unknown;
    return `${language === 'he' ? 'דירה' : 'Apt'} ${a.number} • ${language === 'he' ? 'קומה' : 'Floor'} ${a.floor}`;
  };

  const getRoomLabel = (roomId) => {
    const r = rooms.find(x => x.id === roomId);
    return r?.name || t.unknown;
  };

  // Current location stays detailed
  const formatCurrentLocation = (loc) => {
    if (!loc) return t.unknown;
    const parts = [];
    if (loc.regionId) parts.push(getRegionName(loc.regionId));
    if (loc.buildingId) parts.push(getBuildingName(loc.buildingId));
    if (loc.apartmentId) parts.push(getApartmentLabel(loc.apartmentId));
    if (loc.roomId) parts.push(getRoomLabel(loc.roomId));
    return parts.length ? parts.join(' • ') : t.unknown;
  };

  // Requested target = ONLY region/dorm type
  const formatRequestedDormType = (requested) => {
    const rid = requested?.regionId;
    return rid ? getRegionName(rid) : t.unknown;
  };

  // Calculate availability in a region (free beds / total beds)
  const regionAvailability = (regionId) => {
    if (!regionId) return null;
    const regionRooms = rooms.filter(r => r.regionId === regionId);
    const totalBeds = regionRooms.reduce((sum, r) => sum + (r.capacity || 0), 0);
    const occupiedBeds = regionRooms.reduce((sum, r) => sum + (r.currentOccupancy || 0), 0);
    const freeBeds = Math.max(0, totalBeds - occupiedBeds);

    return { freeBeds, totalBeds };
  };

  const renderNeedsChips = (needs) => {
    if (!needs) return <span className="muted">{t.unknown}</span>;
    const chips = [];

    if (needs.floorPreference != null) chips.push(`${t.floorPref} ${needs.floorPreference}`);
    if (needs.requiresElevator) chips.push(t.elevator);
    if (needs.accessibleRoom) chips.push(t.accessible);
    if (needs.nearEntrance) chips.push(t.nearEntrance);

    if (chips.length === 0) return <span className="muted">{t.unknown}</span>;

    return (
      <div className="chips">
        {chips.map((c, idx) => (
          <span key={idx} className="chip">{c}</span>
        ))}
      </div>
    );
  };

  const filteredRequests = useMemo(() => {
    let list = specialRequests || [];

    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter);
    if (typeFilter !== 'all') list = list.filter(r => r.type === typeFilter);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(req => {
        const st = findStudent(req.studentId);
        if (!st) return false;
        const fullName = `${st.firstName} ${st.lastName}`.toLowerCase();
        return fullName.includes(q) || (st.studentId || '').toLowerCase().includes(q);
      });
    }

    return [...list].sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
  }, [statusFilter, typeFilter, searchQuery]);

  const statusLabel = (s) => (s === 'pending' ? t.pending : s === 'approved' ? t.approved : t.rejected);
  const typeLabel = (x) => (x === 'transfer' ? t.transfer : x === 'accessibility' ? t.accessibility : x === 'medical' ? t.medical : t.other);

  return (
    <div className="priority-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>

        <button className="add-btn">
          <Plus size={18} /> {t.addRequest}
        </button>
      </div>

      <div className="controls">
        <div className="search">
          <Search size={18} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.search}
          />
        </div>

        <div className="filters">
          <div className="filter">
            <Filter size={16} />
            <span className="filter-label">{t.status}</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="pending">{t.pending}</option>
              <option value="approved">{t.approved}</option>
              <option value="rejected">{t.rejected}</option>
              <option value="all">{t.all}</option>
            </select>
          </div>

          <div className="filter">
            <span className="filter-label">{t.type}</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">{t.all}</option>
              <option value="transfer">{t.transfer}</option>
              <option value="accessibility">{t.accessibility}</option>
              <option value="medical">{t.medical}</option>
              <option value="other">{t.other}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="priority-list">
        {filteredRequests.length > 0 ? filteredRequests.map(req => {
          const st = findStudent(req.studentId);

          const statusClass = req.status === 'approved' ? 'approved' : req.status === 'rejected' ? 'rejected' : 'pending';

          const requestedRegionId = req.requested?.regionId || null;
          const avail = regionAvailability(requestedRegionId);

          return (
            <div key={req.id} className={`request-card ${statusClass}`}>
              <div className="left">
                <div className="icon">
                  <Star size={18} />
                </div>

                <div className="main">
                  <div className="topline">
                    <span className="name">
                      {st ? `${st.firstName} ${st.lastName}` : t.unknown}
                    </span>
                    {st?.studentId && <span className="sid">#{st.studentId}</span>}
                    <span className="type-badge">{typeLabel(req.type)}</span>
                  </div>

                  <div className="locations">
                    <div className="loc">
                      <MapPin size={14} />
                      <span className="loc-title">{t.now}:</span>
                      <span className="loc-value">{formatCurrentLocation(req.current)}</span>
                    </div>

                    <div className="loc">
                      <ArrowRight size={14} />
                      <span className="loc-title">{t.requestedDormType}:</span>
                      <span className="loc-value">{formatRequestedDormType(req.requested)}</span>

                      {avail && (
                        <span className="availability">
                          <Home size={14} />
                          {t.availability}: {avail.freeBeds} {t.bedsFree} {t.outOf} {avail.totalBeds}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="needs">
                    <span className="needs-title">{t.needs}:</span>
                    {renderNeedsChips(req.needs)}
                  </div>

                  {req.note && (
                    <div className="note">
                      <span className="note-title">{t.note}:</span>
                      <span className="note-text">{req.note}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="right">
                <span className={`status ${statusClass}`}>{statusLabel(req.status)}</span>

                <button className="action disabled" title="Coming soon" disabled>
                  <Lock size={14} /> {language === 'he' ? 'בחירת חדר בפועל' : 'Pick actual room'}
                </button>
              </div>
            </div>
          );
        }) : (
          <div className="no-data">{t.noData}</div>
        )}
      </div>

      <style>{`
        .priority-page { padding: 24px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; max-width: 680px; }

        .add-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 18px;
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: white; border: none; border-radius: 10px;
          font-family: inherit; cursor: pointer;
        }

        .controls { display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px; margin-bottom: 18px; }
        .search {
          display: flex; align-items: center; gap: 10px;
          background: white; border-radius: 12px; padding: 12px 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .search svg { color: #94a3b8; }
        .search input { border: none; outline: none; width: 100%; font-family: inherit; font-size: 14px; }

        .filters { display: flex; gap: 10px; justify-content: flex-end; }
        .filter {
          display: flex; align-items: center; gap: 8px;
          background: white; border-radius: 12px; padding: 10px 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .filter-label { font-size: 12px; color: #64748b; font-weight: 600; }
        select {
          border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px 10px;
          font-family: inherit; font-size: 13px; outline: none;
          background: #fff;
        }

        .priority-list { display: flex; flex-direction: column; gap: 12px; }

        .request-card {
          display: flex; justify-content: space-between; gap: 16px;
          background: white; padding: 18px; border-radius: 14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          border: 1px solid #eef2f7;
        }

        .request-card.pending { border-left: 5px solid #f59e0b; }
        .request-card.approved { border-left: 5px solid #10b981; }
        .request-card.rejected { border-left: 5px solid #ef4444; }

        .left { display: flex; gap: 14px; flex: 1; }
        .icon {
          width: 40px; height: 40px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          background: #fff7ed; color: #f59e0b;
          flex-shrink: 0;
        }

        .main { flex: 1; }

        .topline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .name { font-weight: 700; font-size: 16px; }
        .sid { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 3px 8px; border-radius: 999px; }

        .type-badge {
          font-size: 12px; font-weight: 700;
          background: #dbeafe; color: #2563eb;
          padding: 4px 10px; border-radius: 999px;
        }

        .locations { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
        .loc { display: flex; align-items: center; gap: 8px; color: #334155; flex-wrap: wrap; }
        .loc svg { color: #64748b; }
        .loc-title { font-weight: 700; color: #64748b; font-size: 13px; }
        .loc-value { font-size: 13px; }

        .availability {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-right: 8px;
          font-size: 12px;
          background: #f1f5f9;
          color: #334155;
          padding: 3px 10px;
          border-radius: 999px;
          font-weight: 600;
        }

        .needs { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .needs-title { font-weight: 700; color: #64748b; font-size: 13px; }

        .chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .chip {
          font-size: 12px; font-weight: 700;
          background: #fee2e2; color: #b91c1c;
          padding: 4px 10px; border-radius: 999px;
        }

        .note { display: flex; gap: 8px; align-items: baseline; }
        .note-title { font-weight: 700; color: #64748b; font-size: 13px; }
        .note-text { font-size: 13px; color: #334155; }

        .right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
        .status { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 800; }
        .status.pending { background: #fef3c7; color: #d97706; }
        .status.approved { background: #d1fae5; color: #059669; }
        .status.rejected { background: #fee2e2; color: #dc2626; }

        .action {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 12px; border-radius: 10px;
          border: 1px solid #e5e7eb; background: #f8fafc;
          cursor: not-allowed; opacity: 0.85;
          font-family: inherit;
        }

        .muted { color: #94a3b8; font-style: italic; font-size: 13px; }

        .no-data { text-align: center; color: #94a3b8; padding: 40px; background: white; border-radius: 14px; }
        .no-access { display: flex; justify-content: center; align-items: center; height: 400px; color: #94a3b8; }

        @media (max-width: 900px) {
          .controls { grid-template-columns: 1fr; }
          .filters { justify-content: flex-start; flex-wrap: wrap; }
          .right { align-items: flex-start; }
        }
      `}</style>
    </div>
  );
}

export default PriorityPage;
