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
  VIEW_OWN_REGION_ONLY: "VIEW_OWN_REGION_ONLY",

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

  employee: [
    PERMISSIONS.VIEW_OWN_REGION_ONLY,
    PERMISSIONS.EDIT_OWN_REGION,
  ],
});

const safeJsonParse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const normalizeLanguage = (value) => {
  return value === "en" ? "en" : "he";
};

const normalizeRegionId = (value) => {
  if (value == null) return null;

  if (typeof value === "object") {
    return (
      value.id ??
      value.regionId ??
      value.region_id ??
      value.pk ??
      value.code ??
      value.nameEn ??
      value.name ??
      null
    );
  }

  return value;
};

const normalizeUser = (rawUser) => {
  if (!rawUser) return null;

  const normalizedRegionId = normalizeRegionId(
    rawUser.regionId ??
      rawUser.region_id ??
      rawUser.region ??
      rawUser.office?.regionId ??
      rawUser.office?.region_id ??
      rawUser.office?.region ??
      rawUser.staffProfile?.regionId ??
      rawUser.staffProfile?.region_id ??
      rawUser.staffProfile?.region ??
      rawUser.staff_profile?.regionId ??
      rawUser.staff_profile?.region_id ??
      rawUser.staff_profile?.region ??
      null
  );

  return {
    ...rawUser,
    normalizedRegionId,
  };
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [language, setLanguageState] = useState(() => {
    const saved = localStorage.getItem("dormify_language");
    return normalizeLanguage(saved);
  });

  useEffect(() => {
    const nextLanguage = normalizeLanguage(language);

    localStorage.setItem("dormify_language", nextLanguage);
    document.documentElement.lang = nextLanguage;
    document.documentElement.dir = nextLanguage === "he" ? "rtl" : "ltr";
    document.body.dir = nextLanguage === "he" ? "rtl" : "ltr";
  }, [language]);

  const setLanguage = useCallback((nextLanguage) => {
    setLanguageState(normalizeLanguage(nextLanguage));
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((prev) => (prev === "he" ? "en" : "he"));
  }, []);

  const isRTL = useMemo(() => language === "he", [language]);

  useEffect(() => {
    let alive = true;

    const init = async () => {
      setLoading(true);
      setError(null);

      const savedUserRaw = localStorage.getItem("dormify_user");
      const token = localStorage.getItem("dormify_access_token");
      const savedUser = savedUserRaw ? safeJsonParse(savedUserRaw) : null;

      if (token) {
        try {
          const me = await authAPI.getMe();
          const freshUser = normalizeUser(me?.user || me || null);

          if (!alive) return;

          setUser(freshUser);
          if (freshUser) {
            localStorage.setItem("dormify_user", JSON.stringify(freshUser));
          }
        } catch (e) {
          localStorage.removeItem("dormify_access_token");
          localStorage.removeItem("dormify_refresh_token");
          localStorage.removeItem("dormify_user");

          if (!alive) return;
          setUser(null);
        }
      } else {
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

  const login = useCallback(async (email, password) => {
    setError(null);
    setLoading(true);

    try {
      const data = await authAPI.login(email, password);

      const nextUser = normalizeUser(data?.user || data || null);

      if (!nextUser) {
        throw new Error("Login succeeded but user payload is missing");
      }

      setUser(nextUser);
      localStorage.setItem("dormify_user", JSON.stringify(nextUser));

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
    localStorage.removeItem("dormify_user");
    localStorage.removeItem("dormify_access_token");
    localStorage.removeItem("dormify_refresh_token");
    setUser(null);
    setError(null);
  }, []);

  const role = user?.role || null;

  const permissions = useMemo(() => {
    const base = role ? ROLE_PERMISSIONS[role] || [] : [];
    return new Set(base);
  }, [role]);

  const hasPermission = useCallback((perm) => permissions.has(perm), [permissions]);

  const isCentralAdmin = useCallback(() => role === "central_admin", [role]);
  const isRegionBoss = useCallback(() => role === "region_boss", [role]);
  const isEmployee = useCallback(() => role === "employee", [role]);

  const getUserRegionId = useCallback(() => {
    return user?.normalizedRegionId ?? normalizeRegionId(user?.regionId ?? user?.region ?? null);
  }, [user]);

  const canAccessRegion = useCallback(
    (regionId) => {
      if (!user) return false;

      const target = normalizeRegionId(regionId);
      const me = getUserRegionId();

      if (hasPermission(PERMISSIONS.VIEW_ALL_PAGES)) return true;

      if (hasPermission(PERMISSIONS.VIEW_OWN_REGION_ONLY)) {
        return me != null && target != null && String(me).toLowerCase() === String(target).toLowerCase();
      }

      return false;
    },
    [user, hasPermission, getUserRegionId]
  );

  const canEditRegion = useCallback(
    (regionId) => {
      if (!user) return false;

      const target = normalizeRegionId(regionId);
      const me = getUserRegionId();

      if (hasPermission(PERMISSIONS.EDIT_ANY_REGION)) return true;

      if (hasPermission(PERMISSIONS.EDIT_OWN_REGION)) {
        return me != null && target != null && String(me).toLowerCase() === String(target).toLowerCase();
      }

      return false;
    },
    [user, hasPermission, getUserRegionId]
  );

  const canManageUsers = useCallback(() => {
    if (!user) return false;
    if (hasPermission(PERMISSIONS.MANAGE_USERS_ANY)) return true;
    if (hasPermission(PERMISSIONS.MANAGE_USERS_OWN_REGION)) return true;
    return false;
  }, [user, hasPermission]);

  const canManageUsersInRegion = useCallback(
    (regionId) => {
      if (!user) return false;

      const target = normalizeRegionId(regionId);
      const me = getUserRegionId();

      if (hasPermission(PERMISSIONS.MANAGE_USERS_ANY)) return true;

      if (hasPermission(PERMISSIONS.MANAGE_USERS_OWN_REGION)) {
        return me != null && target != null && String(me).toLowerCase() === String(target).toLowerCase();
      }

      return false;
    },
    [user, hasPermission, getUserRegionId]
  );

  const canRunAllocationForRegion = useCallback(
    (regionId) => {
      if (!user) return false;

      const target = normalizeRegionId(regionId);
      const me = getUserRegionId();

      if (hasPermission(PERMISSIONS.RUN_ALLOCATION_ANY)) return true;

      if (hasPermission(PERMISSIONS.RUN_ALLOCATION_OWN_REGION)) {
        return me != null && target != null && String(me).toLowerCase() === String(target).toLowerCase();
      }

      return false;
    },
    [user, hasPermission, getUserRegionId]
  );

  const canRunAllocation = useCallback(() => {
    if (!user) return false;
    if (hasPermission(PERMISSIONS.RUN_ALLOCATION_ANY)) return true;
    if (hasPermission(PERMISSIONS.RUN_ALLOCATION_OWN_REGION)) return true;
    return false;
  }, [user, hasPermission]);

  const getTransferFromRegion = useCallback((transfer) => {
    return normalizeRegionId(
      transfer?.fromRegionId ??
        transfer?.fromRegion ??
        transfer?.sourceRegionId ??
        transfer?.currentRegionId ??
        null
    );
  }, []);

  const getTransferToRegion = useCallback((transfer) => {
    return normalizeRegionId(
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
      return String(from).toLowerCase() !== String(to).toLowerCase();
    },
    [getTransferFromRegion, getTransferToRegion]
  );

  const isWithinMyRegionTransfer = useCallback(
    (transfer) => {
      const me = getUserRegionId();
      const from = getTransferFromRegion(transfer);
      const to = getTransferToRegion(transfer);

      if (!me || !from || !to) return false;
      return (
        String(from).toLowerCase() === String(me).toLowerCase() &&
        String(to).toLowerCase() === String(me).toLowerCase()
      );
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

    language,
    setLanguage,
    toggleLanguage,
    isRTL,

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