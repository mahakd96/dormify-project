const API_BASE_URL =
  process.env.REACT_APP_API_URL || 'http://localhost:8000/api';

function getAccessToken() {
  return localStorage.getItem('dormify_access_token');
}

async function apiRequest(path, options = {}) {
  const token = getAccessToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.detail ||
      data?.email?.[0] ||
      data?.role?.[0] ||
      data?.regionId?.[0] ||
      data?.non_field_errors?.[0] ||
      'The request could not be completed.';

    const error = new Error(message);
    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

function normalizeCollection(data) {
  if (Array.isArray(data)) {
    return data;
  }

  return data?.results || [];
}

export async function fetchStaffUsers() {
  const data = await apiRequest('/staff-users/');
  return normalizeCollection(data);
}

export async function fetchRegions() {
  const data = await apiRequest('/regions/');
  return normalizeCollection(data);
}

export async function createStaffUser(userData) {
  return apiRequest('/staff-users/', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
}