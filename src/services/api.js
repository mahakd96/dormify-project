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

const getErrorMessage = (err, fallback = "Request failed") => {
  const data = err?.response?.data;
  const status = err?.response?.status;

  if (typeof data === "string" && data.trim()) {
    return data.length > 400
      ? `${status || ""} ${data.slice(0, 400)}…`
      : data;
  }

  if (data?.detail) return data.detail;
  if (data?.error) return data.error;
  if (data?.message) return data.message;
  if (data?.non_field_errors?.length) return data.non_field_errors[0];

  if (!err?.response) {
    const code = err?.code ? ` [${err.code}]` : "";
    return `${fallback}: no response from server${code} — ${
      err?.message || "Network Error"
    }`;
  }

  return `${fallback}: HTTP ${status || "?"} with empty/unknown body`;
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

  results: async (regionId = null) => {
    try {
      const url = regionId
        ? `/api/allocation/results/?region=${regionId}`
        : "/api/allocation/results/";
      const { data } = await api.get(url);
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

  getStudents: async (params = {}) => {
    try {
      const { data } = await api.get("/api/students/", { params });
      return data;
    } catch (err) {
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
          isStatus(s, ["staying", "stay", "נשאר"])
        ).length;

        const newStudents = list.filter((s) =>
          isStatus(s, ["new", "incoming", "חדש", "נכנס"])
        ).length;

        const transferring = list.filter((s) =>
          isStatus(s, ["transferring", "transfer", "מעבר", "עובר"])
        ).length;

        const leaving = list.filter((s) =>
          isStatus(s, ["leaving", "leave", "עזיבה", "עוזב"])
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
};

export const analysisAPI = {
  getData: async () => {
    try {
      const { data } = await api.get("/api/analysis/");
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
      const { data } = await api.get("/api/transfers/", { params });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load requests"));
    }
  },

  create: async (payload) => {
    try {
      const { data } = await api.post("/api/transfers/", payload);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to create request"));
    }
  },

  approve: async (id, payload = {}) => {
    try {
      const { data } = await api.put(`/api/transfers/${id}/approve/`, payload);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to approve request"));
    }
  },

  reject: async (id, reason = "") => {
    try {
      const { data } = await api.put(`/api/transfers/${id}/reject/`, {
        reason,
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to reject request"));
    }
  },

  checkFeasibility: async (id) => {
    try {
      const { data } = await api.get(`/api/transfers/${id}/feasibility/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to check feasibility"));
    }
  },

  checkFeasibilityForStudent: async (
    studentId,
    requestType,
    sameApartment = false
  ) => {
    try {
      const { data } = await api.get("/api/transfers/check-feasibility/", {
        params: {
          student_id: studentId,
          request_type: requestType,
          same_apartment: sameApartment,
        },
      });
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to check feasibility"));
    }
  },

  getAddStudentBeds: async (id) => {
    try {
      const { data } = await api.get(`/api/transfers/${id}/add-student-beds/`);
      return data;
    } catch (err) {
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

export const debugAuthAPI = {
  getAccessToken,
  getRefreshToken,
  clearStoredAuth,
};