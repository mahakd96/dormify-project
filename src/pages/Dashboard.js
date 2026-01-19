import React from 'react';
import { useAuth } from '../context/AuthContext';
import { regions, buildings, students, transferRequests, getRegionStats, getAllStats } from '../data/mockData';
import { Users, Building2, Home, AlertTriangle, CheckCircle, Clock, ArrowLeftRight, Star } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

function Dashboard({ language }) {
  const { user, isCentralAdmin, getUserRegion } = useAuth();
  const userRegion = getUserRegion();
  
  const stats = isCentralAdmin() ? getAllStats() : getRegionStats(userRegion);
  
  const pendingTransfers = transferRequests.filter(t => {
    if (isCentralAdmin()) return t.status === 'pending';
    const student = students.find(s => s.id === t.studentId);
    return t.status === 'pending' && student?.regionId === userRegion;
  });

  const regionData = isCentralAdmin() 
    ? regions.map(r => ({
        name: language === 'he' ? r.name.replace('מעונות ', '') : r.nameEn.replace(' Dorms', ''),
        students: students.filter(s => s.regionId === r.id).length,
        buildings: buildings.filter(b => b.regionId === r.id).length,
      }))
    : null;

  const genderData = () => {
    const relevantStudents = isCentralAdmin() 
      ? students 
      : students.filter(s => s.regionId === userRegion);
    
    const males = relevantStudents.filter(s => s.gender === 'male').length;
    const females = relevantStudents.filter(s => s.gender === 'female').length;
    
    return [
      { name: language === 'he' ? 'זכר' : 'Male', value: males, color: '#3d9fe0' },
      { name: language === 'he' ? 'נקבה' : 'Female', value: females, color: '#ec4899' },
    ];
  };

  const t = {
    he: {
      title: 'לוח בקרה',
      welcome: `שלום, ${user?.name}`,
      totalStudents: 'סה"כ סטודנטים',
      assignedStudents: 'סטודנטים משובצים',
      unassignedStudents: 'ממתינים לשיבוץ',
      priorityStudents: 'סטודנטים בעדיפות',
      totalBuildings: 'בניינים',
      totalRooms: 'חדרים',
      pendingTransfers: 'בקשות העברה ממתינות',
      occupancyRate: 'אחוז תפוסה',
      regionOverview: 'סקירת אזורים',
      genderDistribution: 'התפלגות מגדרית',
      recentTransfers: 'בקשות העברה אחרונות',
      noData: 'אין נתונים להצגה',
    },
    en: {
      title: 'Dashboard',
      welcome: `Hello, ${user?.name}`,
      totalStudents: 'Total Students',
      assignedStudents: 'Assigned Students',
      unassignedStudents: 'Pending Assignment',
      priorityStudents: 'Priority Students',
      totalBuildings: 'Buildings',
      totalRooms: 'Rooms',
      pendingTransfers: 'Pending Transfers',
      occupancyRate: 'Occupancy Rate',
      regionOverview: 'Region Overview',
      genderDistribution: 'Gender Distribution',
      recentTransfers: 'Recent Transfer Requests',
      noData: 'No data to display',
    }
  }[language];

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.welcome}</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Users size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats.totalStudents}</span>
            <span className="stat-label">{t.totalStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon green"><CheckCircle size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats.assignedStudents}</span>
            <span className="stat-label">{t.assignedStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon orange"><Clock size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats.unassignedStudents}</span>
            <span className="stat-label">{t.unassignedStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon yellow"><Star size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats.priorityStudents}</span>
            <span className="stat-label">{t.priorityStudents}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon purple"><Building2 size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{isCentralAdmin() ? stats.totalBuildings : buildings.filter(b => b.regionId === userRegion).length}</span>
            <span className="stat-label">{t.totalBuildings}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon teal"><Home size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{stats.totalRooms}</span>
            <span className="stat-label">{t.totalRooms}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon red"><ArrowLeftRight size={24} /></div>
          <div className="stat-content">
            <span className="stat-value">{pendingTransfers.length}</span>
            <span className="stat-label">{t.pendingTransfers}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon gradient">
            <span className="big-percent">{stats.occupancyRate}%</span>
          </div>
          <div className="stat-content">
            <span className="stat-label">{t.occupancyRate}</span>
          </div>
        </div>
      </div>

      <div className="charts-grid">
        {isCentralAdmin() && regionData && (
          <div className="chart-card">
            <h3>{t.regionOverview}</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={regionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="students" fill="#3d9fe0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="chart-card">
          <h3>{t.genderDistribution}</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={genderData()}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                dataKey="value"
                label={({ name, value }) => `${name}: ${value}`}
              >
                {genderData().map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="transfers-section">
        <h3>{t.recentTransfers}</h3>
        {pendingTransfers.length > 0 ? (
          <div className="transfers-list">
            {pendingTransfers.slice(0, 5).map(transfer => {
              const student = students.find(s => s.id === transfer.studentId);
              return (
                <div key={transfer.id} className="transfer-item">
                  <div className="transfer-icon"><ArrowLeftRight size={16} /></div>
                  <div className="transfer-info">
                    <span className="student-name">{student?.firstName} {student?.lastName}</span>
                    <span className="transfer-details">{transfer.reason}</span>
                  </div>
                  <span className="transfer-status pending">{language === 'he' ? 'ממתין' : 'Pending'}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="no-data">{t.noData}</p>
        )}
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
          width: 52px;
          height: 52px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .stat-icon.blue { background: #dbeafe; color: #2563eb; }
        .stat-icon.green { background: #d1fae5; color: #059669; }
        .stat-icon.orange { background: #fed7aa; color: #ea580c; }
        .stat-icon.yellow { background: #fef08a; color: #ca8a04; }
        .stat-icon.purple { background: #e9d5ff; color: #9333ea; }
        .stat-icon.teal { background: #ccfbf1; color: #0d9488; }
        .stat-icon.red { background: #fecaca; color: #dc2626; }
        .stat-icon.gradient { 
          background: linear-gradient(135deg, #3d9fe0, #2563eb); 
          color: white;
        }

        .big-percent { font-size: 18px; font-weight: 700; }

        .stat-content { display: flex; flex-direction: column; }
        .stat-value { font-size: 24px; font-weight: 700; color: #1e293b; }
        .stat-label { font-size: 13px; color: #64748b; }

        .charts-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .chart-card {
          background: white;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .chart-card h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 16px;
        }

        .transfers-section {
          background: white;
          border-radius: 16px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .transfers-section h3 {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 16px;
        }

        .transfers-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .transfer-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #f8fafc;
          border-radius: 10px;
        }

        .transfer-icon {
          width: 36px;
          height: 36px;
          background: #dbeafe;
          color: #2563eb;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .transfer-info { flex: 1; }
        .student-name { display: block; font-weight: 500; }
        .transfer-details { font-size: 13px; color: #64748b; }

        .transfer-status {
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }

        .transfer-status.pending {
          background: #fef3c7;
          color: #d97706;
        }

        .no-data {
          text-align: center;
          color: #94a3b8;
          padding: 24px;
        }

        @media (max-width: 1024px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
          .charts-grid { grid-template-columns: 1fr; }
        }

        @media (max-width: 640px) {
          .stats-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

export default Dashboard;
