import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { students, regions, religions } from '../data/mockData';
import { Search, Star, X } from 'lucide-react';

function StudentsPage({ language }) {
  const { isCentralAdmin, getUserRegion } = useAuth();
  const userRegion = getUserRegion();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGender, setFilterGender] = useState('all');
  const [filterReligion, setFilterReligion] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedStudent, setSelectedStudent] = useState(null);

  const filteredStudents = useMemo(() => {
    return students.filter(student => {
      if (!isCentralAdmin() && student.regionId !== userRegion) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const fullName = `${student.firstName} ${student.lastName}`.toLowerCase();
        if (!fullName.includes(query) && !student.studentId.includes(query)) return false;
      }
      if (filterGender !== 'all' && student.gender !== filterGender) return false;
      if (filterReligion !== 'all' && student.religion !== filterReligion) return false;
      if (filterStatus === 'assigned' && !student.isAssigned) return false;
      if (filterStatus === 'unassigned' && student.isAssigned) return false;
      if (filterStatus === 'priority' && !student.isPriority) return false;
      return true;
    });
  }, [searchQuery, filterGender, filterReligion, filterStatus, isCentralAdmin, userRegion]);

  const t = { he: { title: 'ניהול סטודנטים', subtitle: 'צפייה וחיפוש סטודנטים', search: 'חיפוש לפי שם או ת.ז...', all: 'הכל', male: 'זכר', female: 'נקבה', assigned: 'משובץ', unassigned: 'לא משובץ', priority: 'עדיפות', name: 'שם', id: 'ת.ז', gender: 'מגדר', religion: 'דת', region: 'אזור', status: 'סטטוס', roommate: 'שותף מבוקש', results: 'תוצאות', noResults: 'לא נמצאו סטודנטים', studentDetails: 'פרטי סטודנט' }, en: { title: 'Student Management', subtitle: 'View and search students', search: 'Search by name or ID...', all: 'All', male: 'Male', female: 'Female', assigned: 'Assigned', unassigned: 'Unassigned', priority: 'Priority', name: 'Name', id: 'ID', gender: 'Gender', religion: 'Religion', region: 'Region', status: 'Status', roommate: 'Roommate Request', results: 'results', noResults: 'No students found', studentDetails: 'Student Details' } }[language];

  const getRegionName = (regionId) => { const region = regions.find(r => r.id === regionId); return language === 'he' ? region?.name : region?.nameEn; };
  const getReligionName = (religionId) => { const religion = religions.find(r => r.id === religionId); return language === 'he' ? religion?.name : religion?.nameEn; };

  return (
    <div className="students-page">
      <div className="page-header"><div><h1>{t.title}</h1><p>{t.subtitle}</p></div><span className="results-count">{filteredStudents.length} {t.results}</span></div>
      <div className="filters-bar">
        <div className="search-box"><Search size={18} /><input type="text" placeholder={t.search} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div>
        <select value={filterGender} onChange={(e) => setFilterGender(e.target.value)}><option value="all">{t.gender}: {t.all}</option><option value="male">{t.male}</option><option value="female">{t.female}</option></select>
        <select value={filterReligion} onChange={(e) => setFilterReligion(e.target.value)}><option value="all">{t.religion}: {t.all}</option>{religions.map(r => (<option key={r.id} value={r.id}>{language === 'he' ? r.name : r.nameEn}</option>))}</select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}><option value="all">{t.status}: {t.all}</option><option value="assigned">{t.assigned}</option><option value="unassigned">{t.unassigned}</option><option value="priority">{t.priority}</option></select>
      </div>
      <div className="table-container">
        <table>
          <thead><tr><th>{t.name}</th><th>{t.id}</th><th>{t.gender}</th><th>{t.religion}</th><th>{t.region}</th><th>{t.status}</th><th>{t.roommate}</th></tr></thead>
          <tbody>
            {filteredStudents.length > 0 ? filteredStudents.slice(0, 50).map(student => (
              <tr key={student.id} onClick={() => setSelectedStudent(student)}>
                <td><div className="student-name-cell"><div className="avatar">{student.firstName[0]}</div><span>{student.firstName} {student.lastName}</span>{student.isPriority && <Star size={14} className="priority-icon" />}</div></td>
                <td className="mono">{student.studentId}</td>
                <td>{student.gender === 'male' ? t.male : t.female}</td>
                <td>{getReligionName(student.religion)}</td>
                <td>{getRegionName(student.regionId)}</td>
                <td><span className={`status-badge ${student.isAssigned ? 'assigned' : 'unassigned'}`}>{student.isAssigned ? t.assigned : t.unassigned}</span></td>
                <td>{student.roommateRequestId ? <span className="roommate-id">{student.roommateRequestId}</span> : <span className="no-roommate">-</span>}</td>
              </tr>
            )) : <tr><td colSpan="7" className="no-results">{t.noResults}</td></tr>}
          </tbody>
        </table>
      </div>
      {selectedStudent && (
        <div className="modal-overlay" onClick={() => setSelectedStudent(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>{t.studentDetails}</h3><button onClick={() => setSelectedStudent(null)}><X size={20} /></button></div>
            <div className="modal-body">
              <div className="detail-row"><span className="label">{t.name}</span><span className="value">{selectedStudent.firstName} {selectedStudent.lastName}</span></div>
              <div className="detail-row"><span className="label">{t.id}</span><span className="value mono">{selectedStudent.studentId}</span></div>
              <div className="detail-row"><span className="label">{t.gender}</span><span className="value">{selectedStudent.gender === 'male' ? t.male : t.female}</span></div>
              <div className="detail-row"><span className="label">{t.religion}</span><span className="value">{getReligionName(selectedStudent.religion)}</span></div>
              <div className="detail-row"><span className="label">{t.region}</span><span className="value">{getRegionName(selectedStudent.regionId)}</span></div>
              <div className="detail-row"><span className="label">{t.status}</span><span className={`status-badge ${selectedStudent.isAssigned ? 'assigned' : 'unassigned'}`}>{selectedStudent.isAssigned ? t.assigned : t.unassigned}</span></div>
              {selectedStudent.roommateRequestId && <div className="detail-row"><span className="label">{t.roommate}</span><span className="value">{selectedStudent.roommateRequestId}</span></div>}
              {selectedStudent.isPriority && <div className="priority-notice"><Star size={16} /><span>{selectedStudent.priorityReason}</span></div>}
            </div>
          </div>
        </div>
      )}
      <style>{`
        .students-page { padding: 24px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }
        .results-count { background: #f1f5f9; padding: 8px 16px; border-radius: 20px; font-size: 14px; color: #64748b; }
        .filters-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
        .search-box { display: flex; align-items: center; gap: 8px; background: white; padding: 10px 16px; border-radius: 10px; border: 1px solid #e5e7eb; flex: 1; min-width: 250px; }
        .search-box svg { color: #94a3b8; }
        .search-box input { flex: 1; border: none; outline: none; font-size: 14px; font-family: inherit; }
        .filters-bar select { padding: 10px 16px; border: 1px solid #e5e7eb; border-radius: 10px; font-size: 14px; font-family: inherit; background: white; }
        .table-container { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 14px 16px; text-align: right; border-bottom: 1px solid #f1f5f9; }
        [dir="ltr"] th, [dir="ltr"] td { text-align: left; }
        th { background: #f8fafc; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; }
        tr { cursor: pointer; transition: background 0.2s; }
        tbody tr:hover { background: #f8fafc; }
        .student-name-cell { display: flex; align-items: center; gap: 10px; }
        .avatar { width: 32px; height: 32px; background: linear-gradient(135deg, #3d9fe0, #2563eb); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 14px; }
        .priority-icon { color: #f59e0b; }
        .mono { font-family: monospace; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; }
        .status-badge.assigned { background: #d1fae5; color: #059669; }
        .status-badge.unassigned { background: #fee2e2; color: #dc2626; }
        .roommate-id { font-family: monospace; font-size: 12px; color: #64748b; }
        .no-roommate { color: #cbd5e1; }
        .no-results { text-align: center; color: #94a3b8; padding: 40px !important; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; }
        .modal-content { background: white; border-radius: 16px; width: 90%; max-width: 450px; overflow: hidden; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; }
        .modal-header h3 { font-size: 18px; }
        .modal-header button { background: none; border: none; color: #64748b; cursor: pointer; }
        .modal-body { padding: 20px; }
        .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
        .detail-row .label { color: #64748b; }
        .detail-row .value { font-weight: 500; }
        .priority-notice { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding: 12px; background: #fef9c3; border-radius: 10px; color: #b45309; font-size: 14px; }
      `}</style>
    </div>
  );
}

export default StudentsPage;
