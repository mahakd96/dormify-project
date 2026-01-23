import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { users, dormOffices, regions } from '../data/mockData';

// ------------------------------------
// Context Setup
// ------------------------------------
const AuthContext = createContext(null);
const STORAGE_KEY = 'dormify_auth_user';

// ------------------------------------
// Helpers
// ------------------------------------
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const safeArray = (x) => (Array.isArray(x) ? x : []);
const getOfficeById = (officeId) => dormOffices.find((o) => o.id === officeId) || null;
const getAllRegionIds = () => regions.map((r) => r.id);

// ------------------------------------
// Provider
// ------------------------------------
export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [authError, setAuthError] = useState('');

  // ------------------------------------
  // Restore session from localStorage
  // ------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.id) setCurrentUser(parsed);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  // ------------------------------------
  // Persist session
  // ------------------------------------
  useEffect(() => {
    if (!currentUser) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
  }, [currentUser]);

  // ------------------------------------
  // Auth Actions
  // ------------------------------------
  const logout = useCallback(() => {
    setAuthError('');
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  /**
   * LOGIN
   * Returns:
   *   - user object on success
   *   - null on failure
   */
  const login = useCallback(async (email, password) => {
    setAuthError('');

    const e = normalizeEmail(email);
    const p = String(password || '');

    const found = (users || []).find(
      (u) => normalizeEmail(u.email) === e && String(u.password) === p
    );

    if (!found) {
      setCurrentUser(null);
      setAuthError('התחברות נכשלה. בדוק/י פרטים ונסה/י שוב.');
      return null;
    }

    // Strong session stabilization
    localStorage.setItem(STORAGE_KEY, JSON.stringify(found));
    setCurrentUser(found);
    return found;
  }, []);

  // ------------------------------------
  // Role & Identity
  // ------------------------------------
  const isAuthenticated = !!currentUser;
  const rbacRole = currentUser?.rbacRole || null;

  const isMainRole = rbacRole === 'main_employee' || rbacRole === 'main_manager';
  const isRegionalRole = rbacRole === 'regional_employee' || rbacRole === 'regional_manager';
  const isRegionalManager = rbacRole === 'regional_manager';
  const isRegionalEmployee = rbacRole === 'regional_employee';

  // ------------------------------------
  // Office Scope
  // ------------------------------------
  const userOffice = useMemo(() => {
    if (!currentUser?.officeId) return null;
    return getOfficeById(currentUser.officeId);
  }, [currentUser]);

  const userOfficeRegionIds = useMemo(() => safeArray(userOffice?.regionIds), [userOffice]);

  // Legacy fallback (for older pages)
  const getUserPrimaryRegion = useCallback(() => {
    return currentUser?.primaryRegionId || currentUser?.regionId || null;
  }, [currentUser]);

  // ------------------------------------
  // RBAC — VIEW PERMISSION
  // ------------------------------------
  const canViewRegion = useCallback(
    (regionId) => {
      if (!isAuthenticated || !regionId) return false;

      // Main office: view everything
      if (isMainRole) return true;

      // Regional manager: view everything
      if (isRegionalManager) return true;

      // Regional employee: only office regions
      if (isRegionalEmployee) return userOfficeRegionIds.includes(regionId);

      return false;
    },
    [isAuthenticated, isMainRole, isRegionalManager, isRegionalEmployee, userOfficeRegionIds]
  );

  // ------------------------------------
  // RBAC — EDIT PERMISSION
  // ------------------------------------
  const canEditRegion = useCallback(
    (regionId) => {
      if (!isAuthenticated || !regionId) return false;

      // Main office: edit everything
      if (isMainRole) return true;

      // Regional roles: only their office regions
      if (isRegionalRole) return userOfficeRegionIds.includes(regionId);

      return false;
    },
    [isAuthenticated, isMainRole, isRegionalRole, userOfficeRegionIds]
  );

  // ------------------------------------
  // Region Lists
  // ------------------------------------
  const getVisibleRegionIds = useCallback(() => {
    if (!isAuthenticated) return [];

    if (isMainRole) return getAllRegionIds();
    if (isRegionalManager) return getAllRegionIds();
    if (isRegionalEmployee) return userOfficeRegionIds.slice();

    return [];
  }, [isAuthenticated, isMainRole, isRegionalManager, isRegionalEmployee, userOfficeRegionIds]);

  const getEditableRegionIds = useCallback(() => {
    if (!isAuthenticated) return [];

    if (isMainRole) return getAllRegionIds();
    if (isRegionalRole) return userOfficeRegionIds.slice();

    return [];
  }, [isAuthenticated, isMainRole, isRegionalRole, userOfficeRegionIds]);

  // ------------------------------------
  // Backward Compatibility (old code API)
  // ------------------------------------
  const canAccessRegion = canViewRegion;

  // Old code expects these:
  const user = currentUser; // alias
  const loading = false; // no async backend loading

  const isCentralAdmin = useCallback(() => {
    // Old meaning: "central office"
    return isMainRole;
  }, [isMainRole]);

  const getUserRegion = useCallback(() => {
    return currentUser?.primaryRegionId || currentUser?.regionId || null;
  }, [currentUser]);

  // ------------------------------------
  // LEGACY PERMISSIONS PACK (stops the endless errors)
  // ------------------------------------
  const canUploadExcel = useCallback(() => {
    if (!currentUser) return false;
    const role = currentUser?.rbacRole;
    if (role === 'main_employee' || role === 'main_manager') return true;
    if (role === 'regional_manager') return true; // optional, you can set to false if needed
    return false;
  }, [currentUser]);

  const canAssignPriority = useCallback(() => {
    if (!currentUser) return false;
    const role = currentUser?.rbacRole;
    if (role === 'main_employee' || role === 'main_manager') return true;
    if (role === 'regional_manager') return true;
    return false;
  }, [currentUser]);

  const canManageUsers = useCallback(() => {
    // Users management is usually MAIN OFFICE only (strong governance).
    if (!currentUser) return false;
    const role = currentUser?.rbacRole;
    return role === 'main_employee' || role === 'main_manager';
  }, [currentUser]);

  const canViewReports = useCallback(() => {
    // Everyone who can "see system wide" can see reports:
    // main roles + regional manager; regional employee can see only their scope anyway.
    if (!currentUser) return false;
    const role = currentUser?.rbacRole;
    if (role === 'main_employee' || role === 'main_manager') return true;
    if (role === 'regional_manager') return true;
    // allow regional_employee too if your UI needs it:
    return role === 'regional_employee';
  }, [currentUser]);

  const canManageTransfers = useCallback(() => {
    // Transfers: main roles always; regional roles often yes (within office scope).
    if (!currentUser) return false;
    const role = currentUser?.rbacRole;
    if (role === 'main_employee' || role === 'main_manager') return true;
    if (role === 'regional_manager' || role === 'regional_employee') return true;
    return false;
  }, [currentUser]);

  const canEditBuildings = useCallback(() => {
    // Editing buildings: should follow edit scope (main or office scope).
    return !!currentUser; // the page itself should still use canEditRegion(regionId)
  }, [currentUser]);

  const canEditStudents = useCallback(() => {
    // Similar: allow page render; actual edit should check canEditRegion(student.regionId)
    return !!currentUser;
  }, [currentUser]);

  const canAccessMap = useCallback(() => {
    return !!currentUser;
  }, [currentUser]);

  // ------------------------------------
  // Optional Capabilities
  // ------------------------------------
  const canRunAllocation = useCallback(
    (regionId) => {
      if (!isAuthenticated) return false;

      // Main: always allowed
      if (isMainRole) return true;

      // Regional manager: only office regions
      if (isRegionalManager && regionId) return userOfficeRegionIds.includes(regionId);

      return false;
    },
    [isAuthenticated, isMainRole, isRegionalManager, userOfficeRegionIds]
  );

  // ------------------------------------
  // Context Value
  // ------------------------------------
  const value = useMemo(
    () => ({
      // State
      currentUser,
      authError,
      isAuthenticated,

      // Old aliases (fix crashes)
      user,
      loading,

      // Actions
      login,
      logout,

      // Identity
      rbacRole,
      userOffice,
      getUserPrimaryRegion,

      // Role Flags
      isMainRole,
      isRegionalRole,
      isRegionalManager,
      isRegionalEmployee,

      // Old helpers expected by existing UI
      isCentralAdmin,
      getUserRegion,

      // Legacy permission helpers
      canUploadExcel,
      canAssignPriority,
      canManageUsers,
      canViewReports,
      canManageTransfers,
      canEditBuildings,
      canEditStudents,
      canAccessMap,

      // Permissions
      canViewRegion,
      canEditRegion,
      canAccessRegion,
      getVisibleRegionIds,
      getEditableRegionIds,

      // Capabilities
      canRunAllocation,
    }),
    [
      currentUser,
      authError,
      isAuthenticated,
      user,
      loading,
      login,
      logout,
      rbacRole,
      userOffice,
      getUserPrimaryRegion,
      isMainRole,
      isRegionalRole,
      isRegionalManager,
      isRegionalEmployee,
      isCentralAdmin,
      getUserRegion,
      canUploadExcel,
      canAssignPriority,
      canManageUsers,
      canViewReports,
      canManageTransfers,
      canEditBuildings,
      canEditStudents,
      canAccessMap,
      canViewRegion,
      canEditRegion,
      canAccessRegion,
      getVisibleRegionIds,
      getEditableRegionIds,
      canRunAllocation,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ------------------------------------
// Hook
// ------------------------------------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
