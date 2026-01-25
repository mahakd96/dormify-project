// src/context/AuthContext.jsx
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authAPI } from "../services/api";

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};

const PERMISSIONS = Object.freeze({
  VIEW_ALL_PAGES: "VIEW_ALL_PAGES",
  EDIT_ANY_REGION: "EDIT_ANY_REGION",
  EDIT_OWN_REGION: "EDIT_OWN_REGION",
  APPROVE_WITHIN_REGION_TRANSFERS: "APPROVE_WITHIN_REGION_TRANSFERS",
  APPROVE_CROSS_REGION_TRANSFERS: "APPROVE_CROSS_REGION_TRANSFERS",
  MANAGE_USERS_ANY: "MANAGE_USERS_ANY",
  MANAGE_USERS_OWN_REGION: "MANAGE_USERS_OWN_REGION",
  UPLOAD_EXCEL: "UPLOAD_EXCEL",
  ASSIGN_PRIORITY: "ASSIGN_PRIORITY",
  RUN_ALLOCATION_ANY: "RUN_ALLOCATION_ANY",
  RUN_ALLOCATION_OWN_REGION: "RUN_ALLOCATION_OWN_REGION",
});

const ROLE_PERMISSIONS = Object.freeze({
  central_admin: [
    PERMISSIONS.VIEW_ALL_PAGES,
    PERMISSIONS.EDIT_ANY_REGION,
    PERMISSIONS.APPROVE_WITHIN_REGION_TRANSFERS,
    PERMISSIONS.APPROVE_CROSS_REGION_TRANSFERS,
    PERMISSIONS.MANAGE_USERS_ANY,
    PERMISSIONS.UPLOAD_EXCEL,
    PERMISSIONS.ASSIGN_PRIORITY,
    PERMISSIONS.RUN_ALLOCATION_ANY,
  ],
  region_boss: [
    PERMISSIONS.VIEW_ALL_PAGES,
    PERMISSIONS.EDIT_OWN_REGION,
    PERMISSIONS.APPROVE_WITHIN_REGION_TRANSFERS,
    PERMISSIONS.MANAGE_USERS_OWN_REGION,
    PERMISSIONS.RUN_ALLOCATION_OWN_REGION,
  ],
  employee: [PERMISSIONS.VIEW_ALL_PAGES],
});

const safeJsonParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);

  // This loading refers to auth initialization / login process
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ------------------------
  // Init: restore session
  // ------------------------
  useEffect(() => {
    let alive = true;

    const init = async () => {
      setLoading(true);
      setError(null);

      const savedUserRaw = localStorage.getItem("dormify_user");
      const token = localStorage.getItem("dormify_access_token");
      const savedUser = savedUserRaw ? safeJsonParse(savedUserRaw) : null;

      // If we have token, try to validate it by calling /me
      if (token) {
        try {
          const me = await authAPI.getMe();
          const freshUser = me?.user || me || null;

          if (!alive) return;

          setUser(freshUser);
          if (freshUser) localStorage.setItem("dormify_user", JSON.stringify(freshUser));
        } catch (e) {
          // token invalid/expired -> wipe
          localStorage.removeItem("dormify_access_token");
          localStorage.removeItem("dormify_refresh_token");
          localStorage.removeItem("dormify_user");

          if (!alive) return;
          setUser(null);
        }
      } else {
        // No token - if we had an old saved user, clear it
        if (savedUser) localStorage.removeItem("dormify_user");
        if (!alive) return;
        setUser(null);
      }

      if (!alive) return;
      setLoading(false);
    };

    init();

    return () => {
      alive = false;
    };
  }, []);

  // ------------------------
  // Auth actions
  // ------------------------
  const login = useCallback(async (email, password) => {
    setError(null);
    setLoading(true);

    try {
      const data = await authAPI.login(email, password);

      // authAPI.login already saves tokens in localStorage
      // Now store user in context & localStorage
      const nextUser = data?.user || null;

      setUser(nextUser);
      if (nextUser) localStorage.setItem("dormify_user", JSON.stringify(nextUser));

      setLoading(false);
      return { success: true, user: nextUser };
    } catch (err) {
      const msg =
        err?.response?.data?.detail ||
        err?.message ||
        "אימייל או סיסמה שגויים";

      setUser(null);
      setError(msg);
      setLoading(false);
      return { success: false, error: msg };
    }
  }, []);

  const logout = useCallback(() => {
    authAPI.logout();
    setUser(null);
    setError(null);
  }, []);

  // ------------------------
  // Role + permissions
  // ------------------------
  const role = user?.role || null;

  const permissions = useMemo(() => {
    const base = role ? ROLE_PERMISSIONS[role] || [] : [];
    return new Set(base);
  }, [role]);

  const hasPermission = useCallback((perm) => permissions.has(perm), [permissions]);

  const isCentralAdmin = useCallback(() => role === "central_admin", [role]);
  const isRegionBoss = useCallback(() => role === "region_boss", [role]);
  const isEmployee = useCallback(() => role === "employee", [role]);

  // ✅ Normalize region always
  const getUserRegionId = useCallback(() => user?.regionId ?? user?.region ?? null, [user]);

  const canAccessRegion = useCallback(
    (regionId) => {
      if (!user) return false;
      if (isCentralAdmin()) return true;
      const me = getUserRegionId();
      return me != null && String(me) === String(regionId);
    },
    [user, isCentralAdmin, getUserRegionId]
  );

  const canEditRegion = useCallback(
    (regionId) => {
      if (!user) return false;
      if (hasPermission(PERMISSIONS.EDIT_ANY_REGION)) return true;
      if (hasPermission(PERMISSIONS.EDIT_OWN_REGION)) {
        const me = getUserRegionId();
        return me != null && String(me) === String(regionId);
      }
      return false;
    },
    [user, hasPermission, getUserRegionId]
  );

  // ✅ Sidebar alias
  const canManageUsers = useCallback(() => {
    if (!user) return false;
    if (hasPermission(PERMISSIONS.MANAGE_USERS_ANY)) return true;
    if (hasPermission(PERMISSIONS.MANAGE_USERS_OWN_REGION)) return true;
    return false;
  }, [user, hasPermission]);

  const canManageUsersInRegion = useCallback(
    (regionId) => {
      if (!user) return false;
      if (hasPermission(PERMISSIONS.MANAGE_USERS_ANY)) return true;
      if (hasPermission(PERMISSIONS.MANAGE_USERS_OWN_REGION)) {
        const me = getUserRegionId();
        return me != null && String(me) === String(regionId);
      }
      return false;
    },
    [user, hasPermission, getUserRegionId]
  );

  const canRunAllocationForRegion = useCallback(
    (regionId) => {
      if (!user) return false;
      if (hasPermission(PERMISSIONS.RUN_ALLOCATION_ANY)) return true;
      if (hasPermission(PERMISSIONS.RUN_ALLOCATION_OWN_REGION)) {
        const me = getUserRegionId();
        return me != null && String(me) === String(regionId);
      }
      return false;
    },
    [user, hasPermission, getUserRegionId]
  );

  // ✅ AllocationPage expects this
  const canRunAllocation = useCallback(() => {
    if (!user) return false;
    if (hasPermission(PERMISSIONS.RUN_ALLOCATION_ANY)) return true;
    if (hasPermission(PERMISSIONS.RUN_ALLOCATION_OWN_REGION)) return true;
    return false;
  }, [user, hasPermission]);

  // -------- Transfers helpers --------
  const getTransferFromRegion = useCallback((transfer) => {
    return (
      transfer?.fromRegionId ??
      transfer?.fromRegion ??
      transfer?.sourceRegionId ??
      transfer?.currentRegionId ??
      null
    );
  }, []);

  const getTransferToRegion = useCallback((transfer) => {
    return (
      transfer?.toRegionId ??
      transfer?.toRegion ??
      transfer?.targetRegionId ??
      transfer?.requestedRegionId ??
      null
    );
  }, []);

  const isCrossRegionTransfer = useCallback(
    (transfer) => {
      const from = getTransferFromRegion(transfer);
      const to = getTransferToRegion(transfer);
      if (!from || !to) return false;
      return String(from) !== String(to);
    },
    [getTransferFromRegion, getTransferToRegion]
  );

  const isWithinMyRegionTransfer = useCallback(
    (transfer) => {
      const me = getUserRegionId();
      const from = getTransferFromRegion(transfer);
      const to = getTransferToRegion(transfer);
      if (!me || !from || !to) return false;
      return String(from) === String(me) && String(to) === String(me);
    },
    [getUserRegionId, getTransferFromRegion, getTransferToRegion]
  );

  const canApproveTransfer = useCallback(
    (transfer) => {
      if (!user) return false;

      const cross = isCrossRegionTransfer(transfer);

      if (cross) {
        return hasPermission(PERMISSIONS.APPROVE_CROSS_REGION_TRANSFERS);
      }

      if (hasPermission(PERMISSIONS.APPROVE_WITHIN_REGION_TRANSFERS)) {
        if (isCentralAdmin()) return true;
        return isWithinMyRegionTransfer(transfer);
      }

      return false;
    },
    [user, hasPermission, isCrossRegionTransfer, isCentralAdmin, isWithinMyRegionTransfer]
  );

  const canUploadExcel = useCallback(() => isCentralAdmin(), [isCentralAdmin]);
  const canAssignPriority = useCallback(() => isCentralAdmin(), [isCentralAdmin]);

  const value = {
    user,
    loading,
    error,
    login,
    logout,

    PERMISSIONS,
    hasPermission,

    isCentralAdmin,
    isRegionBoss,
    isEmployee,

    getUserRegion: getUserRegionId,
    getUserRegionId,

    canAccessRegion,
    canEditRegion,

    canManageUsers,
    canManageUsersInRegion,

    canRunAllocation,
    canRunAllocationForRegion,

    canApproveTransfer,
    isCrossRegionTransfer,
    isWithinMyRegionTransfer,
    getTransferFromRegion,
    getTransferToRegion,

    canUploadExcel,
    canAssignPriority,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
