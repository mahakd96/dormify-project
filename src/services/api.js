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
// api.js — replace getErrorMessage with this
const getErrorMessage = (err, fallback = "Request failed") => {
  const data = err?.response?.data;
  const status = err?.response?.status;

  if (typeof data === "string" && data.trim()) {
    return data.length > 400 ? `${status || ""} ${data.slice(0, 400)}…` : data;
  }
  if (data?.detail) return data.detail;
  if (data?.error) return data.error;
  if (data?.message) return data.message;
  if (data?.non_field_errors?.length) return data.non_field_errors[0];


  if (!err?.response) {
    const code = err?.code ? ` [${err.code}]` : "";
    return `${fallback}: no response from server${code} — ${err?.message || "Network Error"}`;
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
  async (error) => {
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: async (email, password) => {
    try {
      const { data } = await api.post("/api/auth/login/", { email, password });

      const access = pickAccessToken(data);
      const refresh = pickRefreshToken(data);

      if (!access) {
        throw new Error("Login succeeded but no access token was returned.");
      }

      localStorage.setItem(STORAGE_KEYS.access, access);

      if (refresh) {
        localStorage.setItem(STORAGE_KEYS.refresh, refresh);
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
      const body = {
        region: regionId,
        ...payload,
      };

      const { data } = await api.post("/api/allocation/run/", body);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Allocation run failed"));
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
      throw new Error(getErrorMessage(err, "Failed to mark inbox item as processed"));
    }
  },
};

export const uploadAPI = {
  uploadExcel: async (file) => {
    try {
      const form = new FormData();
      form.append("file", file);

      const { data } = await api.post("/api/upload/excel/", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Excel upload failed"));
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

  getById: async (id) => {
    try {
      const { data } = await api.get(`/api/students/${id}/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to load student"));
    }
  },
};

export const analysisAPI = {
  getData: async () => {
    const { data } = await api.get("/api/analysis/");
    return data;
  },
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

  reject: async (id) => {
    try {
      const { data } = await api.put(`/api/transfers/${id}/reject/`);
      return data;
    } catch (err) {
      throw new Error(getErrorMessage(err, "Failed to reject transfer"));
    }
  },
};


export const debugAuthAPI = {
  getAccessToken,
  getRefreshToken,
  clearStoredAuth,
};