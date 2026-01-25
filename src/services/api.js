/**
 * DORMIFY - API Service
 * Handles all HTTP requests to the backend
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

// Token management
const getAccessToken = () => localStorage.getItem('dormify_access_token');
const getRefreshToken = () => localStorage.getItem('dormify_refresh_token');
const setTokens = (access, refresh) => {
  localStorage.setItem('dormify_access_token', access);
  localStorage.setItem('dormify_refresh_token', refresh);
};
const clearTokens = () => {
  localStorage.removeItem('dormify_access_token');
  localStorage.removeItem('dormify_refresh_token');
  localStorage.removeItem('dormify_user');
};

// Request helper with auth
const request = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getAccessToken();

  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);

    // Handle 401 - try refresh token
    if (response.status === 401 && getRefreshToken()) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry with new token
        config.headers['Authorization'] = `Bearer ${getAccessToken()}`;
        const retryResponse = await fetch(url, config);
        return handleResponse(retryResponse);
      }
    }

    return handleResponse(response);
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
};

const handleResponse = async (response) => {
  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    // More detailed error messages
    if (response.status === 401) {
      throw new Error('יש להתחבר מחדש');
    }
    if (response.status === 403) {
      throw new Error('אין לך הרשאה לפעולה זו');
    }
    if (response.status === 500) {
      throw new Error(data.error || 'שגיאת שרת - אנא נסה שנית');
    }
    const error = data.error || data.detail || data.message || `שגיאה: ${response.status}`;
    throw new Error(error);
  }

  return data;
};

const refreshAccessToken = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: getRefreshToken() }),
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('dormify_access_token', data.access);
      return true;
    }

    clearTokens();
    return false;
  } catch {
    clearTokens();
    return false;
  }
};

// File upload helper
const uploadFile = async (endpoint, file, additionalData = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  const token = getAccessToken();

  if (!token) {
    throw new Error('יש להתחבר לפני העלאת קובץ');
  }

  const formData = new FormData();
  formData.append('file', file);
  Object.entries(additionalData).forEach(([key, value]) => {
    formData.append(key, value);
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    return handleResponse(response);
  } catch (error) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('לא ניתן להתחבר לשרת - ודא שהשרת פועל');
    }
    throw error;
  }
};

// ===========================================
// AUTH API
// ===========================================
export const authAPI = {
  login: async (email, password) => {
    const data = await request('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data.tokens) {
      setTokens(data.tokens.access, data.tokens.refresh);
      localStorage.setItem('dormify_user', JSON.stringify(data.user));
    }

    return data;
  },

  register: async (userData) => {
    const data = await request('/auth/register/', {
      method: 'POST',
      body: JSON.stringify(userData),
    });

    if (data.tokens) {
      setTokens(data.tokens.access, data.tokens.refresh);
      localStorage.setItem('dormify_user', JSON.stringify(data.user));
    }

    return data;
  },

  logout: () => {
    clearTokens();
  },

  getMe: () => request('/auth/me/'),

  changePassword: (currentPassword, newPassword) =>
    request('/auth/change-password/', {
      method: 'PUT',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),
};

// ===========================================
// UPLOAD API
// ===========================================
export const uploadAPI = {
  uploadExcel: (file) => uploadFile('/upload/excel/', file),

  getBatches: () => request('/batches/'),
};

// ===========================================
// INBOX API
// ===========================================
export const inboxAPI = {
  getAll: () => request('/inbox/'),

  getLatest: () => request('/inbox/latest/'),

  markViewed: (inboxId) => request(`/inbox/${inboxId}/viewed/`, { method: 'PUT' }),

  markProcessed: (inboxId) => request(`/inbox/${inboxId}/processed/`, { method: 'PUT' }),
};

// ===========================================
// REGIONS API
// ===========================================
export const regionsAPI = {
  getAll: () => request('/regions/'),

  getById: (id) => request(`/regions/${id}/`),
};

// ===========================================
// BUILDINGS API
// ===========================================
export const buildingsAPI = {
  getAll: () => request('/buildings/'),

  getById: (id) => request(`/buildings/${id}/`),

  getApartments: (buildingId) => request(`/buildings/${buildingId}/apartments/`),

  getRooms: (buildingId, availableOnly = false) =>
    request(`/buildings/${buildingId}/rooms/?available=${availableOnly}`),
};

// ===========================================
// STUDENTS API
// ===========================================
export const studentsAPI = {
  getAll: (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return request(`/students/${queryString ? '?' + queryString : ''}`);
  },

  getById: (id) => request(`/students/${id}/`),

  create: (studentData) => request('/students/', {
    method: 'POST',
    body: JSON.stringify(studentData),
  }),

  update: (id, studentData) => request(`/students/${id}/`, {
    method: 'PUT',
    body: JSON.stringify(studentData),
  }),

  delete: (id) => request(`/students/${id}/`, { method: 'DELETE' }),

  assignRoom: (studentId, roomId) => request(`/students/${studentId}/assign_room/`, {
    method: 'POST',
    body: JSON.stringify({ room_id: roomId }),
  }),

  unassignRoom: (studentId) => request(`/students/${studentId}/unassign_room/`, {
    method: 'POST',
  }),
};

// ===========================================
// TRANSFERS API
// ===========================================
export const transfersAPI = {
  getAll: () => request('/transfers/'),

  getById: (id) => request(`/transfers/${id}/`),

  create: (transferData) => request('/transfers/', {
    method: 'POST',
    body: JSON.stringify(transferData),
  }),

  approve: (id) => request(`/transfers/${id}/approve/`, { method: 'PUT' }),

  reject: (id, reason) => request(`/transfers/${id}/reject/`, {
    method: 'PUT',
    body: JSON.stringify({ reason }),
  }),
};

// ===========================================
// ALLOCATION API
// ===========================================
export const allocationAPI = {
  getSummary: () => request('/allocation/summary/'),

  run: (regionId) => request('/allocation/run/', {
    method: 'POST',
    body: JSON.stringify({ region_id: regionId }),
  }),

  getHistory: () => request('/allocation/history/'),
};

// ===========================================
// STATISTICS API
// ===========================================
export const statisticsAPI = {
  get: () => request('/statistics/'),
};

export default {
  auth: authAPI,
  upload: uploadAPI,
  inbox: inboxAPI,
  regions: regionsAPI,
  buildings: buildingsAPI,
  students: studentsAPI,
  transfers: transfersAPI,
  allocation: allocationAPI,
  statistics: statisticsAPI,
};