import React, { useEffect, useMemo, useState } from 'react';
import { transfersAPI } from '../services/api';
import {
  ArrowLeftRight,
  Check,
  X,
  Clock,
  Plus,
  User,
  Home,
  Calendar,
} from 'lucide-react';

function TransfersPage({ language }) {
  const [transferRequests, setTransferRequests] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [showHistory, setShowHistory] = useState(false);
  const [showNewRequestModal, setShowNewRequestModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const t = {
    he: {
      title: 'בקשות העברה',
      subtitle: 'ניהול בקשות העברת סטודנטים',
      newRequest: 'בקשה חדשה',
      newRequestTitle: 'בקשה חדשה',
      newRequestComingSoon: 'טופס יצירת בקשת מעבר יחובר בשלב הבא.',
      close: 'סגור',
      all: 'הכל',
      pending: 'ממתין',
      approved: 'אושר',
      rejected: 'נדחה',
      from: 'מ',
      to: 'ל',
      reason: 'סיבה',
      requestedBy: 'נוצר על ידי',
      reviewedBy: 'נבדק על ידי',
      reviewedAt: 'תאריך בדיקה',
      createdAt: 'תאריך יצירה',
      noTransfers: 'אין בקשות מתאימות',
      loading: 'טוען בקשות מעבר...',
      error: 'שגיאה בטעינת בקשות מעבר',
      studentId: 'ת.ז',
      status: 'סטטוס',
      activeOnly: 'רק פתוחות',
      showHistory: 'הצג היסטוריה',
      transferRequest: 'בקשת מעבר',
      notReviewed: 'טרם נבדק',
      noRoom: 'לא צוין חדר',
      approve: 'אשר',
      reject: 'דחה',
      actionsComingSoon: 'אישור ודחייה יחוברו בשלב הבא',
    },
    en: {
      title: 'Transfer Requests',
      subtitle: 'Manage student transfers',
      newRequest: 'New Request',
      newRequestTitle: 'New Request',
      newRequestComingSoon: 'The new transfer request form will be connected in the next step.',
      close: 'Close',
      all: 'All',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
      from: 'From',
      to: 'To',
      reason: 'Reason',
      requestedBy: 'Requested by',
      reviewedBy: 'Reviewed by',
      reviewedAt: 'Reviewed at',
      createdAt: 'Created at',
      noTransfers: 'No matching requests',
      loading: 'Loading transfer requests...',
      error: 'Failed to load transfer requests',
      studentId: 'ID',
      status: 'Status',
      activeOnly: 'Active only',
      showHistory: 'Show history',
      transferRequest: 'Transfer request',
      notReviewed: 'Not reviewed yet',
      noRoom: 'No room specified',
      approve: 'Approve',
      reject: 'Reject',
      actionsComingSoon: 'Approve/reject will be connected in the next step',
    },
  }[language] || {};

  useEffect(() => {
    const fetchTransfers = async () => {
      try {
        setLoading(true);
        setError('');

        const data = await transfersAPI.getAll();

        if (Array.isArray(data)) {
          setTransferRequests(data);
        } else if (Array.isArray(data.results)) {
          setTransferRequests(data.results);
        } else {
          setTransferRequests([]);
        }
      } catch (err) {
        setError(err.message || 'Failed to load transfer requests');
      } finally {
        setLoading(false);
      }
    };

    fetchTransfers();
  }, []);

  const filteredTransfers = useMemo(() => {
    return transferRequests.filter((transfer) => {
      const isHistory =
        transfer.status === 'approved' || transfer.status === 'rejected';

      if (!showHistory && isHistory) {
        return false;
      }

      if (filter !== 'all' && transfer.status !== filter) {
        return false;
      }

      return true;
    });
  }, [transferRequests, filter, showHistory]);

  const countByStatus = (status) => {
    return transferRequests.filter((transfer) => {
      const isHistory =
        transfer.status === 'approved' || transfer.status === 'rejected';

      if (!showHistory && isHistory) {
        return false;
      }

      if (status === 'all') {
        return true;
      }

      return transfer.status === status;
    }).length;
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return '-';

    try {
      return new Date(dateValue).toLocaleString(language === 'he' ? 'he-IL' : 'en-US');
    } catch {
      return dateValue;
    }
  };

  const getStudentInitial = (transfer) => {
    const name = transfer.student_name || '';
    return name ? name[0] : '?';
  };

  const getStatusBadge = (status, statusDisplay) => {
    const config = {
      pending: {
        bg: '#fef3c7',
        color: '#d97706',
        icon: Clock,
        label: statusDisplay || t.pending,
      },
      approved: {
        bg: '#d1fae5',
        color: '#059669',
        icon: Check,
        label: statusDisplay || t.approved,
      },
      rejected: {
        bg: '#fee2e2',
        color: '#dc2626',
        icon: X,
        label: statusDisplay || t.rejected,
      },
    };

    const current = config[status] || config.pending;
    const Icon = current.icon;

    return (
      <span
        className="status-badge"
        style={{ background: current.bg, color: current.color }}
      >
        <Icon size={14} />
        {current.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="transfers-page">
        <div className="page-header">
          <div>
            <h1>{t.title}</h1>
            <p>{t.loading}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="transfers-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>

        <button className="new-btn" onClick={() => setShowNewRequestModal(true)}>
          <Plus size={18} />
          {t.newRequest}
        </button>
      </div>

      {error && (
        <div className="error-box">
          {error}
        </div>
      )}

      <div className="top-controls">
        <div className="filter-tabs">
          {['all', 'pending', 'approved', 'rejected'].map((status) => (
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

        <button
          className="history-toggle"
          onClick={() => setShowHistory((value) => !value)}
        >
          {showHistory ? t.activeOnly : t.showHistory}
        </button>
      </div>

      <div className="summary-row">
        <span>
          {filteredTransfers.length} {t.transferRequest}
          {filteredTransfers.length === 1 ? '' : language === 'he' ? 'ות' : 's'}
        </span>
      </div>

      <div className="transfers-list">
        {filteredTransfers.length > 0 ? (
          filteredTransfers.map((transfer) => (
            <div key={transfer.id} className={`transfer-card ${transfer.status}`}>
              <div className="transfer-header">
                <div className="student-info">
                  <div className="avatar">{getStudentInitial(transfer)}</div>

                  <div>
                    <span className="name">
                      {transfer.student_name || '-'}
                    </span>

                    <span className="id">
                      {t.studentId}: {transfer.student_id_number || '-'}
                    </span>
                  </div>
                </div>

                {getStatusBadge(transfer.status, transfer.status_display)}
              </div>

              <div className="transfer-details">
                <div className="transfer-route">
                  <div className="location">
                    <span className="label">{t.from}</span>
                    <span className="value">
                      <Home size={15} />
                      {transfer.from_room_name || transfer.from_room || t.noRoom}
                    </span>
                  </div>

                  <ArrowLeftRight size={22} />

                  <div className="location">
                    <span className="label">{t.to}</span>
                    <span className="value">
                      <Home size={15} />
                      {transfer.to_room_name || transfer.to_room || t.noRoom}
                    </span>
                  </div>
                </div>

                <div className="reason">
                  <span className="label">{t.reason}:</span>
                  <span className="value">{transfer.reason || '-'}</span>
                </div>
              </div>

              <div className="meta-grid">
                <div className="meta-item">
                  <User size={15} />
                  <div>
                    <span className="meta-label">{t.requestedBy}</span>
                    <span className="meta-value">
                      {transfer.requested_by_name || '-'}
                    </span>
                  </div>
                </div>

                <div className="meta-item">
                  <User size={15} />
                  <div>
                    <span className="meta-label">{t.reviewedBy}</span>
                    <span className="meta-value">
                      {transfer.reviewed_by_name || t.notReviewed}
                    </span>
                  </div>
                </div>

                <div className="meta-item">
                  <Calendar size={15} />
                  <div>
                    <span className="meta-label">{t.createdAt}</span>
                    <span className="meta-value">
                      {formatDate(transfer.created_at)}
                    </span>
                  </div>
                </div>

                <div className="meta-item">
                  <Calendar size={15} />
                  <div>
                    <span className="meta-label">{t.reviewedAt}</span>
                    <span className="meta-value">
                      {formatDate(transfer.reviewed_at)}
                    </span>
                  </div>
                </div>
              </div>

              {transfer.status === 'pending' && (
                <div className="transfer-actions">
                  <button
                    className="action-btn approve"
                    disabled
                    title={t.actionsComingSoon}
                  >
                    <Check size={16} />
                    {t.approve}
                  </button>

                  <button
                    className="action-btn reject"
                    disabled
                    title={t.actionsComingSoon}
                  >
                    <X size={16} />
                    {t.reject}
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="no-transfers">
            <ArrowLeftRight size={48} />
            <p>{t.noTransfers}</p>
          </div>
        )}
      </div>

      {showNewRequestModal && (
        <div className="modal-overlay" onClick={() => setShowNewRequestModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t.newRequestTitle}</h3>
              <button onClick={() => setShowNewRequestModal(false)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <p>{t.newRequestComingSoon}</p>

              <button
                className="modal-close-btn"
                onClick={() => setShowNewRequestModal(false)}
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .transfers-page {
          padding: 24px;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 18px;
        }

        .page-header h1 {
          font-size: 24px;
          font-weight: 800;
          margin-bottom: 4px;
          letter-spacing: -0.2px;
        }

        .page-header p {
          color: #64748b;
        }

        .new-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 6px 18px rgba(37,99,235,0.18);
        }

        .error-box {
          background: #fee2e2;
          color: #b91c1c;
          border: 1px solid #fecaca;
          border-radius: 12px;
          padding: 12px 16px;
          margin-bottom: 16px;
          font-weight: 700;
        }

        .top-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          margin-bottom: 14px;
          flex-wrap: wrap;
        }

        .filter-tabs {
          display: flex;
          gap: 8px;
          background: white;
          padding: 6px;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        .filter-tab {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: none;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
          color: #0f172a;
          font-weight: 700;
        }

        .filter-tab:hover {
          background: #f1f5f9;
        }

        .filter-tab.active {
          background: #2563eb;
          color: white;
        }

        .filter-tab .count {
          background: rgba(15, 23, 42, 0.10);
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
        }

        .filter-tab.active .count {
          background: rgba(255,255,255,0.22);
        }

        .history-toggle {
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(15,23,42,0.10);
          background: white;
          font-weight: 800;
          font-size: 13px;
          cursor: pointer;
          color: #0f172a;
          font-family: inherit;
        }

        .history-toggle:hover {
          background: #f8fafc;
        }

        .summary-row {
          margin-bottom: 14px;
          color: #64748b;
          font-weight: 700;
          font-size: 13px;
        }

        .transfers-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .transfer-card {
          background: white;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          border-right: 4px solid transparent;
        }

        [dir="ltr"] .transfer-card {
          border-right: none;
          border-left: 4px solid transparent;
        }

        .transfer-card.pending {
          border-color: #f59e0b;
        }

        .transfer-card.approved {
          border-color: #10b981;
        }

        .transfer-card.rejected {
          border-color: #ef4444;
        }

        .transfer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
        }

        .student-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .avatar {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 900;
        }

        .student-info .name {
          display: block;
          font-weight: 900;
        }

        .student-info .id {
          font-size: 12px;
          color: #64748b;
          font-family: monospace;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 13px;
          font-weight: 900;
          white-space: nowrap;
        }

        .transfer-details {
          background: #f8fafc;
          padding: 16px;
          border-radius: 12px;
          border: 1px solid rgba(15,23,42,0.06);
          margin-bottom: 16px;
        }

        .transfer-route {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          margin-bottom: 12px;
        }

        .location {
          text-align: center;
          min-width: 160px;
        }

        .location .label {
          display: block;
          font-size: 12px;
          color: #64748b;
          margin-bottom: 4px;
          font-weight: 900;
        }

        .location .value {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-weight: 900;
          font-size: 13px;
          color: #0f172a;
        }

        .reason {
          text-align: center;
        }

        .reason .label {
          color: #64748b;
          font-size: 13px;
          font-weight: 900;
          margin-inline-end: 4px;
        }

        .reason .value {
          font-size: 13px;
          font-weight: 800;
          color: #0f172a;
        }

        .meta-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
        }

        .meta-item {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          background: #f8fafc;
          border: 1px solid rgba(15,23,42,0.06);
          padding: 10px;
          border-radius: 12px;
          color: #334155;
        }

        .meta-item svg {
          margin-top: 2px;
          color: #64748b;
          flex-shrink: 0;
        }

        .meta-label {
          display: block;
          font-size: 11px;
          color: #64748b;
          font-weight: 800;
          margin-bottom: 2px;
        }

        .meta-value {
          display: block;
          font-size: 12px;
          font-weight: 800;
          color: #0f172a;
          word-break: break-word;
        }

        .transfer-actions {
          display: flex;
          gap: 12px;
        }

        .action-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 10px;
          border: none;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 900;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }

        .action-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .action-btn.approve {
          background: #d1fae5;
          color: #059669;
        }

        .action-btn.reject {
          background: #fee2e2;
          color: #dc2626;
        }

        .no-transfers {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 60px;
          color: #94a3b8;
          gap: 16px;
          background: white;
          border-radius: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-content {
          background: white;
          border-radius: 16px;
          width: 90%;
          max-width: 480px;
          box-shadow: 0 20px 40px rgba(0,0,0,0.18);
          overflow: hidden;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #e5e7eb;
        }

        .modal-header h3 {
          font-size: 18px;
          font-weight: 900;
        }

        .modal-header button {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
        }

        .modal-body {
          padding: 20px;
          color: #334155;
          font-weight: 700;
        }

        .modal-close-btn {
          margin-top: 18px;
          width: 100%;
          padding: 10px 14px;
          border: none;
          border-radius: 12px;
          background: #2563eb;
          color: white;
          font-weight: 900;
          font-family: inherit;
          cursor: pointer;
        }

        @media (max-width: 900px) {
          .meta-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .transfer-route {
            flex-direction: column;
          }
        }

        @media (max-width: 600px) {
          .page-header {
            flex-direction: column;
            gap: 12px;
          }

          .filter-tabs {
            width: 100%;
            overflow-x: auto;
          }

          .meta-grid {
            grid-template-columns: 1fr;
          }

          .transfer-header {
            align-items: flex-start;
            gap: 12px;
            flex-direction: column;
          }
        }
      `}</style>
    </div>
  );
}

export default TransfersPage;