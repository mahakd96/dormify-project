import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { regions, buildings, apartments, rooms, students as studentsSeed } from '../data/mockData';
import { Building2, Home, Users, ChevronDown, ChevronUp, Search, Star, X, Plus } from 'lucide-react';

function BuildingsPage({ language }) {
  const { isCentralAdmin, getUserRegion } = useAuth();
  const userRegion = getUserRegion();

  // ✅ Editable students only (assign/unassign)
  const [studentsState, setStudentsState] = useState(() => [...studentsSeed]);

  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [selectedApartment, setSelectedApartment] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedBuildings, setExpandedBuildings] = useState({});

  // ✅ Region selector
  const defaultRegion = isCentralAdmin() ? regions[0]?.id : userRegion;
  const [selectedRegionId, setSelectedRegionId] = useState(defaultRegion);
  const effectiveRegionId = isCentralAdmin() ? selectedRegionId : userRegion;

  // ✅ Add-student modal
  const [addModal, setAddModal] = useState({ open: false, roomId: null, query: '' });

  // ✅ Drag state
  const [draggingStudentId, setDraggingStudentId] = useState(null);

  const t = {
    he: {
      title: 'בניינים וחדרים',
      subtitle: 'שיוך סטודנטים לחדרים',
      search: 'חיפוש בניין...',
      chooseDorm: 'בחר מעונות לצפייה',
      floor: 'קומה',
      apartment: 'דירה',
      room: 'חדר',
      students: 'סטודנטים',
      empty: 'פנוי',
      reserved: 'שמור',
      selectBuilding: 'בחר דירה לצפייה',
      addStudent: 'הוסף סטודנט/ית',
      remove: 'הסר',
      unassigned: 'לא משוייכים',
      close: 'סגור',
      pickStudent: 'בחר סטודנט/ית לשיוך',
      dropHere: 'שחרר כאן לשיוך',
      capacity: 'קיבולת',
    },
    en: {
      title: 'Buildings & Rooms',
      subtitle: 'Assign students to rooms',
      search: 'Search building...',
      chooseDorm: 'Choose dorm to view',
      floor: 'Floor',
      apartment: 'Apartment',
      room: 'Room',
      students: 'Students',
      empty: 'Empty',
      reserved: 'Reserved',
      selectBuilding: 'Select an apartment to view',
      addStudent: 'Add student',
      remove: 'Remove',
      unassigned: 'Unassigned',
      close: 'Close',
      pickStudent: 'Pick a student to assign',
      dropHere: 'Drop here to assign',
      capacity: 'Capacity',
    }
  }[language];

  // -------------------------
  // Helpers
  // -------------------------
  const toggleBuilding = (buildingId) => {
    setExpandedBuildings(prev => ({ ...prev, [buildingId]: !prev[buildingId] }));
    setSelectedBuilding(buildingId);
    setSelectedApartment(null);
  };

  const getBuildingApartments = (buildingId) => apartments.filter(a => a.buildingId === buildingId);
  const getApartmentRooms = (apartmentId) => rooms.filter(r => r.apartmentId === apartmentId);

  const getRoomStudents = (roomId) =>
    studentsState.filter(s => s.assignedRoomId === roomId);

  const unassignedStudents = useMemo(
    () => studentsState.filter(s => !s.assignedRoomId),
    [studentsState]
  );

  const selectableRegions = useMemo(() => {
    return isCentralAdmin()
      ? regions
      : regions.filter(r => r.id === userRegion);
  }, [isCentralAdmin, userRegion]);

  const filteredBuildings = useMemo(() => {
    let list = buildings;

    if (!isCentralAdmin()) {
      list = list.filter(b => b.regionId === userRegion);
    } else if (effectiveRegionId) {
      list = list.filter(b => b.regionId === effectiveRegionId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(b => {
        const region = regions.find(r => r.id === b.regionId);
        return (
          (b.name || '').toLowerCase().includes(q) ||
          (region?.name || '').toLowerCase().includes(q) ||
          (region?.nameEn || '').toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [effectiveRegionId, isCentralAdmin, userRegion, searchQuery]);

  const selectedRegionObj = regions.find(r => r.id === effectiveRegionId);

  // -------------------------
  // Assignment actions
  // -------------------------
  const assignStudentToRoom = (studentId, roomId) => {
    setStudentsState(prev =>
      prev.map(s => (s.id === studentId ? { ...s, assignedRoomId: roomId } : s))
    );
  };

  const unassignStudent = (studentId) => {
    setStudentsState(prev =>
      prev.map(s => (s.id === studentId ? { ...s, assignedRoomId: null } : s))
    );
  };

  // -------------------------
  // Capacity guard (optional)
  // -------------------------
  const canDropIntoRoom = (room) => {
    const current = getRoomStudents(room.id).length;
    return current < room.capacity;
  };

  // -------------------------
  // Add-student modal list
  // -------------------------
  const filteredUnassigned = useMemo(() => {
    const q = addModal.query.trim().toLowerCase();
    if (!q) return unassignedStudents;
    return unassignedStudents.filter(s =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q)
    );
  }, [unassignedStudents, addModal.query]);

  return (
    <div className="buildings-page">
      <div className="page-header">
        <div>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
      </div>

      <div className="top-controls">
        <div className="region-select">
          <label>{t.chooseDorm}</label>
          <select
            value={effectiveRegionId || ''}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedRegionId(next);
              setSelectedBuilding(null);
              setSelectedApartment(null);
              setExpandedBuildings({});
              setSearchQuery('');
            }}
            disabled={!isCentralAdmin()}
          >
            {selectableRegions.map(r => (
              <option key={r.id} value={r.id}>
                {language === 'he' ? r.name : r.nameEn}
              </option>
            ))}
          </select>
        </div>

        <div className="search-bar">
          <Search size={18} />
          <input
            type="text"
            placeholder={t.search}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {isCentralAdmin() && (
        <div className="chips">
          {selectableRegions.slice(0, 8).map(r => (
            <button
              key={r.id}
              className={`chip ${effectiveRegionId === r.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedRegionId(r.id);
                setSelectedBuilding(null);
                setSelectedApartment(null);
                setExpandedBuildings({});
                setSearchQuery('');
              }}
              title={language === 'he' ? r.name : r.nameEn}
            >
              {language === 'he' ? r.name : r.nameEn}
            </button>
          ))}
        </div>
      )}

      <div className="content-grid">
        {/* LEFT: Buildings */}
        <div className="buildings-list">
          <div className="region-group">
            <h3 className="region-title">
              {language === 'he' ? selectedRegionObj?.name : selectedRegionObj?.nameEn}
            </h3>

            {filteredBuildings.map(building => {
              const buildingApartments = getBuildingApartments(building.id);
              const isExpanded = expandedBuildings[building.id];

              return (
                <div key={building.id} className="building-card">
                  <div
                    className={`building-header ${selectedBuilding === building.id ? 'selected' : ''}`}
                    onClick={() => toggleBuilding(building.id)}
                  >
                    <div className="building-icon">
                      <Building2 size={20} />
                    </div>
                    <div className="building-info">
                      <span className="building-name">{building.name}</span>
                      <span className="building-meta">
                        {building.floors} {t.floor} • {buildingApartments.length} {t.apartment}
                      </span>
                    </div>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>

                  {isExpanded && (
                    <div className="apartments-list">
                      {buildingApartments.map(apt => (
                        <div
                          key={apt.id}
                          className={`apartment-item ${apt.isReserved ? 'reserved' : ''} ${selectedApartment === apt.id ? 'selected' : ''}`}
                          onClick={() => setSelectedApartment(apt.id)}
                        >
                          <Home size={16} />
                          <span>{t.apartment} {apt.number}</span>
                          <span className="floor-badge">{t.floor} {apt.floor}</span>
                          {apt.isReserved && <Star size={14} className="reserved-icon" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: Allocation panel */}
        <div className="details-panel">
          {selectedApartment ? (
            <div className="apartment-details">
              {(() => {
                const apt = apartments.find(a => a.id === selectedApartment);
                const aptRooms = getApartmentRooms(selectedApartment);
                const building = buildings.find(b => b.id === apt?.buildingId);
                const region = regions.find(r => r.id === apt?.regionId);

                return (
                  <>
                    <div className="details-header">
                      <h3>{t.apartment} {apt?.number}</h3>
                      <p>{building?.name} • {language === 'he' ? region?.name : region?.nameEn}</p>
                      {apt?.isReserved && (
                        <span className="reserved-badge">
                          <Star size={14} /> {t.reserved}
                        </span>
                      )}
                    </div>

                    <div className="rooms-grid">
                      {aptRooms.map(room => {
                        const roomStudents = getRoomStudents(room.id);
                        const full = roomStudents.length >= room.capacity;

                        return (
                          <div
                            key={room.id}
                            className={`room-card ${full ? 'room-full' : ''}`}
                            onDragOver={(e) => {
                              e.preventDefault();
                            }}
                            onDrop={() => {
                              if (!draggingStudentId) return;
                              if (!canDropIntoRoom(room)) return;
                              assignStudentToRoom(draggingStudentId, room.id);
                              setDraggingStudentId(null);
                            }}
                          >
                            <div className="room-header">
                              <div className="room-header-left">
                                <span className="room-name">{room.name}</span>
                                <span className="room-capacity">
                                  {t.capacity}: {roomStudents.length}/{room.capacity}
                                </span>
                              </div>

                              <button
                                className="add-btn"
                                onClick={() => setAddModal({ open: true, roomId: room.id, query: '' })}
                                title={t.addStudent}
                              >
                                <Plus size={16} />
                                <span>{t.addStudent}</span>
                              </button>
                            </div>

                            <div className="room-students">
                              {roomStudents.length > 0 ? (
                                roomStudents.map(student => (
                                  <div
                                    key={student.id}
                                    className="student-row"
                                    draggable
                                    onDragStart={() => setDraggingStudentId(student.id)}
                                  >
                                    <div className="student-left">
                                      <Users size={14} />
                                      <span>{student.firstName} {student.lastName}</span>
                                    </div>
                                    <button
                                      className="remove-btn"
                                      onClick={() => unassignStudent(student.id)}
                                      title={t.remove}
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <div className="empty-drop">
                                  <span className="empty-label">{t.empty}</span>
                                  <span className="drop-hint">{t.dropHere}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="empty-state">
              <Building2 size={48} />
              <p>{t.selectBuilding}</p>
            </div>
          )}
        </div>
      </div>

      {/* ✅ Add Student Modal */}
      {addModal.open && (
        <div className="modal-backdrop" onClick={() => setAddModal({ open: false, roomId: null, query: '' })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4>{t.pickStudent}</h4>
              <button
                className="icon-btn"
                onClick={() => setAddModal({ open: false, roomId: null, query: '' })}
                title={t.close}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-search">
              <Search size={16} />
              <input
                value={addModal.query}
                onChange={(e) => setAddModal(prev => ({ ...prev, query: e.target.value }))}
                placeholder={language === 'he' ? 'חיפוש סטודנט/ית...' : 'Search student...'}
              />
            </div>

            <div className="modal-list">
              {filteredUnassigned.length === 0 ? (
                <div className="modal-empty">
                  <span>{language === 'he' ? 'אין סטודנטים פנויים לשיוך' : 'No available students'}</span>
                </div>
              ) : (
                filteredUnassigned.map(s => (
                  <button
                    key={s.id}
                    className="modal-item"
                    onClick={() => {
                      assignStudentToRoom(s.id, addModal.roomId);
                      setAddModal({ open: false, roomId: null, query: '' });
                    }}
                  >
                    <Users size={14} />
                    <span>{s.firstName} {s.lastName}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        .buildings-page { padding: 24px; }
        .page-header { margin-bottom: 18px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }

        .top-controls {
          display: grid;
          grid-template-columns: 1fr 1.5fr;
          gap: 16px;
          margin-bottom: 14px;
        }

        .region-select {
          background: white;
          padding: 12px 16px;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .region-select label { font-size: 12px; color: #64748b; font-weight: 600; }
        .region-select select {
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          padding: 10px;
          font-family: inherit;
          font-size: 14px;
          outline: none;
        }
        .region-select select:disabled { opacity: 0.8; }

        .search-bar {
          display: flex;
          align-items: center;
          gap: 12px;
          background: white;
          padding: 12px 16px;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .search-bar svg { color: #94a3b8; }
        .search-bar input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 15px;
          font-family: inherit;
        }

        .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
        .chip {
          border: 1px solid #e5e7eb;
          background: white;
          padding: 8px 10px;
          border-radius: 999px;
          cursor: pointer;
          font-size: 13px;
        }
        .chip.active { background: #dbeafe; border-color: #3d9fe0; font-weight: 600; }

        .content-grid { display: grid; grid-template-columns: 1fr 1.5fr; gap: 24px; }
        .buildings-list { display: flex; flex-direction: column; gap: 20px; }

        .region-group {
          background: white;
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .region-title {
          font-size: 14px;
          font-weight: 600;
          color: #64748b;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #e5e7eb;
        }

        .building-card { margin-bottom: 8px; }

        .building-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: #f8fafc;
          border-radius: 10px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .building-header:hover { background: #f1f5f9; }
        .building-header.selected { background: #dbeafe; border: 1px solid #3d9fe0; }

        .building-icon {
          width: 40px; height: 40px;
          background: #dbeafe; color: #2563eb;
          border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
        }
        .building-info { flex: 1; }
        .building-name { display: block; font-weight: 600; }
        .building-meta { font-size: 12px; color: #64748b; }

        .apartments-list {
          padding: 8px 0 0 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .apartment-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }
        .apartment-item:hover { border-color: #3d9fe0; }
        .apartment-item.selected { background: #dbeafe; border-color: #3d9fe0; }
        .apartment-item.reserved { background: #fef9c3; border-color: #fcd34d; }

        .floor-badge {
          margin-right: auto;
          font-size: 11px;
          color: #64748b;
          background: #f1f5f9;
          padding: 2px 8px;
          border-radius: 4px;
        }
        .reserved-icon { color: #f59e0b; }

        .details-panel {
          background: white;
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          min-height: 400px;
        }

        .details-header {
          margin-bottom: 24px;
          padding-bottom: 16px;
          border-bottom: 1px solid #e5e7eb;
        }
        .details-header h3 { font-size: 20px; margin-bottom: 4px; }
        .details-header p { color: #64748b; font-size: 14px; }

        .reserved-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-top: 8px;
          padding: 4px 12px;
          background: #fef9c3;
          color: #b45309;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 500;
        }

        .rooms-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }

        .room-card { border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
        .room-card.room-full { outline: 2px solid rgba(220,38,38,0.15); }

        .room-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px;
          background: #f8fafc;
          border-bottom: 1px solid #e5e7eb;
          gap: 10px;
        }
        .room-header-left { display: flex; flex-direction: column; gap: 2px; }
        .room-name { font-weight: 700; }
        .room-capacity { font-size: 12px; color: #64748b; }

        .add-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #e5e7eb;
          background: white;
          padding: 8px 10px;
          border-radius: 10px;
          cursor: pointer;
          font-size: 13px;
          white-space: nowrap;
        }
        .add-btn:hover { border-color: #3d9fe0; }

        .room-students { padding: 12px; min-height: 90px; }

        .student-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px;
          background: #f8fafc;
          border-radius: 10px;
          margin-bottom: 8px;
          font-size: 14px;
          border: 1px solid transparent;
        }
        .student-row:active { cursor: grabbing; }
        .student-row:hover { border-color: #e5e7eb; }

        .student-left { display: inline-flex; align-items: center; gap: 8px; }

        .remove-btn {
          border: none;
          background: transparent;
          cursor: pointer;
          color: #94a3b8;
          padding: 4px;
          border-radius: 8px;
        }
        .remove-btn:hover { background: #eef2ff; color: #1d4ed8; }

        .empty-drop { display: flex; flex-direction: column; gap: 6px; }
        .empty-label { color: #94a3b8; font-style: italic; }
        .drop-hint { font-size: 12px; color: #64748b; }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #94a3b8;
          gap: 12px;
        }

        /* Modal */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          padding: 20px;
        }
        .modal {
          width: 520px;
          max-width: 95vw;
          background: white;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
          overflow: hidden;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 16px;
          border-bottom: 1px solid #e5e7eb;
        }
        .modal-header h4 { margin: 0; font-size: 15px; }
        .icon-btn {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 6px;
          border-radius: 10px;
        }
        .icon-btn:hover { background: #f1f5f9; }

        .modal-search {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
        }
        .modal-search input {
          flex: 1;
          border: none;
          outline: none;
          font-family: inherit;
          font-size: 14px;
        }
        .modal-list {
          max-height: 360px;
          overflow: auto;
          padding: 10px;
        }
        .modal-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          border: 1px solid #e5e7eb;
          background: white;
          border-radius: 12px;
          cursor: pointer;
          margin-bottom: 8px;
          text-align: left;
        }
        .modal-item:hover { border-color: #3d9fe0; background: #f8fafc; }
        .modal-empty { padding: 20px; color: #64748b; }

        @media (max-width: 1024px) {
          .top-controls { grid-template-columns: 1fr; }
          .content-grid { grid-template-columns: 1fr; }
          .rooms-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

export default BuildingsPage;