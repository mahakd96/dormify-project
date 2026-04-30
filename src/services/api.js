import axios from "axios";

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
});

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

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("dormify_access_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("dormify_access_token");
      localStorage.removeItem("dormify_refresh_token");
      localStorage.removeItem("dormify_user");
    }
    return Promise.reject(err);
  }
);

export const authAPI = {
  login: async (email, password) => {
    const { data } = await api.post("/api/auth/login/", { email, password });

    const access = pickAccessToken(data);
    const refresh = pickRefreshToken(data);

    if (access) localStorage.setItem("dormify_access_token", access);
    if (refresh) localStorage.setItem("dormify_refresh_token", refresh);

    return data;
  },

  getMe: async () => {
    const { data } = await api.get("/api/auth/me/");
    return data;
  },

  logout: async () => {
    localStorage.removeItem("dormify_access_token");
    localStorage.removeItem("dormify_refresh_token");
    localStorage.removeItem("dormify_user");
  },
};

export const allocationAPI = {
  getSummary: async () => {
    const { data } = await api.get("/api/allocation/summary/");
    return data;
  },

  run: async (regionId, payload) => {
    const body = { region: regionId, ...(payload || {}) };
    const { data } = await api.post("/api/allocation/run/", body);
    return data;
  },

  history: async () => {
    const { data } = await api.get("/api/allocation/history/");
    return data;
  },
};

export const inboxAPI = {
  getLatest: async () => {
    const { data } = await api.get("/api/inbox/latest/");
    return data;
  },

  markViewed: async (id) => {
    const { data } = await api.post(`/api/inbox/${id}/viewed/`);
    return data;
  },

  markProcessed: async (id) => {
    const { data } = await api.post(`/api/inbox/${id}/processed/`);
    return data;
  },
};

export const uploadAPI = {
  uploadExcel: async (file) => {
    const form = new FormData();
    form.append("file", file);

    const { data } = await api.post("/api/upload/excel/", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    return data;
  },
};

export const analysisAPI = {
  getData: async () => {
    const { data } = await api.get("/api/analysis/");
    return data;
  },
};