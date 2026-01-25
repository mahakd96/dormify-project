import React, { useMemo, useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { transferRequests as transferRequestsSeed, students, rooms, buildings, regions } from '../data/mockData';
import { ArrowLeftRight, Check, X, Clock, Plus, MapPin, Home, History } from 'lucide-react';

function TransfersPage({ language }) {
  const { isCentralAdmin, getUserRegion, canApproveTransfer } = useAuth();
  const userRegion = getUserRegion();

  const [transferRequests, setTransferRequests] = useState(transferRequestsSeed);
  const [tab, setTab] = useState('room');
  const [filter, setFilter] = useState('pending');
  const [showHistory, setShowHistory] = useState(false);
  const [selectedToRoomByTransfer, setSelectedToRoomByTransfer] = useState({});

  // ✅ HARD GUARD: regional users can never stay on the "region" tab
  useEffect(() => {
    if (!isCentralAdmin() && tab !== 'room') setTab('room');
  }, [tab, isCentralAdmin]);

  const t = {
    he: {
      title: 'בקשות העברה',
      subtitle: 'ניהול בקשות העברת סטודנטים',
      roomTab: 'העברה בתוך/לאחר אישור',
      regionTab: 'העברה בין אזורים / שינוי סוג מעונות',
      newRequest: 'בקשה חדשה',
      all: 'הכל',
      pending: 'ממתין',
      approved: 'אושר',
      rejected: 'נדחה',
      from: 'מ',
      to: 'ל',
      reason: 'סיבה',
      approve: 'אשר',
      reject: 'דחה',
      noTransfers: 'אין בקשות מתאימות',
      chooseRoom: 'בחר/י חדר יעד',
      noOptions: 'אין חדרים פנויים מתאימים לפי התנאים',
      mustChooseRoom: 'כדי לאשר — חייבים לבחור חדר יעד מתאים',
      fromRegion: 'מאזור',
      toRegion: 'לאזור',
      showHistory: 'הצג היסטוריה',
      activeOnly: 'רק פתוחות',
      phaseHint:
        'בקשות בין אזורים/שינוי סוג מעונות מאושרות ע"י מנהל מרכזי. לאחר אישור נוצרת בקשת שיבוץ חדר (שלב 2) בתוך אזור היעד.',
      centralOnly: 'מאושר רק ע"י המנהל המרכזי',
      regionStaffOnly: 'מאושר ע"י צוות האזור (רק בתוך האזור שלו)',
      phase2Badge: 'שלב 2: שיבוץ באיזור יעד',
      internalBadge: 'העברה פנימית בתוך אזור',
      notAllowed: 'אין לך הרשאה לאשר בקשה זו',
    },
    en: {
      title: 'Transfer Requests',
      subtitle: 'Manage student transfers',
      roomTab: 'Room transfers',
      regionTab: 'Region / dorm-type change',
      newRequest: 'New Request',
      all: 'All',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      from: 'From',
      to: 'To',
      reason: 'Reason',
      approve: 'Approve',
      reject: 'Reject',
      noTransfers: 'No matching requests',
      chooseRoom: 'Select target room',
      noOptions: 'No matching available rooms based on constraints',
      mustChooseRoom: 'To approve — you must select a valid target room',
      fromRegion: 'From region',
      toRegion: 'To region',
      showHistory: 'Show history',
      activeOnly: 'Active only',
      phaseHint:
        'Region/dorm-type change is approved by central office. After approval, Phase 2 room assignment is created inside the target region.',
      centralOnly: 'Central office approval only',
      regionStaffOnly: 'Region staff approval (only within their region)',
      phase2Badge: 'Phase 2: assignment in target region',
      internalBadge: 'Internal move within region',
      notAllowed: 'You are not allowed to approve this request',
    }
  }[language];

  const inferRegionIdFromRoomId = (roomId) => {
    if (!roomId) return null;
    const sorted = [...regions].sort((a, b) => String(b.id).length - String(a.id).length);
    const match = sorted.find(r => roomId === r.id || roomId.startsWith(r.id + '-'));
    return match?.id ?? null;
  };

  const getStudent = (studentId) => students.find(s => s.id === studentId);
  const getBuilding = (buildingId) => buildings.find(b => b.id === buildingId);
  const getRegion = (regionId) => regions.find(r => r.id === regionId);

  const getRoomRegionId = (room) => {
    if (!room) return null;
    if (room.regionId) return room.regionId;
    const b = getBuilding(room.buildingId);
    if (b?.regionId) return b.regionId;
    return inferRegionIdFromRoomId(room.id);
  };

  const isRoomAvailable = (room) => {
    const occ = room.currentOccupancy ?? room.occupancy ?? 0;
    const cap = room.capacity ?? 1;
    return occ < cap;
  };

  const matchesStudentConstraints = (room, student, transfer) => {
    if (!room || !student) return false;

    const studentGender = student.gender;
    const allowedGender = room.allowedGender ?? room.gender ?? 'any';
    if (allowedGender !== 'any' && studentGender && allowedGender !== studentGender) return false;

    if (student.roomType && room.type && room.type !== student.roomType) return false;

    if (student.needsAccessibleRoom && room.isAccessible === false) return false;

    if (transfer?.requestedDormType && room.type && room.type !== transfer.requestedDormType) return false;
    if (transfer?.requestedDormGroup && room.dormGroup && room.dormGroup !== transfer.requestedDormGroup) return false;

    return true;
  };

  const getTransferType = (tr, student) => {
    if (tr.scope === 'REGION') return 'region';
    if (tr.scope === 'ROOM') return 'room';

    if (tr.type === 'region') return 'region';
    if (tr.type === 'room') return 'room';

    if (tr.requestedDormType || tr.requestedDormGroup || tr.requestedHousingType) return 'region';

    if (tr.toRegionId && tr.toRegionId !== student?.regionId) return 'region';

    return 'room';
  };

  const getRoomAssignmentMode = (transfer) => {
    if (transfer.parentTransferId || transfer.targetRegionId || transfer.toRegionId) return 'phase2';
    return 'internal';
  };

  const getEligibleTargetRooms = (transfer, student) => {
    const mode = getRoomAssignmentMode(transfer);
    const internalRegionId = inferRegionIdFromRoomId(transfer.fromRoomId);
    const phase2RegionId = transfer.targetRegionId || transfer.toRegionId || null;
    const baseRegionId = mode === 'phase2' ? phase2RegionId : internalRegionId;

    return rooms
      .filter(isRoomAvailable)
      .filter(r => getRoomRegionId(r) === baseRegionId)
      .filter(r => r.id !== transfer.fromRoomId)
      .filter(r => matchesStudentConstraints(r, student, transfer))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  const canSeeTransfer = (tr) => {
    const student = getStudent(tr.studentId);
    const type = getTransferType(tr, student);

    if (isCentralAdmin()) return true;

    // Regional boss: ONLY room transfers are visible (no region transfers at all)
    if (type !== 'room') return false;

    const mode = getRoomAssignmentMode(tr);
    if (mode !== 'internal') return false; // hide phase2 as well (optional but matches your ask)

    const fromRegion = inferRegionIdFromRoomId(tr.fromRoomId) ?? student?.regionId ?? null;
    return fromRegion === userRegion;
  };

  // ✅ Local permission logic
  const canApproveLocal = (tr) => {
    if (tr.status !== 'pending') return false;

    const student = getStudent(tr.studentId);
    const type = getTransferType(tr, student);

    if (isCentralAdmin()) {
      // central uses your existing auth policy
      return canApproveTransfer(tr);
    }

    // regional boss: can approve ONLY internal room transfers within their region
    if (type !== 'room') return false;

    const mode = getRoomAssignmentMode(tr);
    if (mode !== 'internal') return false;

    const fromRegion = inferRegionIdFromRoomId(tr.fromRoomId) ?? student?.regionId ?? null;
    return fromRegion === userRegion;
  };

  const filteredTransfers = useMemo(() => {
    return transferRequests.filter(tr => {
      const student = getStudent(tr.studentId);
      const type = getTransferType(tr, student);

      if (tab === 'region' && type !== 'region') return false;
      if (tab === 'room' && type !== 'room') return false;

      if (!canSeeTransfer(tr)) return false;

      const isHistory = tr.status === 'approved' || tr.status === 'rejected';
      if (!showHistory && isHistory) return false;

      if (filter !== 'all' && tr.status !== filter) return false;

      return true;
    });
  }, [transferRequests, tab, filter, showHistory, userRegion, isCentralAdmin]);

  const countByStatus = (status) => {
    return transferRequests.filter(tr => {
      const student = getStudent(tr.studentId);
      const type = getTransferType(tr, student);

      if (tab === 'region' && type !== 'region') return false;
      if (tab === 'room' && type !== 'room') return false;

      if (!canSeeTransfer(tr)) return false;

      const isHistory = tr.status === 'approved' || tr.status === 'rejected';
      if (!showHistory && isHistory) return false;

      if (status === 'all') return true;
      return tr.status === status;
    }).length;
  };

  const approveTransfer = (transfer) => {
    const student = getStudent(transfer.studentId);
    const type = getTransferType(transfer, student);

    if (!canApproveLocal(transfer)) {
      alert(t.notAllowed);
      return;
    }

    // Central admin region approvals (kept as-is)
    if (type === 'region') {
      const targetRegionId = transfer.toRegionId || transfer.targetRegionId || null;

      const phase2 = targetRegionId
        ? {
            id: `transfer-room-${Date.now()}`,
            studentId: transfer.studentId,
            fromRoomId: transfer.fromRoomId,
            toRoomId: null,
            reason: `${transfer.reason} (${language === 'he' ? 'שלב 2: שיבוץ חדר' : 'Phase 2: room assignment'})`,
            status: 'pending',
            requestedBy: transfer.requestedBy,
            requestedAt: new Date().toISOString(),
            reviewedBy: 'central-office',
            reviewedAt: new Date().toISOString(),
            scope: 'ROOM',
            targetRegionId,
            parentTransferId: transfer.id,
            requestedDormType: transfer.requestedDormType ?? null,
            requestedDormGroup: transfer.requestedDormGroup ?? null
          }
        : null;

      setTransferRequests(prev => {
        const updated = prev.map(p =>
          p.id === transfer.id
            ? {
                ...p,
                status: 'approved',
                reviewedBy: 'central-office',
                reviewedAt: new Date().toISOString(),
                scope: 'REGION'
              }
            : p
        );
        return phase2 ? [...updated, phase2] : updated;
      });

      return;
    }

    // Room transfer approval (regional or central)
    const selectedTo = selectedToRoomByTransfer[transfer.id];
    if (!selectedTo) {
      alert(t.mustChooseRoom);
      return;
    }

    setTransferRequests(prev =>
      prev.map(p =>
        p.id === transfer.id
          ? {
              ...p,
              toRoomId: selectedTo,
              status: 'approved',
              reviewedBy: isCentralAdmin() ? 'central-office' : 'region-staff',
              reviewedAt: new Date().toISOString(),
              scope: 'ROOM'
            }
          : p
      )
    );
  };

  const rejectTransfer = (transfer) => {
    const student = getStudent(transfer.studentId);
    const type = getTransferType(transfer, student);

    if (!canApproveLocal(transfer)) {
      alert(t.notAllowed);
      return;
    }

    setTransferRequests(prev =>
      prev.map(p =>
        p.id === transfer.id
          ? {
              ...p,
              status: 'rejected',
              reviewedBy: type === 'region' ? 'central-office' : (isCentralAdmin() ? 'central-office' : 'region-staff'),
              reviewedAt: new Date().toISOString(),
              scope: type === 'region' ? 'REGION' : 'ROOM'
            }
          : p
      )
    );
  };

  const getStatusBadge = (status) => {
    const config = {
      pending: { bg: '#fef3c7', color: '#d97706', icon: Clock, label: t.pending },
      approved: { bg: '#d1fae5', color: '#059669', icon: Check, label: t.approved },
      rejected: { bg: '#fee2e2', color: '#dc2626', icon: X, label: t.rejected },
    };
    const c = config[status];
    return (
      <span className="status-badge" style={{ background: c.bg, color: c.color }}>
        <c.icon size={14} /> {c.label}
      </span>
    );
  };

  const getRoomModeBadge = (transfer) => {
    const mode = getRoomAssignmentMode(transfer);
    return (
      <span className="mode-badge">
        {mode === 'phase2' ? t.phase2Badge : t.internalBadge}
      </span>
    );
  };

  const getApproveTooltip = (transfer) => {
    const student = getStudent(transfer.studentId);
    const type = getTransferType(transfer, student);

    if (isCentralAdmin()) {
      return type === 'region' ? t.centralOnly : '';
    }

    // regional users can only approve internal room transfers
    return t.regionStaffOnly;
  };

  return (
    <div className="transfers-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <button className="new-btn" onClick={() => {}}>
          <Plus size={18} /> {t.newRequest}
        </button>
      </div>

      <div className="tabs-bar">
        <div className="tabs">
          <button className={`tab ${tab === 'room' ? 'active' : ''}`} onClick={() => setTab('room')}>
            <Home size={16} /> {t.roomTab}
          </button>

          {/* ✅ Region tab exists ONLY for central admin */}
          {isCentralAdmin() && (
            <button className={`tab ${tab === 'region' ? 'active' : ''}`} onClick={() => setTab('region')}>
              <MapPin size={16} /> {t.regionTab}
            </button>
          )}
        </div>

        <button className="history-toggle" onClick={() => setShowHistory(v => !v)}>
          <History size={16} />
          {showHistory ? t.showHistory : t.activeOnly}
        </button>
      </div>

      <div className="filters-bar">
        <div className="filter-tabs">
          {['all', 'pending', 'approved', 'rejected'].map(status => (
            <button
              key={status}
              className={`filter-tab ${filter === status ? 'active' : ''}`}
              onClick={() => setFilter(status)}
            >
              {t[status]}
              <span className="count">{countByStatus(status)}</span>
            </button>
          ))}
        </div>
      </div>

      {isCentralAdmin() && tab === 'region' && <div className="phase-hint">{t.phaseHint}</div>}

      <div className="transfers-list">
        {filteredTransfers.length > 0 ? (
          filteredTransfers.map(transfer => {
            const student = getStudent(transfer.studentId);
            const type = getTransferType(transfer, student);

            const fromRegionId = inferRegionIdFromRoomId(transfer.fromRoomId) ?? student?.regionId ?? null;
            const fromRegion = getRegion(fromRegionId);

            const toRegion = (transfer.toRegionId || transfer.targetRegionId)
              ? getRegion(transfer.toRegionId || transfer.targetRegionId)
              : null;

            const eligibleRooms = type === 'room' ? getEligibleTargetRooms(transfer, student) : [];
            const selectedToRoom = selectedToRoomByTransfer[transfer.id] ?? '';

            const canApprove = canApproveLocal(transfer);
            const approveTooltip = canApprove ? '' : getApproveTooltip(transfer);

            return (
              <div key={transfer.id} className={`transfer-card ${transfer.status}`}>
                <div className="transfer-header">
                  <div className="student-info">
                    <div className="avatar">{student?.firstName?.[0] ?? '?'}</div>
                    <div>
                      <span className="name">{student?.firstName} {student?.lastName}</span>
                      <span className="id">{student?.studentId}</span>
                    </div>
                  </div>
                  {getStatusBadge(transfer.status)}
                </div>

                {type === 'room' && (
                  <div className="meta-row">
                    {getRoomModeBadge(transfer)}
                  </div>
                )}

                <div className="transfer-details">
                  {type === 'region' ? (
                    <div className="region-row">
                      <div className="location">
                        <span className="label">{t.fromRegion}</span>
                        <span className="value">{fromRegion?.name ?? fromRegionId ?? '-'}</span>
                      </div>
                      <ArrowLeftRight size={20} />
                      <div className="location">
                        <span className="label">{t.toRegion}</span>
                        <span className="value">{toRegion?.name ?? transfer.toRegionId ?? transfer.targetRegionId ?? '-'}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="transfer-route">
                      <div className="location">
                        <span className="label">{t.from}</span>
                        <span className="value">{transfer.fromRoomId}</span>
                      </div>
                      <ArrowLeftRight size={20} />
                      <div className="location">
                        <span className="label">{t.to}</span>

                        {transfer.status === 'pending' && canApprove ? (
                          eligibleRooms.length > 0 ? (
                            <select
                              className="room-select"
                              value={selectedToRoom}
                              onChange={(e) =>
                                setSelectedToRoomByTransfer(prev => ({
                                  ...prev,
                                  [transfer.id]: e.target.value
                                }))
                              }
                            >
                              <option value="">{t.chooseRoom}</option>
                              {eligibleRooms.map(r => (
                                <option key={r.id} value={r.id}>{r.id}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="no-options">{t.noOptions}</div>
                          )
                        ) : (
                          <span className="value">{transfer.toRoomId ?? '-'}</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="reason">
                    <span className="label">{t.reason}:</span>
                    <span className="value">{transfer.reason}</span>
                  </div>
                </div>

                {transfer.status === 'pending' && (
                  <div className="transfer-actions">
                    <button
                      className="action-btn approve"
                      onClick={() => approveTransfer(transfer)}
                      disabled={!canApprove}
                      title={approveTooltip}
                    >
                      <Check size={16} /> {t.approve}
                    </button>

                    <button
                      className="action-btn reject"
                      onClick={() => rejectTransfer(transfer)}
                      disabled={!canApprove}
                      title={approveTooltip}
                    >
                      <X size={16} /> {t.reject}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="no-transfers">
            <ArrowLeftRight size={48} />
            <p>{t.noTransfers}</p>
          </div>
        )}
      </div>

      <style>{`
        .transfers-page { padding: 24px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
        .page-header h1 { font-size: 24px; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.2px; }
        .page-header p { color: #64748b; }

        .new-btn {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 20px;
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          color: white; border: none; border-radius: 10px;
          font-size: 14px; font-weight: 700; font-family: inherit;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(37,99,235,0.18);
        }

        .tabs-bar{
          display:flex; justify-content:space-between; align-items:center;
          margin-bottom: 14px;
        }
        .tabs{
          display:flex; gap:10px;
          background:white; padding:6px; border-radius:14px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .tab{
          display:flex; align-items:center; gap:8px;
          padding:10px 14px;
          border:none; background:none;
          border-radius:12px;
          font-weight:800; font-size:13px;
          cursor:pointer; color:#0f172a;
        }
        .tab:hover{ background:#f1f5f9; }
        .tab.active{ background:#2563eb; color:white; }

        .history-toggle{
          display:flex; align-items:center; gap:8px;
          padding:10px 12px;
          border-radius:12px;
          border:1px solid rgba(15,23,42,0.10);
          background:white;
          font-weight:800; font-size:13px;
          cursor:pointer;
          color:#0f172a;
        }
        .history-toggle:hover{ background:#f8fafc; }

        .filters-bar { margin-bottom: 14px; }
        .filter-tabs {
          display: flex; gap: 8px; background: white; padding: 6px; border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        .filter-tab {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 16px;
          background: none; border: none; border-radius: 10px;
          font-size: 14px; font-family: inherit;
          cursor: pointer; transition: all 0.2s;
          color: #0f172a; font-weight: 700;
        }
        .filter-tab:hover { background: #f1f5f9; }
        .filter-tab.active { background: #2563eb; color: white; }

        .filter-tab .count {
          background: rgba(15, 23, 42, 0.10);
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
        }
        .filter-tab.active .count { background: rgba(255,255,255,0.22); }

        .phase-hint{
          margin: 10px 0 16px 0;
          padding: 12px 14px;
          background: #f8fafc;
          border: 1px solid rgba(15,23,42,0.06);
          border-radius: 12px;
          color:#475569;
          font-weight: 700;
          font-size: 13px;
        }

        .transfers-list { display: flex; flex-direction: column; gap: 16px; }

        .transfer-card {
          background: white; border-radius: 16px; padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          border-right: 4px solid transparent;
        }
        [dir="ltr"] .transfer-card { border-right: none; border-left: 4px solid transparent; }
        .transfer-card.pending { border-color: #f59e0b; }
        .transfer-card.approved { border-color: #10b981; }
        .transfer-card.rejected { border-color: #ef4444; }

        .transfer-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 12px;
        }
        .student-info { display: flex; align-items: center; gap: 12px; }

        .avatar {
          width: 40px; height: 40px;
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          color: white; font-weight: 900;
        }
        .student-info .name { display:block; font-weight: 900; }
        .student-info .id { font-size: 12px; color: #64748b; font-family: monospace; }

        .status-badge {
          display: flex; align-items: center; gap: 6px;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 900;
          white-space: nowrap;
        }

        .meta-row { margin: -2px 0 10px 0; }
        .mode-badge{
          display:inline-block;
          padding: 6px 10px;
          border-radius: 999px;
          background: #f1f5f9;
          color:#0f172a;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid rgba(15,23,42,0.06);
        }

        .transfer-details {
          background: #f8fafc;
          padding: 16px;
          border-radius: 12px;
          border: 1px solid rgba(15,23,42,0.06);
          margin-bottom: 16px;
        }

        .transfer-route, .region-row {
          display:flex; align-items:center; justify-content:center;
          gap: 18px;
          margin-bottom: 12px;
        }

        .location { text-align:center; min-width: 160px; }
        .location .label { display:block; font-size: 12px; color:#64748b; margin-bottom: 4px; font-weight: 900; }
        .location .value { font-weight: 900; font-size: 13px; color:#0f172a; }

        .room-select{
          width: 240px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(15,23,42,0.12);
          background: white;
          font-size: 13px;
          font-weight: 900;
          outline: none;
        }
        .room-select:focus{
          border-color: rgba(37,99,235,0.55);
          box-shadow: 0 0 0 4px rgba(37,99,235,0.12);
        }

        .no-options{
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px dashed rgba(239,68,68,0.45);
          background: rgba(239,68,68,0.06);
          color: #b91c1c;
          font-size: 12.5px;
          font-weight: 900;
        }

        .reason { text-align:center; }
        .reason .label { color:#64748b; font-size:13px; font-weight: 900; }
        .reason .value { font-size:13px; font-weight: 800; color:#0f172a; }

        .transfer-actions { display:flex; gap: 12px; }

        .action-btn {
          flex:1;
          display:flex; align-items:center; justify-content:center; gap: 8px;
          padding: 10px;
          border:none; border-radius: 12px;
          font-size: 14px; font-weight: 900;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }
        .action-btn:disabled{
          opacity:0.45;
          cursor:not-allowed;
        }

        .action-btn.approve { background:#d1fae5; color:#059669; }
        .action-btn.approve:hover:not(:disabled) { background:#059669; color:white; }

        .action-btn.reject { background:#fee2e2; color:#dc2626; }
        .action-btn.reject:hover:not(:disabled) { background:#dc2626; color:white; }

        .no-transfers {
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          padding: 60px;
          color:#94a3b8;
          gap: 16px;
          background:white;
          border-radius:16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
      `}</style>
    </div>
  );
}

export default TransfersPage;
