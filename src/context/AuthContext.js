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

  ASSIST_ALLOCATION_ANY: "ASSIST_ALLOCATION_ANY",
  ASSIST_ALLOCATION_OWN_REGION: "ASSIST_ALLOCATION_OWN_REGION",
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
    PERMISSIONS.ASSIST_ALLOCATION_ANY,
  ],

  region_boss: [
    PERMISSIONS.VIEW_ALL_PAGES,
    PERMISSIONS.EDIT_OWN_REGION,
    PERMISSIONS.APPROVE_WITHIN_REGION_TRANSFERS,
    PERMISSIONS.MANAGE_USERS_OWN_REGION,
    PERMISSIONS.RUN_ALLOCATION_OWN_REGION,
    PERMISSIONS.ASSIST_ALLOCATION_OWN_REGION,
  ],

  employee: [
    PERMISSIONS.VIEW_OWN_REGION_ONLY,
    PERMISSIONS.EDIT_OWN_REGION,
    PERMISSIONS.ASSIST_ALLOCATION_OWN_REGION,
  ],
});

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

    // G3-14/G3-16/G3-17: session restoration on app load no longer reads
    // any token from localStorage (none is stored there any more) - it
    // asks the backend to mint a fresh access token from the HttpOnly
    // refresh cookie instead. No valid cookie -> no session, exactly like
    // a first visit or an explicit logout.
    const init = async () => {
      setLoading(true);
      setError(null);

      try {
        const restored = await authAPI.restoreSession();
        if (!alive) return;
        setUser(restored ? normalizeUser(restored.user) : null);
      } catch {
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
    // Deliberately does not touch the shared `loading` flag: that flag
    // gates the initial "is there a valid session" check on app boot
    // (see the init() effect above), and App.js's /login route unmounts
    // LoginPage while it's true. Toggling it here would unmount LoginPage
    // mid-submit on every attempt, wiping its error state and typed
    // fields. Per-submit loading is LoginPage's own local isLoading state.
    setError(null);

    try {
      const data = await authAPI.login(email, password);

      const nextUser = normalizeUser(data?.user || data || null);

      if (!nextUser) {
        throw new Error("Login succeeded but user payload is missing");
      }

      // G3-17: user profile is kept in React state only - login() already
      // stored the access token in memory (services/api.js), and the
      // refresh token was set as an HttpOnly cookie by the backend. Never
      // written to localStorage.
      setUser(nextUser);

      return { success: true, user: nextUser };
    } catch (err) {
      let msg;

      if (err?.status === 401 || err?.status === 400) {
        // Never reveal whether the email exists or only the password is
        // wrong - always show the same generic message for auth failures.
        msg = "כתובת האימייל או הסיסמה שגויים";
      } else if (!err?.status) {
        msg = "לא ניתן להתחבר למערכת כרגע. נסו שוב מאוחר יותר";
      } else {
        msg = "אירעה שגיאה לא צפויה. נסו שוב מאוחר יותר";
      }

      setUser(null);
      setError(msg);
      return { success: false, error: msg };
    }
  }, []);

  const logout = useCallback(async () => {
    // G3-14: awaited so the server-side blacklist call actually fires
    // before/alongside clearing local state - authAPI.logout() clears the
    // in-memory access token and the refresh cookie regardless of whether
    // the network call itself succeeds, so this can never leave the user
    // stuck "logged in" client-side.
    await authAPI.logout();
    setUser(null);
    setError(null);
  }, []);

  // Re-fetches the caller's own profile and updates context state - used
  // after an in-place account change (e.g. SettingsPage's change-email,
  // G3-18) so the UI reflects it immediately without a full reload.
  const refreshUser = useCallback(async () => {
    try {
      const me = await authAPI.getMe();
      const freshUser = normalizeUser(me?.user || me || null);
      setUser(freshUser);
      return freshUser;
    } catch {
      return null;
    }
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

  const canAssistAllocation = useCallback(() => {
    if (!user) return false;
    if (hasPermission(PERMISSIONS.ASSIST_ALLOCATION_ANY)) return true;
    if (hasPermission(PERMISSIONS.ASSIST_ALLOCATION_OWN_REGION)) return true;
    return false;
  }, [user, hasPermission]);

  // G3-11: overriding a placement rule is an elevated action (backend:
  // assisted_allocation_override requires is_boss) - normal in-region
  // ASSIGN stays available to any user canAssistAllocation() allows above,
  // but the override path additionally requires region_boss/central_admin.
  // This is UI convenience only; the backend check is authoritative.
  const canOverrideAllocation = useCallback(
    () => isCentralAdmin() || isRegionBoss(),
    [isCentralAdmin, isRegionBoss]
  );

  const value = {
    user,
    loading,
    error,
    login,
    logout,
    refreshUser,

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
    canAssistAllocation,
    canOverrideAllocation,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};