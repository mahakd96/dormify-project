import React, { createContext, useContext, useState, useEffect } from 'react';
import { users } from '../data/mockData';

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

  useEffect(() => {
    // Check for saved user in localStorage
    const savedUser = localStorage.getItem('dormify_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = (email, password) => {
    const foundUser = users.find(
      u => u.email === email && u.password === password
    );
    
    if (foundUser) {
      const userWithoutPassword = { ...foundUser };
      delete userWithoutPassword.password;
      setUser(userWithoutPassword);
      localStorage.setItem('dormify_user', JSON.stringify(userWithoutPassword));
      return { success: true, user: userWithoutPassword };
    }
    
    return { success: false, error: 'אימייל או סיסמה שגויים' };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('dormify_user');
  };

  // Permission helpers
  const isCentralAdmin = () => user?.role === 'central_admin';
  const isRegionBoss = () => user?.role === 'region_boss';
  const isEmployee = () => user?.role === 'employee';
  const canApproveTransfers = () => isCentralAdmin() || isRegionBoss();
  const canManageUsers = () => isCentralAdmin() || isRegionBoss();
  const canUploadExcel = () => isCentralAdmin();
  const canAssignPriority = () => isCentralAdmin();
  const canRunAllocation = () => isCentralAdmin() || isRegionBoss();
  
  const getUserRegion = () => user?.regionId || null;
  
  const canAccessRegion = (regionId) => {
    if (isCentralAdmin()) return true;
    return user?.regionId === regionId;
  };

  const value = {
    user,
    loading,
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
