import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Users, Building2, Home, CheckCircle, Clock, ArrowLeftRight, Star, Upload, Activity } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../services/api';

function Dashboard({ language }) {
  const { user, isCentralAdmin } = useAuth();

  const [stats, setStats] = useState(null);
  const [transfers, setTransfers] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, transfersRes, batchesRes] = await Promise.all([
          api.get('/api/statistics/'),
          api.get('/api/transfers/?status=pending'),
          api.get('/api/batches/'),
        ]);
        setStats(statsRes.data);
        setTransfers(transfersRes.data?.results || transfersRes.data || []);
        setBatches(batchesRes.data?.batches || []);
      } catch (err) {
        console.error('Dashboard fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const t = {
    he: {
      title: 'לוח בקרה',
      welcome: `שלום, ${user?.name || user?.first_name || 'משתמש'}`,
      totalStudents: 'סה"כ סטודנטים',
      assignedStudents: 'סטודנטים משובצים',
      unassignedStudents: 'ממתינים לשיבוץ',
      priorityStudents: 'סטודנטים בעדיפות',
      totalBuildings: 'בניינים',
      totalRooms: 'חדרים',
      pendingTransfers: 'בקשות העברה ממתינות',
      occupancyRate: 'אחוז תפוסה',
      regionOverview: 'סקירת אזורים',
      recentTransfers: 'בקשות העברה אחרונות',
      recentActivity: 'פעילות אחרונה',
      noData: 'אין נתונים להצגה',
      studentAssigned: 'סטודנט שובץ',
      transferCreated: 'בקשת מעבר נוצרה',
      fileUploaded: 'קובץ הועלה',
      pending: 'ממתין',
      approved: 'אושר',
      rejected: 'נדחה',
    },
    en: {
      title: 'Dashboard',
      welcome: `Hello, ${user?.name || user?.first_name || 'User'}`,
      totalStudents: 'Total Students',
      assignedStudents: 'Assigned Students',
      unassignedStudents: 'Pending Assignment',
      priorityStudents: 'Priority Students',
      totalBuildings: 'Buildings',
      totalRooms: 'Rooms',
      pendingTransfers: 'Pending Transfers',
      occupancyRate: 'Occupancy Rate',
      regionOverview: 'Region Overview',
      recentTransfers: 'Recent Transfer Requests',
      recentActivity: 'Recent Activity',
      noData: 'No data to display',
      studentAssigned: 'Student assigned',
      transferCreated: 'Transfer request created',
      fileUploaded: 'File uploaded',
      pending: 'Pending',
      approved: 'Approved',
      rejected: 'Rejected',
    }
  }[language] || {};

  // Build recent activity from transfers + batches
  const buildActivity = () => {
    const activities = [];

    transfers.slice(0, 3).forEach(t => {
      activities.push({
        id: `t-${t.id}`,
        type: 'transfer',
        icon: ArrowLeftRight,
        color: '#f97316',
        bg: '#fed7aa',
        text: `${t.student?.first_name || ''} ${t.student?.last_name || ''} - ${language === 'he' ? 'בקשת מעבר' : 'Transfer request'}`,
        sub: t.reason || '',
        status: t.status,
        time: t.created_at,
      });
    });

    batches.slice(0, 2).forEach(b => {
      activities.push({
        id: `b-${b.id}`,
        type: 'upload',
        icon: Upload,
        color: '#3b82f6',
        bg: '#dbeafe',
        text: `${language === 'he' ? 'קובץ הועלה' : 'File uploaded'}: ${b.filename}`,
        sub: `${b.total_students} ${language === 'he' ? 'סטודנטים' : 'students'}`,
        status: b.status,
        time: b.created_at,
      });
    });

    return activities.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 5);
  };

  const activity = buildActivity();

  const getStatusLabel = (status) => {
    const map = { pending: t.pending, approved: t.approved, rejected: t.rejected, completed: t.approved };
    return map[status] || status;
  };

  const getStatusColor = (status) => {
    if (status === 'approved' || status === 'completed') return { bg: '#d1fae5', color: '#065f46' };
    if (status === 'rejected') return { bg: '#fee2e2', color: '#991b1b' };
    return { bg: '#fef3c7', color: '#92400e' };
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(language === 'he' ? 'he-IL' : 'en-US');
    } catch { return ''; }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
      <p style={{ color: '#64748b', fontSize: '16px' }}>טוען נתונים...</p>
    </div>
  );

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.welcome}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Users size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats?.total_students ?? 0}</span>
            <span className="stat-label">{t.totalStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats?.assigned_students ?? 0}</span>
            <span className="stat-label">{t.assignedStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon orange"><Clock size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats?.unassigned_students ?? 0}</span>
            <span className="stat-label">{t.unassignedStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow"><Star size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats?.priority_students ?? 0}</span>
            <span className="stat-label">{t.priorityStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple"><Building2 size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats?.total_buildings ?? 0}</span>
            <span className="stat-label">{t.totalBuildings}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon teal"><Home size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats?.total_rooms ?? 0}</span>
            <span className="stat-label">{t.totalRooms}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon red"><ArrowLeftRight size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats?.pending_transfers ?? 0}</span>
            <span className="stat-label">{t.pendingTransfers}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon gradient">
            <span className="big-percent">{stats?.occupancy_rate ?? 0}%</span>
          </div>
          <div className="stat-content">
            <span className="stat-label">{t.occupancyRate}</span>
          </div>
        </div>
      </div>

      {/* Bottom section - 2 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>

        {/* Recent Transfers */}
        <div className="chart-card">
          <h3>{t.recentTransfers}</h3>
          {transfers.length > 0 ? (
            <div className="transfers-list">
              {transfers.slice(0, 5).map(transfer => (
                <div key={transfer.id} className="transfer-item">
                  <div className="transfer-icon"><ArrowLeftRight size={16} /></div>
                  <div className="transfer-info">
                    <span className="student-name">
                      {transfer.student?.first_name} {transfer.student?.last_name}
                    </span>
                    <span className="transfer-details">{transfer.reason}</span>
                  </div>
                  <span className="transfer-status pending">{t.pending}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="no-data">{t.noData}</p>
          )}
        </div>

        {/* Recent Activity */}
        <div className="chart-card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} color="#3b82f6" />
            {t.recentActivity}
          </h3>
          {activity.length > 0 ? (
            <div className="transfers-list">
              {activity.map(item => (
                <div key={item.id} className="transfer-item">
                  <div className="transfer-icon" style={{ background: item.bg, color: item.color }}>
                    <item.icon size={16} />
                  </div>
                  <div className="transfer-info">
                    <span className="student-name">{item.text}</span>
                    <span className="transfer-details">{item.sub} · {formatTime(item.time)}</span>
                  </div>
                  {item.status && (
                    <span style={{
                      padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '500',
                      background: getStatusColor(item.status).bg,
                      color: getStatusColor(item.status).color,
                      whiteSpace: 'nowrap'
                    }}>
                      {getStatusLabel(item.status)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="no-data">{t.noData}</p>
          )}
        </div>
      </div>

      <style>{`
        .dashboard { padding: 24px; }
        .page-header { margin-bottom: 24px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .stat-card {
          background: white;
          border-radius: 16px;
          padding: 20px;
          display: flex;
          align-items: center;
          gap: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .stat-icon {
          width: 52px; height: 52px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }

        .stat-icon.blue { background: #dbeafe; color: #2563eb; }
        .stat-icon.green { background: #d1fae5; color: #059669; }
        .stat-icon.orange { background: #fed7aa; color: #ea580c; }
        .stat-icon.yellow { background: #fef08a; color: #ca8a04; }
        .stat-icon.purple { background: #e9d5ff; color: #9333ea; }
        .stat-icon.teal { background: #ccfbf1; color: #0d9488; }
        .stat-icon.red { background: #fecaca; color: #dc2626; }
        .stat-icon.gradient { background: linear-gradient(135deg, #3d9fe0, #2563eb); color: white; }

        .big-percent { font-size: 18px; font-weight: 700; }
        .stat-content { display: flex; flex-direction: column; }
        .stat-value { font-size: 24px; font-weight: 700; color: #1e293b; }
        .stat-label { font-size: 13px; color: #64748b; }

        .chart-card {
          background: white; border-radius: 16px; padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .chart-card h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }

        .transfers-list { display: flex; flex-direction: column; gap: 10px; }

        .transfer-item {
          display: flex; align-items: center; gap: 12px;
          padding: 10px 12px; background: #f8fafc; border-radius: 10px;
        }

        .transfer-icon {
          width: 36px; height: 36px; background: #dbeafe; color: #2563eb;
          border-radius: 8px; display: flex; align-items: center;
          justify-content: center; flex-shrink: 0;
        }

        .transfer-info { flex: 1; min-width: 0; }
        .student-name { display: block; font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .transfer-details { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }

        .transfer-status {
          padding: 4px 12px; border-radius: 20px;
          font-size: 12px; font-weight: 500; white-space: nowrap;
        }
        .transfer-status.pending { background: #fef3c7; color: #d97706; }

        .no-data { text-align: center; color: #94a3b8; padding: 24px; }

        @media (max-width: 1024px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 640px) {
          .stats-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

export default Dashboard;