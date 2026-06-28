import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, whatIfAPI } from "../services/api";
import {
  Search,
  Building2,
  AlertTriangle,
  CheckCircle,
  Users,
  Home,
  BedDouble,
  RefreshCw,
  DoorOpen,
  Layers,
  X,
} from "lucide-react";

const TARGET_OPTIONS = [
  { key: "building", label: "Buildings", icon: Building2 },
  { key: "apartment", label: "Apartments", icon: Layers },
  { key: "room", label: "Rooms", icon: DoorOpen },
];

const WhatIfPage = () => {
  const [buildings, setBuildings] = useState([]);
  const [apartments, setApartments] = useState([]);
  const [rooms, setRooms] = useState([]);

  const [targetType, setTargetType] = useState("building");
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [action, setAction] = useState("inactivate");
  const [reason, setReason] = useState("Renovation");

  const [result, setResult] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingSimulation, setLoadingSimulation] = useState(false);
  const [loadingConfirm, setLoadingConfirm] = useState(false);
  const [error, setError] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");

  // New safety states for the real database change
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const didLoadInitialData = useRef(false);

  useEffect(() => {
  if (didLoadInitialData.current) return;
  didLoadInitialData.current = true;

  loadAllData();
}, []);

  const getAllPages = async (firstUrl) => {
    let allItems = [];
    let nextUrl = firstUrl;

    while (nextUrl) {
      const { data } = await api.get(nextUrl);

      if (Array.isArray(data)) {
        allItems = data;
        nextUrl = null;
      } else {
        allItems = [...allItems, ...(data?.results || [])];

        if (data?.next) {
          const url = new URL(data.next);
          nextUrl = `${url.pathname}${url.search}`;
        } else {
          nextUrl = null;
        }
      }
    }

    return allItems;
  };

  const loadAllData = async () => {
  try {
    setLoadingData(true);
    setError("");

    const buildingsData = await getAllPages("/api/buildings/");
    setBuildings(Array.isArray(buildingsData) ? buildingsData : buildingsData?.results || []);
  } catch (err) {
    setError(err.message || "Failed to load buildings data");
  } finally {
    setLoadingData(false);
  }
};
  const loadDataForTargetType = async (type, forceReload = false) => {
  try {
    setError("");

    if (type === "building") {
      if (!forceReload && buildings.length > 0) return;

      setLoadingData(true);
      const buildingsData = await getAllPages("/api/buildings/");
      setBuildings(Array.isArray(buildingsData) ? buildingsData : buildingsData?.results || []);
      return;
    }

    if (type === "apartment") {
      if (!forceReload && apartments.length > 0) return;

      setLoadingData(true);
      const apartmentsData = await getAllPages("/api/apartments/");
      setApartments(Array.isArray(apartmentsData) ? apartmentsData : apartmentsData?.results || []);
      return;
    }

    if (type === "room") {
      if (!forceReload && rooms.length > 0) return;

      setLoadingData(true);
      const roomsData = await getAllPages("/api/rooms/");
      setRooms(Array.isArray(roomsData) ? roomsData : roomsData?.results || []);
    }
  } catch (err) {
    setError(err.message || `Failed to load ${type} data`);
  } finally {
    setLoadingData(false);
  }
};

  const currentItems = useMemo(() => {
    if (targetType === "building") return buildings;
    if (targetType === "apartment") return apartments;
    return rooms;
  }, [targetType, buildings, apartments, rooms]);

  const getItemTitle = (item) => {
    if (targetType === "building") {
      return `Building ${item.number}`;
    }

    if (targetType === "apartment") {
      return `Building ${item.building_number} / Apartment ${item.number}`;
    }

    return `Building ${item.building_number} / Apartment ${item.apartment_number} / Room ${item.name}`;
  };

  const getItemSubtitle = (item) => {
    if (targetType === "building") {
      return `${item.dorm_type_name || "No dorm type"} · ${item.region_name || "No region"}`;
    }

    if (targetType === "apartment") {
      return `${item.dorm_type || "No dorm type"} · ${item.region_name || "No region"} · Capacity ${item.apartment_capacity ?? 0}`;
    }

    return `${item.region_name || "No region"} · Capacity ${item.capacity ?? 0} · Available beds ${item.available_beds ?? 0}`;
  };

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    if (!term) return currentItems;

    return currentItems.filter((item) => {
      const searchableText = [
        item.id,
        item.number,
        item.name,
        item.building_number,
        item.apartment_number,
        item.region_name,
        item.dorm_type_name,
        item.dorm_type,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(term);
    });
  }, [currentItems, searchTerm]);

  const selectedItems = useMemo(() => {
    return currentItems.filter((item) => selectedIds.includes(item.id));
  }, [currentItems, selectedIds]);

 const changeTargetType = async (newType) => {
  setTargetType(newType);
  setSelectedIds([]);
  setSearchTerm("");
  setResult(null);
  setConfirmMessage("");
  setError("");
  setShowApplyConfirm(false);
  setConfirmText("");

  await loadDataForTargetType(newType);
};

  const toggleItem = (id) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((itemId) => itemId !== id);
      }

      return [...current, id];
    });

    setResult(null);
    setConfirmMessage("");
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const selectAllVisible = () => {
    const visibleIds = filteredItems.map((item) => item.id);

    setSelectedIds((current) => {
      const merged = new Set([...current, ...visibleIds]);
      return [...merged];
    });

    setResult(null);
    setConfirmMessage("");
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setResult(null);
    setConfirmMessage("");
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const runSimulation = async () => {
    if (selectedIds.length === 0) {
      setError("Please select at least one item.");
      return;
    }

    try {
      setLoadingSimulation(true);
      setError("");
      setConfirmMessage("");
      setShowApplyConfirm(false);
      setConfirmText("");

      const data = await whatIfAPI.simulateAvailabilityChange({
        targetType,
        targetIds: selectedIds,
        action,
      });

      setResult(data);
    } catch (err) {
      setError(err.message || "Simulation failed");
    } finally {
      setLoadingSimulation(false);
    }
  };

  const openApplyConfirmation = () => {
    if (selectedIds.length === 0) {
      setError("Please select at least one item.");
      return;
    }

    if (!result) {
      setError("Please run the impact analysis before applying a real database change.");
      return;
    }

    setError("");
    setConfirmText("");
    setShowApplyConfirm(true);
  };

  const closeApplyConfirmation = () => {
    if (loadingConfirm) return;
    setShowApplyConfirm(false);
    setConfirmText("");
  };

  const confirmAvailabilityChange = async () => {
    if (selectedIds.length === 0) {
      setError("Please select at least one item.");
      return;
    }

    if (confirmText !== "APPLY") {
      setError("Please type APPLY to confirm the real database change.");
      return;
    }

    try {
      setLoadingConfirm(true);
      setError("");
      setConfirmMessage("");

      const data = await whatIfAPI.confirmAvailabilityChange({
        targetType,
        targetIds: selectedIds,
        action,
        reason,
        confirm_apply: true,
      });

      setConfirmMessage(
        `Done. Action: ${data.action}. Affected students: ${data.affected_students_count}. Created requests: ${data.created_requests}. Skipped existing requests: ${data.skipped_existing_requests}.`
      );

      setShowApplyConfirm(false);
      setConfirmText("");
      await loadAllData();
    } catch (err) {
      setError(err.message || "Confirm failed");
    } finally {
      setLoadingConfirm(false);
    }
  };

  const summary = result?.summary || {};
  const before = result?.analysis_before || {};
  const after = result?.analysis_after || {};
  const affectedStudents = result?.affected_students || [];

  const selectedTargetLabel =
    targetType === "building"
      ? "Buildings"
      : targetType === "apartment"
      ? "Apartments"
      : "Rooms";

  const selectedActionLabel = action === "inactivate" ? "Inactivation" : "Reactivation";

  return (
    <div className="whatif-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Scenario Planning</p>
          <h1>What-If & Availability Control</h1>
          <p className="subtitle">
            Simulate and apply availability changes for buildings, apartments,
            or individual rooms before running the allocation algorithm.
          </p>
        </div>

        <button className="refresh-btn" onClick={() => loadDataForTargetType(targetType, true)}>
          <RefreshCw size={16} />
          Refresh Data
        </button>
      </div>

      {error && (
        <div className="alert error-alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {confirmMessage && (
        <div className="alert success-alert">
          <CheckCircle size={18} />
          <span>{confirmMessage}</span>
        </div>
      )}

      <div className="top-cards">
        <InfoCard icon={<Building2 size={22} />} label="Buildings" value={buildings.length} />
        <InfoCard icon={<Layers size={22} />} label="Apartments" value={apartments.length} />
        <InfoCard icon={<DoorOpen size={22} />} label="Rooms" value={rooms.length} />
        <InfoCard icon={<CheckCircle size={22} />} label={`Selected ${selectedTargetLabel}`} value={selectedIds.length} />
      </div>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Select Target Type</h2>
              <p>
                Choose whether the availability change affects full buildings,
                apartments, or selected rooms.
              </p>
            </div>
          </div>

          <div className="target-tabs">
            {TARGET_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = targetType === option.key;

              return (
                <button
                  key={option.key}
                  className={`target-tab ${active ? "active" : ""}`}
                  onClick={() => changeTargetType(option.key)}
                >
                  <Icon size={18} />
                  {option.label}
                </button>
              );
            })}
          </div>

          <div className="search-box">
            <Search size={18} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={
                targetType === "building"
                  ? "Search building, dorm type, or region..."
                  : targetType === "apartment"
                  ? "Search apartment number, building, or region..."
                  : "Search room, apartment number, building, or region..."
              }
            />
          </div>

          <div className="buildings-meta">
            <span>
              Showing <strong>{filteredItems.length}</strong> of{" "}
              <strong>{currentItems.length}</strong> {selectedTargetLabel.toLowerCase()}
            </span>

            <div className="meta-actions">
              {filteredItems.length > 0 && (
                <button className="link-btn" onClick={selectAllVisible}>
                  Select all visible
                </button>
              )}

              {selectedIds.length > 0 && (
                <button className="link-btn" onClick={clearSelection}>
                  Clear selection
                </button>
              )}
            </div>
          </div>

          <div className="buildings-list">
            {loadingData ? (
              <div className="empty-state">Loading data...</div>
            ) : filteredItems.length === 0 ? (
              <div className="empty-state">No items found.</div>
            ) : (
              filteredItems.map((item) => {
                const selected = selectedIds.includes(item.id);
                const isInactive = item.is_active === false;

                return (
                  <button
                    key={`${targetType}-${item.id}`}
                    className={`building-row ${selected ? "selected" : ""}`}
                    onClick={() => toggleItem(item.id)}
                  >
                    <div className="checkbox">{selected && "✓"}</div>

                    <div className="building-icon">
                      {targetType === "building" ? (
                        <Building2 size={20} />
                      ) : targetType === "apartment" ? (
                        <Layers size={20} />
                      ) : (
                        <DoorOpen size={20} />
                      )}
                    </div>

                    <div className="building-info">
                      <strong>{getItemTitle(item)}</strong>
                      <span>{getItemSubtitle(item)}</span>
                    </div>

                    <div className={`building-status ${isInactive ? "inactive" : ""}`}>
                      {isInactive ? "Inactive" : "Active"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="panel sticky-panel">
          <h2>Scenario Settings</h2>

          <label className="field-label">Action</label>
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setResult(null);
              setConfirmMessage("");
              setShowApplyConfirm(false);
              setConfirmText("");
            }}
            className="select-input"
          >
            <option value="inactivate">Inactivate</option>
            <option value="reactivate">Reactivate</option>
          </select>

          <label className="field-label">Reason</label>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="select-input"
          >
            <option value="Renovation">Renovation</option>
            <option value="Maintenance">Maintenance</option>
            <option value="Safety issue">Safety issue</option>
            <option value="Reserved for administrative use">
              Reserved for administrative use
            </option>
            <option value="Other">Other</option>
          </select>

          <div className="selected-box">
            <h3>Selected {selectedTargetLabel}</h3>

            {selectedItems.length === 0 ? (
              <p>No items selected yet.</p>
            ) : (
              selectedItems.map((item) => (
                <div className="selected-building" key={item.id}>
                  <span>{getItemTitle(item)}</span>
                  <small>{getItemSubtitle(item)}</small>
                </div>
              ))
            )}
          </div>

          <button
            className="primary-btn"
            onClick={runSimulation}
            disabled={loadingSimulation || selectedIds.length === 0}
          >
            {loadingSimulation ? "Running Analysis..." : "Run Impact Analysis"}
          </button>

          <p className="note">
            Simulation does not change the database. Apply is a separate action.
          </p>

          {result && (
            <button
              className={action === "inactivate" ? "danger-btn" : "success-btn"}
              onClick={openApplyConfirmation}
              disabled={loadingConfirm}
            >
              {loadingConfirm
                ? "Applying..."
                : action === "inactivate"
                ? "Apply Inactivation to Database"
                : "Apply Reactivation to Database"}
            </button>
          )}
        </section>
      </div>

      {result && (
        <>
          <section className="results-section">
            <div className="section-title">
              <h2>Impact Summary</h2>
              <p>
                This shows the expected consequences of the selected availability change.
              </p>
            </div>

            <div className="summary-grid">
              <ResultCard icon={<Users size={22} />} title="Affected Students" value={summary.affected_students_count} />
              <ResultCard title="Males" value={summary.male_count} />
              <ResultCard title="Females" value={summary.female_count} />
              <ResultCard title="Need Transfer" value={summary.students_without_valid_placement} />
              <ResultCard icon={<Home size={22} />} title="Lost Apartments" value={summary.lost_apartments} />
              <ResultCard title="Lost Rooms" value={summary.lost_rooms} />
              <ResultCard title="Lost Capacity" value={summary.lost_capacity} />
              <ResultCard icon={<BedDouble size={22} />} title="Lost Beds" value={summary.lost_beds} />
            </div>
          </section>

          <section className="results-section">
            <div className="section-title">
              <h2>Before vs After</h2>
              <p>
                Comparison between the current data and the simulated result.
              </p>
            </div>

            <div className="modern-table-wrapper">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  <AnalysisRow label="Active Buildings" before={before.total_buildings} after={after.total_buildings} />
                  <AnalysisRow label="Total Rooms" before={before.total_rooms} after={after.total_rooms} />
                  <AnalysisRow label="Total Capacity" before={before.total_capacity} after={after.total_capacity} />
                  <AnalysisRow label="Assigned Students" before={before.assigned_students} after={after.assigned_students} />
                  <AnalysisRow label="Unassigned Students" before={before.unassigned_students} after={after.unassigned_students} />
                  <AnalysisRow label="Available Beds" before={before.available_beds} after={after.available_beds} />
                  <AnalysisRow label="Occupancy Rate" before={`${before.occupancy_rate || 0}%`} after={`${after.occupancy_rate || 0}%`} />
                </tbody>
              </table>
            </div>
          </section>

          <section className="results-section">
            <div className="section-title">
              <h2>Affected Students</h2>
              <p>
                Students who currently have an active bed assignment inside the selected target.
              </p>
            </div>

            <div className="modern-table-wrapper">
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Gender</th>
                    <th>Religious</th>
                    <th>Requested Religion</th>
                    <th>Building</th>
                    <th>Apartment</th>
                    <th>Room</th>
                    <th>Bed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {affectedStudents.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="empty-table-cell">
                        No affected students found.
                      </td>
                    </tr>
                  ) : (
                    affectedStudents.map((student) => (
                      <tr key={student.assignment_id}>
                        <td>{student.student_id}</td>
                        <td>{student.full_name}</td>
                        <td>{student.gender}</td>
                        <td>{student.religious}</td>
                        <td>{student.requested_religion}</td>
                        <td>{student.current_building_number}</td>
                        <td>{student.current_apartment_number}</td>
                        <td>{student.current_room_name}</td>
                        <td>{student.current_bed_label}</td>
                        <td>
                          <span className="status-pill">{student.status}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {showApplyConfirm && (
        <div className="confirm-overlay">
          <div className="confirm-modal">
            <button
              type="button"
              className="confirm-close"
              onClick={closeApplyConfirmation}
              disabled={loadingConfirm}
            >
              <X size={18} />
            </button>

            <div className="confirm-icon">
              <AlertTriangle size={28} />
            </div>

            <h2>Confirm Real Database Change</h2>

            <p className="danger-text">
              This is not a simulation. This action will update the real database.
            </p>

            <div className="confirm-summary">
              <div>
                <span>Action</span>
                <strong>{selectedActionLabel}</strong>
              </div>
              <div>
                <span>Target Type</span>
                <strong>{selectedTargetLabel}</strong>
              </div>
              <div>
                <span>Selected Items</span>
                <strong>{selectedIds.length}</strong>
              </div>
              <div>
                <span>Affected Students</span>
                <strong>{summary.affected_students_count ?? 0}</strong>
              </div>
            </div>

            <div className="warning-box">
              {action === "inactivate" ? (
                <>
                  The selected buildings, apartments, or rooms will be marked as inactive.
                  Future allocation will ignore them. Students currently assigned there may
                  require transfer or manual reassignment.
                </>
              ) : (
                <>
                  The selected buildings, apartments, or rooms will be reactivated and may
                  become available again for future allocation.
                </>
              )}
            </div>

            <label className="confirm-label">
              Type <strong>APPLY</strong> to confirm:
            </label>

            <input
              className="confirm-input"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="Type APPLY"
              autoFocus
            />

            <div className="confirm-actions">
              <button
                type="button"
                className="cancel-confirm-btn"
                onClick={closeApplyConfirmation}
                disabled={loadingConfirm}
              >
                Cancel
              </button>

              <button
                type="button"
                className="apply-confirm-btn"
                onClick={confirmAvailabilityChange}
                disabled={confirmText !== "APPLY" || loadingConfirm}
              >
                {loadingConfirm ? "Applying..." : "Confirm Apply"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .whatif-page {
          padding: 28px;
          color: #0f172a;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          align-items: flex-start;
          margin-bottom: 24px;
        }

        .eyebrow {
          color: #2563eb;
          font-weight: 700;
          font-size: 13px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 6px;
        }

        .page-header h1 {
          font-size: 30px;
          margin-bottom: 8px;
          color: #0f172a;
        }

        .subtitle {
          color: #64748b;
          max-width: 900px;
          line-height: 1.6;
        }

        .refresh-btn,
        .primary-btn,
        .danger-btn,
        .success-btn {
          border: none;
          border-radius: 12px;
          padding: 11px 16px;
          font-family: inherit;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .refresh-btn {
          background: white;
          color: #2563eb;
          border: 1px solid #dbeafe;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
        }

        .refresh-btn:hover {
          background: #eff6ff;
        }

        .alert {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 14px 16px;
          border-radius: 14px;
          margin-bottom: 18px;
          font-weight: 600;
        }

        .error-alert {
          background: #fef2f2;
          color: #b91c1c;
          border: 1px solid #fecaca;
        }

        .success-alert {
          background: #f0fdf4;
          color: #15803d;
          border: 1px solid #bbf7d0;
        }

        .top-cards {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }

        .info-card,
        .result-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          padding: 18px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
        }

        .info-card {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .info-icon,
        .result-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: #eff6ff;
          color: #2563eb;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .info-label,
        .result-title {
          color: #64748b;
          font-size: 13px;
          margin-bottom: 4px;
        }

        .info-value,
        .result-value {
          font-size: 26px;
          font-weight: 800;
          color: #0f172a;
        }

        .main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.8fr);
          gap: 20px;
          align-items: start;
        }

        .panel,
        .results-section {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          padding: 20px;
          box-shadow: 0 12px 35px rgba(15, 23, 42, 0.06);
        }

        .sticky-panel {
          position: sticky;
          top: 90px;
        }

        .panel h2,
        .results-section h2 {
          font-size: 20px;
          margin-bottom: 6px;
        }

        .panel p,
        .section-title p {
          color: #64748b;
          line-height: 1.5;
        }

        .target-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin: 18px 0;
        }

        .target-tab {
          border: 1px solid #dbe3ef;
          background: white;
          color: #334155;
          border-radius: 999px;
          padding: 10px 16px;
          font-family: inherit;
          font-weight: 800;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .target-tab.active {
          background: #2563eb;
          border-color: #2563eb;
          color: white;
          box-shadow: 0 10px 24px rgba(37, 99, 235, 0.18);
        }

        .search-box {
          margin-top: 18px;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid #dbe3ef;
          border-radius: 14px;
          padding: 12px 14px;
          background: #f8fafc;
        }

        .search-box input {
          border: none;
          outline: none;
          background: transparent;
          width: 100%;
          font-family: inherit;
          font-size: 15px;
        }

        .buildings-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 14px 0;
          color: #64748b;
          font-size: 14px;
          gap: 12px;
        }

        .meta-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .link-btn {
          background: none;
          border: none;
          color: #2563eb;
          font-weight: 700;
          cursor: pointer;
          font-family: inherit;
        }

        .buildings-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 510px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .building-row {
          width: 100%;
          border: 1px solid #e2e8f0;
          background: #ffffff;
          border-radius: 16px;
          padding: 14px;
          display: grid;
          grid-template-columns: 28px 44px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          transition: all 0.2s ease;
        }

        .building-row:hover {
          border-color: #93c5fd;
          background: #f8fbff;
          transform: translateY(-1px);
        }

        .building-row.selected {
          border-color: #2563eb;
          background: #eff6ff;
          box-shadow: 0 8px 20px rgba(37, 99, 235, 0.12);
        }

        .checkbox {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          border: 1px solid #cbd5e1;
          background: white;
          color: #2563eb;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
        }

        .building-icon {
          width: 44px;
          height: 44px;
          border-radius: 14px;
          background: #f1f5f9;
          color: #475569;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .building-info {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .building-info strong {
          color: #0f172a;
          font-size: 15px;
        }

        .building-info span {
          color: #64748b;
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .building-status {
          background: #dcfce7;
          color: #15803d;
          border-radius: 999px;
          padding: 5px 10px;
          font-size: 12px;
          font-weight: 700;
        }

        .building-status.inactive {
          background: #fee2e2;
          color: #b91c1c;
        }

        .field-label {
          display: block;
          margin-top: 18px;
          margin-bottom: 8px;
          font-weight: 700;
          color: #334155;
        }

        .select-input {
          width: 100%;
          border: 1px solid #dbe3ef;
          border-radius: 14px;
          padding: 12px;
          font-family: inherit;
          background: #f8fafc;
          outline: none;
        }

        .selected-box {
          margin-top: 18px;
          border: 1px dashed #cbd5e1;
          border-radius: 16px;
          padding: 14px;
          background: #f8fafc;
          max-height: 220px;
          overflow-y: auto;
        }

        .selected-box h3 {
          font-size: 15px;
          margin-bottom: 10px;
        }

        .selected-box p {
          font-size: 14px;
        }

        .selected-building {
          display: flex;
          flex-direction: column;
          padding: 10px;
          border-radius: 12px;
          background: white;
          border: 1px solid #e2e8f0;
          margin-bottom: 8px;
        }

        .selected-building span {
          font-weight: 700;
        }

        .selected-building small {
          color: #64748b;
        }

        .primary-btn {
          width: 100%;
          margin-top: 18px;
          background: linear-gradient(135deg, #2563eb, #3b82f6);
          color: white;
          box-shadow: 0 10px 22px rgba(37, 99, 235, 0.25);
        }

        .danger-btn {
          width: 100%;
          margin-top: 14px;
          background: #dc2626;
          color: white;
          box-shadow: 0 10px 22px rgba(220, 38, 38, 0.22);
        }

        .success-btn {
          width: 100%;
          margin-top: 14px;
          background: #16a34a;
          color: white;
          box-shadow: 0 10px 22px rgba(22, 163, 74, 0.22);
        }

        .primary-btn:disabled,
        .danger-btn:disabled,
        .success-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .note {
          font-size: 13px;
          margin-top: 12px;
          color: #64748b;
        }

        .empty-state,
        .empty-table-cell {
          text-align: center;
          color: #64748b;
          padding: 24px;
        }

        .results-section {
          margin-top: 22px;
        }

        .section-title {
          margin-bottom: 16px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 16px;
        }

        .result-card {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .modern-table-wrapper {
          overflow-x: auto;
          border-radius: 16px;
          border: 1px solid #e2e8f0;
        }

        .modern-table {
          width: 100%;
          border-collapse: collapse;
          background: white;
        }

        .modern-table th {
          text-align: left;
          background: #f8fafc;
          color: #475569;
          font-size: 13px;
          padding: 13px;
          border-bottom: 1px solid #e2e8f0;
          white-space: nowrap;
        }

        .modern-table td {
          padding: 13px;
          border-bottom: 1px solid #f1f5f9;
          color: #334155;
          font-size: 14px;
          white-space: nowrap;
        }

        .modern-table tr:last-child td {
          border-bottom: none;
        }

        .status-pill {
          background: #fff7ed;
          color: #c2410c;
          padding: 5px 9px;
          border-radius: 999px;
          font-weight: 700;
          font-size: 12px;
        }

        .confirm-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.62);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 20px;
          backdrop-filter: blur(4px);
        }

        .confirm-modal {
          position: relative;
          width: min(620px, 100%);
          background: white;
          border-radius: 22px;
          padding: 26px;
          box-shadow: 0 28px 80px rgba(15, 23, 42, 0.38);
          border: 1px solid #fecaca;
        }

        .confirm-close {
          position: absolute;
          top: 16px;
          right: 16px;
          border: none;
          background: #f1f5f9;
          color: #64748b;
          width: 34px;
          height: 34px;
          border-radius: 10px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .confirm-close:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .confirm-icon {
          width: 56px;
          height: 56px;
          border-radius: 18px;
          background: #fef2f2;
          color: #dc2626;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 14px;
        }

        .confirm-modal h2 {
          margin: 0 0 10px;
          font-size: 24px;
          font-weight: 900;
          color: #991b1b;
        }

        .danger-text {
          color: #dc2626;
          font-weight: 900;
          margin-bottom: 16px;
        }

        .confirm-summary {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin: 16px 0;
        }

        .confirm-summary div {
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .confirm-summary span {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .confirm-summary strong {
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
        }

        .warning-box {
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
          padding: 14px;
          border-radius: 14px;
          font-weight: 800;
          line-height: 1.5;
          margin: 16px 0;
        }

        .confirm-label {
          display: block;
          margin-bottom: 8px;
          color: #0f172a;
          font-weight: 800;
        }

        .confirm-input {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 14px;
          padding: 13px;
          font-size: 15px;
          font-weight: 900;
          margin-bottom: 18px;
          box-sizing: border-box;
        }

        .confirm-input:focus {
          outline: none;
          border-color: #dc2626;
          box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.14);
        }

        .confirm-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .cancel-confirm-btn,
        .apply-confirm-btn {
          border: none;
          border-radius: 12px;
          padding: 11px 16px;
          font-family: inherit;
          font-weight: 900;
          cursor: pointer;
        }

        .cancel-confirm-btn {
          background: #f1f5f9;
          color: #334155;
        }

        .apply-confirm-btn {
          background: #dc2626;
          color: white;
          box-shadow: 0 10px 22px rgba(220, 38, 38, 0.22);
        }

        .apply-confirm-btn:disabled,
        .cancel-confirm-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        @media (max-width: 1100px) {
          .top-cards,
          .summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .main-grid {
            grid-template-columns: 1fr;
          }

          .sticky-panel {
            position: static;
          }
        }

        @media (max-width: 640px) {
          .confirm-summary {
            grid-template-columns: 1fr;
          }

          .confirm-actions {
            flex-direction: column;
          }

          .cancel-confirm-btn,
          .apply-confirm-btn {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

const InfoCard = ({ icon, label, value }) => (
  <div className="info-card">
    <div className="info-icon">{icon}</div>
    <div>
      <div className="info-label">{label}</div>
      <div className="info-value">{value ?? 0}</div>
    </div>
  </div>
);

const ResultCard = ({ icon, title, value }) => (
  <div className="result-card">
    <div className="result-icon">{icon || <AlertTriangle size={22} />}</div>
    <div>
      <div className="result-title">{title}</div>
      <div className="result-value">{value ?? 0}</div>
    </div>
  </div>
);

const AnalysisRow = ({ label, before, after }) => (
  <tr>
    <td>{label}</td>
    <td>{before ?? 0}</td>
    <td>{after ?? 0}</td>
  </tr>
);

export default WhatIfPage;