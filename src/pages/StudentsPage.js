import React, { useEffect, useMemo, useState } from 'react';
import { studentsAPI } from '../services/api';
import { Search, Star, X } from 'lucide-react';

function StudentsPage({ language }) {
  const [students, setStudents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterGender, setFilterGender] = useState('all');
  const [filterReligion, setFilterReligion] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const t = {
    he: {
      title: 'ניהול סטודנטים',
      subtitle: 'צפייה וחיפוש סטודנטים',
      search: 'חיפוש לפי שם, ת.ז או אימייל...',
      all: 'הכל',
      male: 'זכר',
      female: 'נקבה',
      assigned: 'משובץ',
      unassigned: 'לא משובץ',
      priority: 'עדיפות',
      name: 'שם',
      id: 'ת.ז',
      gender: 'מגדר',
      religion: 'דת',
      dormType: 'סוג מעון',
      status: 'סטטוס',
      roommate: 'שותף מבוקש',
      results: 'תוצאות',
      noResults: 'לא נמצאו סטודנטים',
      studentDetails: 'פרטי סטודנט',
      loading: 'טוען סטודנטים...',
      error: 'שגיאה בטעינת סטודנטים',
      email: 'אימייל',
      phone: 'טלפון',
      building: 'בניין',
      apartment: 'דירה',
      room: 'חדר',
      bed: 'מיטה',
      category: 'קטגוריה',
      housingType: 'סוג דיור',
      priorityReason: 'סיבת עדיפות',
    },
    en: {
      title: 'Student Management',
      subtitle: 'View and search students',
      search: 'Search by name, ID or email...',
      all: 'All',
      male: 'Male',
      female: 'Female',
      assigned: 'Assigned',
      unassigned: 'Unassigned',
      priority: 'Priority',
      name: 'Name',
      id: 'ID',
      gender: 'Gender',
      religion: 'Religion',
      dormType: 'Dorm Type',
      status: 'Status',
      roommate: 'Roommate Request',
      results: 'results',
      noResults: 'No students found',
      studentDetails: 'Student Details',
      loading: 'Loading students...',
      error: 'Failed to load students',
      email: 'Email',
      phone: 'Phone',
      building: 'Building',
      apartment: 'Apartment',
      room: 'Room',
      bed: 'Bed',
      category: 'Category',
      housingType: 'Housing Type',
      priorityReason: 'Priority Reason',
    },
  }[language] || {};

  useEffect(() => {
    const fetchStudents = async () => {
      try {
        setLoading(true);
        setError('');

        const data = await studentsAPI.getAll();

        if (Array.isArray(data)) {
          setStudents(data);
        } else if (Array.isArray(data.results)) {
          setStudents(data.results);
        } else {
          setStudents([]);
        }
      } catch (err) {
        setError(err.message || 'Failed to load students');
      } finally {
        setLoading(false);
      }
    };

    fetchStudents();
  }, []);

  const religionOptions = useMemo(() => {
    const map = new Map();

    students.forEach((student) => {
      if (student.requested_religion) {
        map.set(
          student.requested_religion,
          student.requested_religion_display || student.requested_religion
        );
      }
    });

    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [students]);

  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();

        const fullName = `${student.first_name || ''} ${student.last_name || ''}`.toLowerCase();
        const fullNameFromServer = `${student.full_name || ''}`.toLowerCase();
        const studentId = `${student.student_id || ''}`.toLowerCase();
        const email = `${student.email || ''}`.toLowerCase();

        if (
          !fullName.includes(query) &&
          !fullNameFromServer.includes(query) &&
          !studentId.includes(query) &&
          !email.includes(query)
        ) {
          return false;
        }
      }

      if (filterGender !== 'all' && student.gender !== filterGender) {
        return false;
      }

      if (filterReligion !== 'all' && student.requested_religion !== filterReligion) {
        return false;
      }

      if (filterStatus === 'assigned' && !student.is_assigned) {
        return false;
      }

      if (filterStatus === 'unassigned' && student.is_assigned) {
        return false;
      }

      if (filterStatus === 'priority' && !student.is_priority) {
        return false;
      }

      return true;
    });
  }, [students, searchQuery, filterGender, filterReligion, filterStatus]);

  const getStudentName = (student) => {
    if (student.full_name) return student.full_name;
    return `${student.first_name || ''} ${student.last_name || ''}`.trim();
  };

  const getFirstLetter = (student) => {
    const name = getStudentName(student);
    return name ? name[0] : '?';
  };

  const getRoommateRequests = (student) => {
    return [
      student.roommate_request_1,
      student.roommate_request_2,
      student.roommate_request_3,
      student.roommate_request_4,
      student.roommate_request_5,
    ].filter(Boolean);
  };

  if (loading) {
    return (
      <div className="students-page">
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
    <div className="students-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <span className="results-count">
          {filteredStudents.length} {t.results}
        </span>
      </div>

      {error && (
        <div className="error-box">
          {error}
        </div>
      )}

      <div className="filters-bar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="text"
            placeholder={t.search}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <select value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
          <option value="all">
            {t.gender}: {t.all}
          </option>
          <option value="male">{t.male}</option>
          <option value="female">{t.female}</option>
        </select>

        <select value={filterReligion} onChange={(e) => setFilterReligion(e.target.value)}>
          <option value="all">
            {t.religion}: {t.all}
          </option>
          {religionOptions.map((religion) => (
            <option key={religion.value} value={religion.value}>
              {religion.label}
            </option>
          ))}
        </select>

        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">
            {t.status}: {t.all}
          </option>
          <option value="assigned">{t.assigned}</option>
          <option value="unassigned">{t.unassigned}</option>
          <option value="priority">{t.priority}</option>
        </select>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.id}</th>
              <th>{t.gender}</th>
              <th>{t.religion}</th>
              <th>{t.dormType}</th>
              <th>{t.status}</th>
              <th>{t.roommate}</th>
            </tr>
          </thead>

          <tbody>
            {filteredStudents.length > 0 ? (
              filteredStudents.map((student) => {
                const roommateRequests = getRoommateRequests(student);

                return (
                  <tr key={student.id} onClick={() => setSelectedStudent(student)}>
                    <td>
                      <div className="student-name-cell">
                        <div className="avatar">{getFirstLetter(student)}</div>
                        <span>{getStudentName(student)}</span>
                        {student.is_priority && <Star size={14} className="priority-icon" />}
                      </div>
                    </td>

                    <td className="mono">{student.student_id}</td>
                    <td>{student.gender_display || student.gender || '-'}</td>
                    <td>{student.requested_religion_display || student.requested_religion || '-'}</td>
                    <td>{student.accepted_dorm_type_name || '-'}</td>

                    <td>
                      <span className={`status-badge ${student.is_assigned ? 'assigned' : 'unassigned'}`}>
                        {student.is_assigned ? t.assigned : t.unassigned}
                      </span>
                    </td>

                    <td>
                      {roommateRequests.length > 0 ? (
                        <span className="roommate-id">{roommateRequests.join(', ')}</span>
                      ) : (
                        <span className="no-roommate">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="7" className="no-results">
                  {t.noResults}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedStudent && (
        <div className="modal-overlay" onClick={() => setSelectedStudent(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{t.studentDetails}</h3>
              <button onClick={() => setSelectedStudent(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-row">
                <span className="label">{t.name}</span>
                <span className="value">{getStudentName(selectedStudent)}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.id}</span>
                <span className="value mono">{selectedStudent.student_id}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.email}</span>
                <span className="value">{selectedStudent.email || '-'}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.phone}</span>
                <span className="value">{selectedStudent.phone || '-'}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.gender}</span>
                <span className="value">{selectedStudent.gender_display || selectedStudent.gender || '-'}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.religion}</span>
                <span className="value">
                  {selectedStudent.requested_religion_display || selectedStudent.requested_religion || '-'}
                </span>
              </div>

              <div className="detail-row">
                <span className="label">{t.category}</span>
                <span className="value">{selectedStudent.category_display || selectedStudent.category || '-'}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.housingType}</span>
                <span className="value">{selectedStudent.housing_type || '-'}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.dormType}</span>
                <span className="value">{selectedStudent.accepted_dorm_type_name || '-'}</span>
              </div>

              <div className="detail-row">
                <span className="label">{t.status}</span>
                <span className={`status-badge ${selectedStudent.is_assigned ? 'assigned' : 'unassigned'}`}>
                  {selectedStudent.is_assigned ? t.assigned : t.unassigned}
                </span>
              </div>

              {selectedStudent.is_assigned && (
                <>
                  <div className="detail-row">
                    <span className="label">{t.building}</span>
                    <span className="value">{selectedStudent.assigned_building_number || '-'}</span>
                  </div>

                  <div className="detail-row">
                    <span className="label">{t.apartment}</span>
                    <span className="value">{selectedStudent.assigned_apartment_number || '-'}</span>
                  </div>

                  <div className="detail-row">
                    <span className="label">{t.room}</span>
                    <span className="value">{selectedStudent.assigned_room_name || '-'}</span>
                  </div>

                  <div className="detail-row">
                    <span className="label">{t.bed}</span>
                    <span className="value">{selectedStudent.current_bed_label || '-'}</span>
                  </div>
                </>
              )}

              {getRoommateRequests(selectedStudent).length > 0 && (
                <div className="detail-row">
                  <span className="label">{t.roommate}</span>
                  <span className="value">{getRoommateRequests(selectedStudent).join(', ')}</span>
                </div>
              )}

              {selectedStudent.is_priority && (
                <div className="priority-notice">
                  <Star size={16} />
                  <span>{selectedStudent.priority_reason || t.priorityReason}</span>
                </div>
              )}
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
        .error-box { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; }
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
        .modal-content { background: white; border-radius: 16px; width: 90%; max-width: 520px; max-height: 90vh; overflow: auto; }
        .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #e5e7eb; }
        .modal-header h3 { font-size: 18px; }
        .modal-header button { background: none; border: none; color: #64748b; cursor: pointer; }
        .modal-body { padding: 20px; }
        .detail-row { display: flex; justify-content: space-between; gap: 16px; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
        .detail-row .label { color: #64748b; }
        .detail-row .value { font-weight: 500; text-align: left; }
        .priority-notice { display: flex; align-items: center; gap: 8px; margin-top: 16px; padding: 12px; background: #fef9c3; border-radius: 10px; color: #b45309; font-size: 14px; }
      `}</style>
    </div>
  );
}

export default StudentsPage;