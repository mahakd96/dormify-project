import axios from "axios";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
});

const STORAGE_KEYS = {
  access: "dormify_access_token",
  refresh: "dormify_refresh_token",
  user: "dormify_user",
};

const pickAccessToken = (data) =>
  data?.access ||
  data?.access_token ||
  data?.token ||
  data?.jwt ||
  data?.tokens?.access ||
  data?.tokens?.access_token ||
  null;

const pickRefreshToken = (data) =>
  data?.refresh ||
  data?.refresh_token ||
  data?.tokens?.refresh ||
  data?.tokens?.refresh_token ||
  null;

const getAccessToken = () => localStorage.getItem(STORAGE_KEYS.access);
const getRefreshToken = () => localStorage.getItem(STORAGE_KEYS.refresh);

const clearStoredAuth = () => {
  localStorage.removeItem(STORAGE_KEYS.access);
  localStorage.removeItem(STORAGE_KEYS.refresh);
  localStorage.removeItem(STORAGE_KEYS.user);
};

// DRF error bodies come in several shapes: a plain string, {detail: "..."},
// {error: "..."}, {non_field_errors: [...]}, a plain array (raised via
// rest_framework.exceptions.ValidationError("message")), or the most common
// serializer shape {field_name: ["message", ...], other_field: [...]}.
// Flatten any of these into one readable string instead of falling through
// to a generic "empty/unknown body" message.
const flattenErrorValue = (value, keyHint) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((v) => flattenErrorValue(v)).filter(Boolean).join("; ");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, v]) => {
        const msg = flattenErrorValue(v, key);
        if (!msg) return "";
        return key === "non_field_errors" || key === "detail" ? msg : `${key}: ${msg}`;
      })
      .filter(Boolean)
      .join("; ");
  }

  return String(value);
};

const getErrorMessage = (err, fallback = "Request failed") => {
  const data = err?.response?.data;
  const status = err?.response?.status;

  if (typeof data === "string" && data.trim()) {
    return data.length > 400
      ? `${status || ""} ${data.slice(0, 400)}…`
      : data;
  }

  if (data && typeof data === "object" && Object.keys(data).length) {
    const flattened = flattenErrorValue(data);
    if (flattened) return flattened;
  }

  if (Array.isArray(data) && data.length) {
    const flattened = flattenErrorValue(data);
    if (flattened) return flattened;
  }

  if (!err?.response) {
    const code = err?.code ? ` [${err.code}]` : "";
    return `${fallback}: no response from server${code} — ${
      err?.message || "Network Error"
    }`;
  }

  return `${fallback}: HTTP ${status || "?"} with empty/unknown body`;
};

// Same message resolution as getErrorMessage, but also attaches the raw
// field-keyed error dict (when the backend returned one, e.g.
// {"student_id": ["already exists"]}) as `.fieldErrors` on the thrown Error,
// so callers can map errors to the right form field instead of only
// showing one flattened string.
const throwApiError = (err, fallback) => {
  const message = getErrorMessage(err, fallback);
  const wrapped = new Error(message);
  const data = err?.response?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    wrapped.fieldErrors = data;
  }
  wrapped.status = err?.response?.status;
  throw wrapped;
};

api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();
    config.headers = config.headers || {};

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => Promise.reject(error)
);

export const authAPI = {
  login: async (email, password) => {
    try {
      const { data } = await api.post("/api/auth/login/", {
        email,
        password,
      });

      const access = pickAccessToken(data);
      const refresh = pickRefreshToken(data);

      if (!access) {
        throw new Error("Login succeeded but no access token was returned.");
      }

      localStorage.setItem(STORAGE_KEYS.access, access);

      if (refresh) {
        localStorage.setItem(STORAGE_KEYS.refresh, refresh);
      }

      if (data?.user) {
        localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(data.user));
      }

      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Login failed"));
    }
  },

  getMe: async () => {
    try {
      const { data } = await api.get("/api/auth/me/");
      return data;
    } catch (err) {
      if (err?.response?.status === 401) {
        clearStoredAuth();
      }

      throw new Error(getErrorMessage(err, "Failed to load current user"));
    }
  },

  logout: async () => {
    clearStoredAuth();
  },
};

export const settingsAPI = {
  changePassword: async (payload) => {
    try {
      const body = {
        current_password:
          payload.current_password ?? payload.currentPassword,
        new_password:
          payload.new_password ?? payload.newPassword,
        confirm_password:
          payload.confirm_password ?? payload.confirmPassword,
      };

      const { data } = await api.put("/api/auth/change-password/", body);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to change password"));
    }
  },

  changeEmail: async (payload) => {
    try {
      const body = {
        current_email:
          payload.current_email ?? payload.currentEmail,
        new_email:
          payload.new_email ?? payload.newEmail,
        confirm_email:
          payload.confirm_email ?? payload.confirmEmail,
      };

      const { data } = await api.put("/api/auth/change-email/", body);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to change email"));
    }
  },
};

export const allocationAPI = {
  getSummary: async () => {
    try {
      const { data } = await api.get("/api/allocation/summary/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load allocation summary"));
    }
  },

  run: async (regionId, payload = {}) => {
    try {
      const body = { region: regionId, ...payload };
      const { data } = await api.post("/api/allocation/run/", body);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Allocation run failed"));
    }
  },

  startRun: async (regionId, payload = {}) => {
    try {
      const body = { region: regionId, ...payload };
      const { data } = await api.post("/api/allocation/start/", body);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to start allocation run"));
    }
  },

  getRunStatus: async (runId) => {
    try {
      const { data } = await api.get(`/api/allocation/runs/${runId}/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to get run status"));
    }
  },

  stopRun: async (runId) => {
    try {
      const { data } = await api.post(`/api/allocation/runs/${runId}/stop/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to stop allocation run"));
    }
  },

  deleteResults: async (runId) => {
    try {
      const { data } = await api.delete(`/api/allocation/runs/${runId}/delete/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to delete allocation results"));
    }
  },

  retryUnassigned: async (runId, payload = {}) => {
    try {
      const { data } = await api.post(
        `/api/allocation/runs/${runId}/retry-unassigned/`,
        payload
      );
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to retry unassigned students"));
    }
  },

  getActiveRun: async (regionId = null) => {
    try {
      const url = regionId
        ? `/api/allocation/runs/active/?region=${regionId}`
        : "/api/allocation/runs/active/";
      const { data } = await api.get(url);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to get active run"));
    }
  },

  history: async () => {
    try {
      const { data } = await api.get("/api/allocation/history/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load allocation history"));
    }
  },

  getResults: async (regionId = null) => {
    try {
      const { data } = await api.get("/api/allocation/results/", {
        params: regionId ? { region: regionId } : {},
      });

      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load allocation results"));
    }
  },

  results: async (regionId = null) => {
    try {
      const { data } = await api.get("/api/allocation/results/", {
        params: regionId ? { region: regionId } : {},
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load allocation results"));
    }
  },

  getConditions: async (regionId = null) => {
    try {
      const url = regionId
        ? `/api/allocation/conditions/?region=${regionId}`
        : "/api/allocation/conditions/";
      const { data } = await api.get(url);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load allocation conditions"));
    }
  },

  updateConditions: async (conditions, regionId = null) => {
    try {
      const payload = regionId ? { conditions, region: regionId } : { conditions };
      const { data } = await api.put("/api/allocation/conditions/", payload);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to update allocation conditions"));
    }
  },

  getStatus: async (regionId = null) => {
    try {
      const url = regionId
        ? `/api/allocation/status/?region=${regionId}`
        : "/api/allocation/status/";
      const { data } = await api.get(url);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to get allocation status"));
    }
  },
};

export const homeAPI = {
  get: async () => {
    try {
      const { data } = await api.get("/api/home/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load homepage data"));
    }
  },
};

export const inventoryAPI = {
  getByHousingType: async (regionId = null) => {
    try {
      const url = regionId
        ? `/api/inventory/by-housing-type/?region=${regionId}`
        : "/api/inventory/by-housing-type/";
      const { data } = await api.get(url);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load inventory by housing type"));
    }
  },
};

export const inboxAPI = {
  getLatest: async () => {
    try {
      const { data } = await api.get("/api/inbox/latest/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load inbox"));
    }
  },

  markViewed: async (id) => {
    try {
      const { data } = await api.put(`/api/inbox/${id}/viewed/`);
      return data;
    } catch (err) {
      console.warn(
        `markViewed failed for inbox item ${id}:`,
        err?.response?.data || err.message
      );
      return null;
    }
  },

  markProcessed: async (id) => {
    try {
      const { data } = await api.put(`/api/inbox/${id}/processed/`);
      return data;
    } catch (err) {
      console.warn(
        `markProcessed failed for inbox item ${id}:`,
        err?.response?.data || err.message
      );

      throw new Error(
        getErrorMessage(err, "Failed to mark inbox item as processed")
      );
    }
  },
};

export const uploadAPI = {
  uploadExcel: async (file) => {
    try {
      const form = new FormData();
      form.append("file", file);

      const { data } = await api.post("/api/upload/excel/", form, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Excel upload failed"));
    }
  },

  uploadAdditionsExcel: async (file) => {
    try {
      const form = new FormData();
      form.append("file", file);

      const { data } = await api.post("/api/upload/additions-excel/", form, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Additions Excel upload failed"));
    }
  },
};

export const studentsAPI = {
  getAll: async () => {
    try {
      const { data } = await api.get("/api/students/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load students"));
    }
  },

  getStudents: async (params = {}, opts = {}) => {
    try {
      const { data } = await api.get("/api/students/", { params, signal: opts.signal });
      return data;
    } catch (err) {
      if (err.code === "ERR_CANCELED" || err.name === "CanceledError") throw err;
      throw new Error(getErrorMessage(err, "Failed to load students"));
    }
  },

  getById: async (id) => {
    try {
      const { data } = await api.get(`/api/students/${id}/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load student"));
    }
  },

    getCounts: async () => {
    try {
      const { data } = await api.get("/api/students/counts/");
      return data;
    } catch (err) {
      console.warn(
        "studentsAPI.getCounts failed, computing from students list:",
        err?.response?.data || err.message
      );

      try {
        const { data } = await api.get("/api/students/");
        const list = Array.isArray(data) ? data : data.results || [];

        const isStatus = (student, words) => {
          const text = [
            student.status,
            student.student_status,
            student.type,
            student.student_type,
            student.category,
            student.assignment_status,
            student.sap_status,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return words.some((word) => text.includes(word));
        };

        const total = list.length;

        const staying = list.filter((s) =>
          isStatus(s, ["staying", "stay", "׳ ׳©׳׳¨"])
        ).length;

        const newStudents = list.filter((s) =>
          isStatus(s, ["new", "incoming", "׳—׳“׳©", "׳ ׳›׳ ׳¡"])
        ).length;

        const transferring = list.filter((s) =>
          isStatus(s, ["transferring", "transfer", "׳׳¢׳‘׳¨", "׳¢׳•׳‘׳¨"])
        ).length;

        const leaving = list.filter((s) =>
          isStatus(s, ["leaving", "leave", "׳¢׳–׳™׳‘׳”", "׳¢׳•׳–׳‘"])
        ).length;

        return {
          total,
          all: total,
          all_students: total,
          total_students: total,

          staying,
          staying_students: staying,

          new: newStudents,
          new_students: newStudents,
          incoming: newStudents,

          transferring,
          transferring_students: transferring,

          leaving,
          leaving_students: leaving,
        };
      } catch (fallbackErr) {
        console.warn(
          "studentsAPI.getCounts fallback failed:",
          fallbackErr?.response?.data || fallbackErr.message
        );

        return {
          total: 0,
          all: 0,
          all_students: 0,
          total_students: 0,
          staying: 0,
          new: 0,
          new_students: 0,
          transferring: 0,
          leaving: 0,
        };
      }
    }
  },

  getFilterOptions: async () => {
    try {
      const { data } = await api.get("/api/students/filter-options/");
      return data;
    } catch (err) {
      console.warn(
        "studentsAPI.getFilterOptions failed:",
        err?.response?.data || err.message
      );
      return {};
    }
  },

  create: async (payload) => {
    try {
      const { data } = await api.post("/api/students/", payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to create student");
    }
  },

  update: async (id, payload) => {
    try {
      const { data } = await api.patch(`/api/students/${id}/`, payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to update student");
    }
  },

  // Real matching engine, paginated by BUILDING (primary key). Returns
  // { feasible, reason, buildings: [building → apartments → rooms → beds],
  //   loaded_buildings, total_buildings, total_apartments, total_rooms,
  //   total_valid_beds, has_more, next_offset, counts, conflict_examples,
  //   data_integrity }.
  // Every returned building carries its COMPLETE apartment/room/bed
  // subtree (real Bed records only - browsing is strictly read-only and
  // never creates rows). limit/offset count buildings, not beds. Honors
  // the same hard constraints (gender, housing type, capacity, region,
  // active status) the backend enforces when the assignment is actually
  // made. regionId override is central-admin only (ignored server-side for
  // regional users).
  getAvailableBeds: async (studentId, opts = {}) => {
    try {
      const { data } = await api.post("/api/requests/match-options/", {
        student_id: studentId,
        same_apartment: opts.sameApartment ?? null,
        region_id: opts.regionId ?? undefined,
        limit: opts.limit ?? 10,
        offset: opts.offset ?? 0,
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load available beds"));
    }
  },

  assignBed: async (studentId, roomId, bedId) => {
    try {
      const { data } = await api.post("/api/room-assignments/assign/", {
        student_id: studentId,
        room_id: roomId,
        bed_id: bedId ?? undefined,
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to assign bed"));
    }
  },

  reassignBed: async (studentId, roomId, bedId) => {
    try {
      const { data } = await api.post("/api/room-assignments/move/", {
        student_id: studentId,
        room_id: roomId,
        bed_id: bedId ?? undefined,
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to reassign bed"));
    }
  },

  unassignBed: async (studentId) => {
    try {
      const { data } = await api.post("/api/room-assignments/unassign/", {
        student_id: studentId,
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to unassign bed"));
    }
  },

  getRequests: async (studentId) => {
    try {
      const { data } = await api.get("/api/requests/", {
        params: { student: studentId },
      });
      return Array.isArray(data) ? data : data.results || [];
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load student requests"));
    }
  },
};

export const analysisAPI = {
  getData: async (regionId = null) => {
    try {
      const { data } = await api.get("/api/analysis/", {
        params: regionId ? { region: regionId } : {},
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load analysis data"));
    }
  },
};

export const transfersAPI = {
  getAll: async () => {
    try {
      const { data } = await api.get("/api/transfers/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load transfers"));
    }
  },

  approve: async (id) => {
    try {
      const { data } = await api.put(`/api/transfers/${id}/approve/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to approve transfer"));
    }
  },

  reject: async (id, reason = "") => {
    try {
      const { data } = await api.put(`/api/transfers/${id}/reject/`, {
        reason,
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to reject transfer"));
    }
  },
};

export const requestsAPI = {
  getAll: async (params = {}) => {
    try {
      const { data } = await api.get("/api/requests/", { params });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load requests"));
    }
  },

  create: async (payload) => {
    try {
      const { data } = await api.post("/api/requests/", payload);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to create request"));
    }
  },

  approve: async (id, payload = {}) => {
    try {
      const { data } = await api.put(`/api/requests/${id}/approve/`, payload);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to approve request"));
    }
  },

  reject: async (id, reason = "") => {
    try {
      const { data } = await api.put(`/api/requests/${id}/reject/`, {
        reason,
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to reject request"));
    }
  },

  // Feasibility for an already-created (pending) request - used both for
  // room/apartment transfer requests and for add_student requests (the
  // backend computes matches from the request's stored student/student_data).
  // Same building-paged hierarchical shape as getAvailableBeds; limit/offset
  // count buildings.
  checkFeasibility: async (id, opts = {}) => {
    try {
      const { data } = await api.get(`/api/requests/${id}/feasibility/`, {
        params: { limit: opts.limit ?? 10, offset: opts.offset ?? 0 },
        signal: opts.signal,
      });
      return data;
    } catch (err) {
      if (err.code === "ERR_CANCELED" || err.name === "CanceledError") throw err;
      throw new Error(getErrorMessage(err, "Failed to check feasibility"));
    }
  },

  // Feasibility preview before a request exists yet (used by the "check
  // available options" step while composing a new room/apartment request).
  checkFeasibilityForStudent: async (
    studentId,
    requestType,
    sameApartment = null,
    opts = {}
  ) => {
    try {
      const { data } = await api.post("/api/requests/match-options/", {
        student_id: studentId,
        request_type: requestType,
        same_apartment: sameApartment,
        region_id: opts.regionId ?? undefined,
        // Transfer scope: 'same_region' searches the student's current
        // region automatically; 'cross_region' searches exactly the
        // destination regions the central admin selected (regional users
        // are rejected server-side with 403).
        transfer_scope: opts.transferScope ?? undefined,
        region_ids: opts.regionIds ?? undefined,
        limit: opts.limit ?? 10,
        offset: opts.offset ?? 0,
      }, { signal: opts.signal });
      return data;
    } catch (err) {
      if (err.code === "ERR_CANCELED" || err.name === "CanceledError") throw err;
      throw new Error(getErrorMessage(err, "Failed to check feasibility"));
    }
  },

  getAddStudentBeds: async (id, opts = {}) => {
    try {
      const { data } = await api.get(`/api/requests/${id}/feasibility/`, {
        params: { limit: opts.limit ?? 10, offset: opts.offset ?? 0 },
        signal: opts.signal,
      });
      return data;
    } catch (err) {
      if (err.code === "ERR_CANCELED" || err.name === "CanceledError") throw err;
      throw new Error(getErrorMessage(err, "Failed to load available beds"));
    }
  },
};

export const apartmentsAPI = {
  getAll: async () => {
    try {
      const { data } = await api.get("/api/apartments/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load apartments"));
    }
  },
};

export const roomsAPI = {
  getAll: async () => {
    try {
      const { data } = await api.get("/api/rooms/");
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load rooms"));
    }
  },
};

// Dormitory structure management (BuildingsPage): Building -> Apartment ->
// Room -> Bed. Named distinctly from the pre-existing `inventoryAPI`
// (housing-type inventory summary) above to avoid a name collision.
// Every write goes through throwApiError so structured backend errors
// ({field, code, message} for occupant-conflict / capacity / availability
// rules) survive as err.fieldErrors instead of being flattened into a
// single opaque string.
export const dormInventoryAPI = {
  getBuildings: async (params = {}) => {
    try {
      const { data } = await api.get("/api/buildings/", { params });
      return data;
    } catch (err) {
      throwApiError(err, "Failed to load buildings");
    }
  },
  createBuilding: async (payload) => {
    try {
      const { data } = await api.post("/api/buildings/", payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to create building");
    }
  },
  updateBuilding: async (id, payload) => {
    try {
      const { data } = await api.patch(`/api/buildings/${id}/`, payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to update building");
    }
  },

  getApartments: async (params = {}) => {
    try {
      const { data } = await api.get("/api/apartments/", { params });
      return data;
    } catch (err) {
      throwApiError(err, "Failed to load apartments");
    }
  },
  createApartment: async (payload) => {
    try {
      const { data } = await api.post("/api/apartments/", payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to create apartment");
    }
  },
  updateApartment: async (id, payload) => {
    try {
      const { data } = await api.patch(`/api/apartments/${id}/`, payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to update apartment");
    }
  },

  getRooms: async (params = {}) => {
    try {
      const { data } = await api.get("/api/rooms/", { params });
      return data;
    } catch (err) {
      throwApiError(err, "Failed to load rooms");
    }
  },
  createRoom: async (payload) => {
    try {
      const { data } = await api.post("/api/rooms/", payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to create room");
    }
  },
  updateRoom: async (id, payload) => {
    try {
      const { data } = await api.patch(`/api/rooms/${id}/`, payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to update room");
    }
  },

  getBeds: async (params = {}) => {
    try {
      const { data } = await api.get("/api/beds/", { params });
      return data;
    } catch (err) {
      throwApiError(err, "Failed to load beds");
    }
  },
  updateBed: async (id, payload) => {
    try {
      const { data } = await api.patch(`/api/beds/${id}/`, payload);
      return data;
    } catch (err) {
      throwApiError(err, "Failed to update bed");
    }
  },
};

export const whatIfAPI = {
  simulateBuildingInactivation: async (buildingIds) => {
    try {
      const { data } = await api.post(
        "/api/what-if/building-inactivation/simulate/",
        {
          building_ids: buildingIds,
        }
      );

      return data;
    } catch (err) {
      throw new Error(
        getErrorMessage(err, "Failed to simulate building inactivation")
      );
    }
  },

  confirmBuildingInactivation: async (
    buildingIds,
    reason = "Building inactivated"
  ) => {
    try {
      const { data } = await api.post(
        "/api/what-if/building-inactivation/confirm/",
        {
          building_ids: buildingIds,
          reason,
          inactivate_buildings: true,
        }
      );

      return data;
    } catch (err) {
      throw new Error(
        getErrorMessage(err, "Failed to confirm building inactivation")
      );
    }
  },

  simulateAvailabilityChange: async ({
    targetType,
    targetIds,
    action = "inactivate",
  }) => {
    try {
      const { data } = await api.post("/api/what-if/availability/simulate/", {
        target_type: targetType,
        target_ids: targetIds,
        action,
      });

      return data;
    } catch (err) {
      throw new Error(
        getErrorMessage(err, "Failed to simulate availability change")
      );
    }
  },

  confirmAvailabilityChange: async ({
    targetType,
    targetIds,
    action = "inactivate",
    reason = "Availability changed",
  }) => {
    try {
      const { data } = await api.post("/api/what-if/availability/confirm/", {
        target_type: targetType,
        target_ids: targetIds,
        action,
        reason,
      });

      return data;
    } catch (err) {
      throw new Error(
        getErrorMessage(err, "Failed to confirm availability change")
      );
    }
  },
};

export const regionsAPI = {
  getAll: async () => {
    try {
      const { data } = await api.get('/api/regions/');
      return Array.isArray(data) ? data : (data.results || []);
    } catch (err) {
      throw new Error(getErrorMessage(err, 'Failed to load regions'));
    }
  },
};

export const reportsAPI = {
  downloadDormifyReport: async () => {
    return api.get('/api/reports/dormify-report/', { responseType: 'blob' });
  },

  // Legacy: kept for backward compat
  downloadStudentAllocationReport: async () => {
    return api.get('/api/reports/student-allocation-report/', { responseType: 'blob' });
  },

  downloadStudentActionsReport: async (regionId = null) => {
    const params = regionId ? { region_id: regionId } : {};
    return api.get('/api/reports/student-actions-report/', { responseType: 'blob', params });
  },

  downloadCapacityReport: async (regionId = null) => {
    const params = regionId ? { region_id: regionId } : {};
    return api.get('/api/reports/capacity-report/', { responseType: 'blob', params });
  },

  downloadManualReviewReport: async (regionId = null) => {
    const params = regionId ? { region_id: regionId } : {};
    return api.get('/api/reports/manual-review-report/', { responseType: 'blob', params });
  },
};

export const debugAuthAPI = {
  getAccessToken,
  getRefreshToken,
  clearStoredAuth,
};
