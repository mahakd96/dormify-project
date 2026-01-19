// ReportsPage.js
import React from 'react';
import { BarChart3, Download } from 'lucide-react';

function ReportsPage({ language }) {
  const t = {
    he: { title: 'דוחות', subtitle: 'דוחות וסטטיסטיקות מערכת', download: 'הורד', occupancy: 'דוח תפוסה', allocation: 'דוח שיבוץ', transfers: 'דוח העברות' },
    en: { title: 'Reports', subtitle: 'System reports and statistics', download: 'Download', occupancy: 'Occupancy Report', allocation: 'Allocation Report', transfers: 'Transfers Report' }
  }[language];

  const reports = [
    { id: 1, name: t.occupancy, date: '2026-01-11' },
    { id: 2, name: t.allocation, date: '2026-01-10' },
    { id: 3, name: t.transfers, date: '2026-01-09' },
  ];

  return (
    <div className="reports-page">
      <div className="page-header"><div><h1>{t.title}</h1><p>{t.subtitle}</p></div></div>
      <div className="reports-list">
        {reports.map(report => (
          <div key={report.id} className="report-card">
            <BarChart3 size={24} />
            <div className="info"><span className="name">{report.name}</span><span className="date">{report.date}</span></div>
            <button className="download-btn"><Download size={16} /> {t.download}</button>
          </div>
        ))}
      </div>
      <style>{`
        .reports-page { padding: 24px; }
        .page-header { margin-bottom: 24px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }
        .reports-list { display: flex; flex-direction: column; gap: 12px; }
        .report-card { display: flex; align-items: center; gap: 16px; background: white; padding: 20px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .report-card svg { color: #3d9fe0; }
        .info { flex: 1; }
        .info .name { display: block; font-weight: 600; }
        .info .date { font-size: 13px; color: #64748b; }
        .download-btn { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #f1f5f9; border: none; border-radius: 8px; font-family: inherit; cursor: pointer; }
      `}</style>
    </div>
  );
}

export default ReportsPage;
