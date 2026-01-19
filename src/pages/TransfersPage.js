import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { transferRequests as transferRequestsSeed, students, rooms, buildings, regions } from '../data/mockData';
import { ArrowLeftRight, Check, X, Clock, Plus, MapPin, Home, History } from 'lucide-react';

function TransfersPage({ language }) {
  const { isCentralAdmin, getUserRegion, canApproveTransfers } = useAuth();
  const userRegion = getUserRegion();

  // ✅ stateful list (so "approve" really updates UI)
  const [transferRequests, setTransferRequests] = useState(transferRequestsSeed);

  // ✅ two "pages" inside this page
  const [tab, setTab] = useState('room'); // 'room' | 'region'
  const [filter, setFilter] = useState('pending'); // organized queue
  const [showHistory, setShowHistory] = useState(false);

  // ✅ for room approvals: chosen target room per transfer
  const [selectedToRoomByTransfer, setSelectedToRoomByTransfer] = useState({});

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
      regionStaffOnly: 'מאושר ע"י צוות האזור',
      phase2Badge: 'שלב 2: שיבוץ באיזור יעד',
      internalBadge: 'העברה פנימית בתוך אזור',
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
      regionStaffOnly: 'Region staff approval',
      phase2Badge: 'Phase 2: assignment in target region',
      internalBadge: 'Internal move within region',
    }
  }[language];

  // =====================================================
  // Robust region inference (prevents "wrong region list")
  // =====================================================
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

  // =========================
  // Availability + Constraints
  // =========================
  const isRoomAvailable = (room) => {
    const occ = room.currentOccupancy ?? room.occupancy ?? 0;
    const cap = room.capacity ?? 1;
    return occ < cap;
  };

  /**
   * ✅ Constraint matcher
   * NOTE: extend here to include dorm-type request constraints.
   * - internal room move: usually matches student constraints
   * - phase2 assignment: may require requestedDormType / requestedDormGroup
   */
  const matchesStudentConstraints = (room, student, transfer) => {
    if (!room || !student) return false;

    // Gender constraint
    const studentGender = student.gender; // 'female' | 'male'
    const allowedGender = room.allowedGender ?? room.gender ?? 'any';
    if (allowedGender !== 'any' && studentGender && allowedGender !== studentGender) return false;

    // Base room type constraint from student (optional)
    if (student.roomType && room.type && room.type !== student.roomType) return false;

    // Accessibility
    if (student.needsAccessibleRoom && room.isAccessible === false) return false;

    // ✅ If Phase2 created due to dorm-type change request, enforce requested type if provided
    // Example fields you might set: transfer.requestedDormType / transfer.requestedDormGroup
    if (transfer?.requestedDormType && room.type && room.type !== transfer.requestedDormType) return false;

    // If you have dormGroup property on room (optional)
    if (transfer?.requestedDormGroup && room.dormGroup && room.dormGroup !== transfer.requestedDormGroup) return false;

    return true;
  };

  // =========================
  // Transfer Classification
  // =========================
  const getTransferType = (tr, student) => {
    if (tr.scope === 'REGION') return 'region';
    if (tr.scope === 'ROOM') return 'room';

    if (tr.type === 'region') return 'region';
    if (tr.type === 'room') return 'room';

    // dorm-type/group change must be REGION (central)
    if (tr.requestedDormType || tr.requestedDormGroup || tr.requestedHousingType) return 'region';

    if (tr.toRegionId && tr.toRegionId !== student?.regionId) return 'region';

    return 'room';
  };

  // =========================
  // ✅ KEY FIX: Separate internal vs phase2 room assignment
  // =========================
  const getRoomAssignmentMode = (transfer) => {
    // Phase 2 created after central approval (or explicitly targeted to a region)
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
      .filter(r => getRoomRegionId(r) === baseRegionId)          // ✅ correct region per mode
      .filter(r => r.id !== transfer.fromRoomId)
      .filter(r => matchesStudentConstraints(r, student, transfer))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };

  // =========================
  // Permissions
  // =========================
  const canActOnRegionTransfer = () => isCentralAdmin();
  const canActOnRoomTransfer = () => canApproveTransfers();

  // =========================
  // Filtering (tabs + queue)
  // =========================
  const filteredTransfers = useMemo(() => {
    return transferRequests.filter(tr => {
      const student = getStudent(tr.studentId);
      const type = getTransferType(tr, student);

      if (tab === 'region' && type !== 'region') return false;
      if (tab === 'room' && type !== 'room') return false;

      // visibility rules
      if (!isCentralAdmin()) {
        if (type === 'room') {
          // For internal room transfers: only own region OR phase2 targeted to user's region
          const mode = getRoomAssignmentMode(tr);
          if (mode === 'internal' && student?.regionId !== userRegion) return false;
          if (mode === 'phase2') {
            const target = tr.targetRegionId || tr.toRegionId;
            if (target && target !== userRegion) return false;
          }
        }

        // For region transfers: optional view only if originated from own region
        if (type === 'region' && student?.regionId !== userRegion) return false;
      }

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

      if (!isCentralAdmin()) {
        if (type === 'room') {
          const mode = getRoomAssignmentMode(tr);
          if (mode === 'internal' && student?.regionId !== userRegion) return false;
          if (mode === 'phase2') {
            const target = tr.targetRegionId || tr.toRegionId;
            if (target && target !== userRegion) return false;
          }
        }
        if (type === 'region' && student?.regionId !== userRegion) return false;
      }

      const isHistory = tr.status === 'approved' || tr.status === 'rejected';
      if (!showHistory && isHistory) return false;

      if (status === 'all') return true;
      return tr.status === status;
    }).length;
  };

  // =========================
  // Actions (stateful)
  // =========================
  const approveTransfer = (transfer) => {
    const student = getStudent(transfer.studentId);
    const type = getTransferType(transfer, student);

    if (type === 'region') {
      if (!canActOnRegionTransfer()) return;

      // ✅ Phase 1 approval
      // ✅ Always create phase2 room assignment into target region (if provided)
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
            // ✅ critical fields for Phase2 filtering
            targetRegionId,
            parentTransferId: transfer.id,
            // pass dorm-type request to phase2 if exists
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

    // room transfer approval
    if (!canActOnRoomTransfer()) return;

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
              reviewedBy: 'region-staff',
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

    if (type === 'region' && !canActOnRegionTransfer()) return;
    if (type === 'room' && !canActOnRoomTransfer()) return;

    setTransferRequests(prev =>
      prev.map(p =>
        p.id === transfer.id
          ? {
              ...p,
              status: 'rejected',
              reviewedBy: type === 'region' ? 'central-office' : 'region-staff',
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

  // small label in card: internal vs phase2
  const getRoomModeBadge = (transfer) => {
    const mode = getRoomAssignmentMode(transfer);
    return (
      <span className="mode-badge">
        {mode === 'phase2' ? t.phase2Badge : t.internalBadge}
      </span>
    );
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
          <button className={`tab ${tab === 'region' ? 'active' : ''}`} onClick={() => setTab('region')}>
            <MapPin size={16} /> {t.regionTab}
          </button>
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

      {tab === 'region' && <div className="phase-hint">{t.phaseHint}</div>}

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

            const canApprove = type === 'region' ? canActOnRegionTransfer() : canActOnRoomTransfer();
            const approveTooltip =
              type === 'region' ? (canApprove ? '' : t.centralOnly) : (canApprove ? '' : t.regionStaffOnly);

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
