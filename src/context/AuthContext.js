import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize from localStorage on mount
  useEffect(() => {
    const initAuth = async () => {
      const savedUser = localStorage.getItem('dormify_user');
      const token = localStorage.getItem('dormify_access_token');

      if (savedUser && token) {
        try {
          // Verify token is still valid
          const response = await authAPI.getMe();
          setUser(response.user);
          localStorage.setItem('dormify_user', JSON.stringify(response.user));
        } catch (err) {
          // Token invalid, clear everything
          console.log('Session expired, logging out');
          localStorage.removeItem('dormify_user');
          localStorage.removeItem('dormify_access_token');
          localStorage.removeItem('dormify_refresh_token');
          setUser(null);
        }
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    setLoading(true);

    try {
      const data = await authAPI.login(email, password);
      setUser(data.user);
      setLoading(false);
      return { success: true, user: data.user };
    } catch (err) {
      setLoading(false);
      setError(err.message);
      return { success: false, error: err.message || 'אימייל או סיסמה שגויים' };
    }
  }, []);

  const logout = useCallback(() => {
    authAPI.logout();
    setUser(null);
    setError(null);
  }, []);

  // Permission helpers
  const isCentralAdmin = useCallback(() => user?.role === 'central_admin', [user]);
  const isRegionBoss = useCallback(() => user?.role === 'region_boss', [user]);
  const isEmployee = useCallback(() => user?.role === 'employee', [user]);
  const canApproveTransfers = useCallback(() => isCentralAdmin() || isRegionBoss(), [isCentralAdmin, isRegionBoss]);
  const canManageUsers = useCallback(() => isCentralAdmin() || isRegionBoss(), [isCentralAdmin, isRegionBoss]);
  const canUploadExcel = useCallback(() => isCentralAdmin(), [isCentralAdmin]);
  const canAssignPriority = useCallback(() => isCentralAdmin(), [isCentralAdmin]);
  const canRunAllocation = useCallback(() => isCentralAdmin() || isRegionBoss(), [isCentralAdmin, isRegionBoss]);

  const getUserRegion = useCallback(() => user?.region || null, [user]);

  const canAccessRegion = useCallback((regionId) => {
    if (isCentralAdmin()) return true;
    return user?.region === regionId;
  }, [user, isCentralAdmin]);

  const value = {
    user,
    loading,
    error,
    login,
    logout,
    isCentralAdmin,
    isRegionBoss,
    isEmployee,
    canApproveTransfers,
    canManageUsers,
    canUploadExcel,
    canAssignPriority,
    canRunAllocation,
    getUserRegion,
    canAccessRegion,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};