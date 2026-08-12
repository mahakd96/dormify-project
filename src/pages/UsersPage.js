import React, { useEffect, useMemo, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import { localizeRegionName, localizeById } from '../utils/locationNames';

import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Shield,
  User,
  UserCog,
  Users,
  X,
} from 'lucide-react';

import {
  createStaffUser,
  fetchRegions,
  fetchStaffUsers,
} from '../services/usersApi';

import './UsersPage.css';

const EMPTY_FORM = {
  name: '',
  email: '',
  password: '',
  role: 'employee',
  regionId: '',
};

function UsersPage({ language = 'he' }) {
  const {
    canManageUsers,
    isCentralAdmin,
    getUserRegion,
  } = useAuth();

  const isHebrew = language === 'he';
  const currentRegionId = getUserRegion();

  const hasManagementAccess = Boolean(canManageUsers?.());

  const [users, setUsers] = useState([]);
  const [regions, setRegions] = useState([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [form, setForm] = useState(EMPTY_FORM);

  const [filters, setFilters] = useState({
    search: '',
    role: 'all',
    regionId: 'all',
  });

  const translations = {
    he: {
      title: 'ניהול משתמשים',
      subtitle: 'ניהול מאובטח של צוות המערכת והרשאות לפי אזור',

      accessControl: 'בקרת גישה והרשאות',

      addUser: 'הוספת משתמש',
      refresh: 'רענון',

      search: 'חיפוש לפי שם או אימייל',

      allRoles: 'כל התפקידים',
      allRegions: 'כל האזורים',

      name: 'שם',
      email: 'אימייל',
      role: 'תפקיד',
      region: 'אזור',

      central_admin: 'מנהל מרכזי',
      region_boss: 'מנהל אזור',
      employee: 'עובד',

      totalUsers: 'סה״כ משתמשים',
      managers: 'מנהלים',
      employees: 'עובדים',
      representedRegions: 'אזורים פעילים',

      loading: 'טוען משתמשים...',
      loadError: 'לא ניתן לטעון את המשתמשים.',
      retry: 'נסה שוב',

      noResults: 'לא נמצאו משתמשים',
      noResultsText:
        'נסי לשנות את החיפוש או את מסנני התפקיד והאזור.',

      noUsers: 'עדיין אין משתמשים במערכת',
      noUsersText:
        'הוסיפי את המשתמש הראשון כדי להתחיל לנהל את צוות המערכת.',

      addTitle: 'הוספת משתמש חדש',
      addSubtitle:
        'המשתמש יישמר בבסיס הנתונים ויקבל הרשאות לפי התפקיד והאזור.',

      fullName: 'שם מלא',
      password: 'סיסמה זמנית',
      chooseRegion: 'בחירת אזור',

      cancel: 'ביטול',
      create: 'יצירת משתמש',
      creating: 'יוצר משתמש...',

      required: 'יש למלא את כל השדות הנדרשים.',
      invalidEmail: 'יש להזין כתובת אימייל תקינה.',
      shortPassword: 'הסיסמה חייבת להכיל לפחות 8 תווים.',

      createSuccess: 'המשתמש נוסף בהצלחה.',

      accessDenied: 'אין לך הרשאה לצפות בדף זה.',

      restrictedRegion:
        'מנהל אזור יכול להוסיף עובדים לאזור שלו בלבד.',
    },

    en: {
      title: 'User Management',
      subtitle:
        'Secure staff administration with role and region controls',

      accessControl: 'Access and permission control',

      addUser: 'Add User',
      refresh: 'Refresh',

      search: 'Search by name or email',

      allRoles: 'All Roles',
      allRegions: 'All Regions',

      name: 'Name',
      email: 'Email',
      role: 'Role',
      region: 'Region',

      central_admin: 'Central Admin',
      region_boss: 'Regional Manager',
      employee: 'Employee',

      totalUsers: 'Total Users',
      managers: 'Managers',
      employees: 'Employees',
      representedRegions: 'Active Regions',

      loading: 'Loading users...',
      loadError: 'The users could not be loaded.',
      retry: 'Try Again',

      noResults: 'No matching users',
      noResultsText:
        'Change the search text or the role and region filters.',

      noUsers: 'There are no users yet',
      noUsersText:
        'Add the first user to start managing the system team.',

      addTitle: 'Add a New User',
      addSubtitle:
        'The user will be saved to the database with role and region permissions.',

      fullName: 'Full Name',
      password: 'Temporary Password',
      chooseRegion: 'Choose Region',

      cancel: 'Cancel',
      create: 'Create User',
      creating: 'Creating User...',

      required: 'Complete all required fields.',
      invalidEmail: 'Enter a valid email address.',
      shortPassword:
        'The password must contain at least 8 characters.',

      createSuccess: 'The user was added successfully.',

      accessDenied:
        'You do not have permission to view this page.',

      restrictedRegion:
        'A regional manager can add employees to their own region only.',
    },
  };

  const t = translations[language] || translations.he;

  async function loadData() {
    setLoading(true);
    setLoadError('');

    try {
      const [usersData, regionsData] = await Promise.all([
        fetchStaffUsers(),
        fetchRegions(),
      ]);

      setUsers(usersData);
      setRegions(regionsData);
    } catch (error) {
      console.error('Unable to load staff users:', error);

      setLoadError(error.message || t.loadError);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (hasManagementAccess) {
      loadData();
    } else {
      setLoading(false);
    }

  }, [hasManagementAccess]);

  const filteredUsers = useMemo(() => {
    const searchValue = filters.search.trim().toLowerCase();

    return users.filter((staffUser) => {
      const userName = staffUser.name?.toLowerCase() || '';
      const userEmail = staffUser.email?.toLowerCase() || '';

      const matchesSearch =
        !searchValue ||
        userName.includes(searchValue) ||
        userEmail.includes(searchValue);

      const matchesRole =
        filters.role === 'all' ||
        staffUser.role === filters.role;

      const normalizedRegionId =
        staffUser.regionId === null ||
        staffUser.regionId === undefined
          ? null
          : String(staffUser.regionId);

      const matchesRegion =
        filters.regionId === 'all' ||
        normalizedRegionId === String(filters.regionId);

      return matchesSearch && matchesRole && matchesRegion;
    });
  }, [filters, users]);

  const statistics = useMemo(() => {
    const managers = users.filter((staffUser) =>
      ['central_admin', 'region_boss'].includes(
        staffUser.role
      )
    ).length;

    const employees = users.filter(
      (staffUser) => staffUser.role === 'employee'
    ).length;

    const activeRegions = new Set(
      users
        .map((staffUser) => staffUser.regionId)
        .filter(
          (regionId) =>
            regionId !== null && regionId !== undefined
        )
    ).size;

    return {
      total: users.length,
      managers,
      employees,
      activeRegions,
    };
  }, [users]);

  function getRegionName(staffUser) {
    if (staffUser.regionName || staffUser.regionNameEn) {
      return localizeById(staffUser.regionId, staffUser.regionName || staffUser.regionNameEn, language);
    }

    const region = regions.find(
      (currentRegion) =>
        String(currentRegion.id) ===
        String(staffUser.regionId)
    );

    if (!region) {
      return t.allRegions;
    }

    return localizeRegionName(region, language);
  }

  function getRoleBadge(role) {
    const roleConfig = {
      central_admin: {
        className:
          'role-badge role-badge--central',
        Icon: Shield,
      },

      region_boss: {
        className:
          'role-badge role-badge--manager',
        Icon: UserCog,
      },

      employee: {
        className:
          'role-badge role-badge--employee',
        Icon: User,
      },
    };

    const config =
      roleConfig[role] || roleConfig.employee;

    const RoleIcon = config.Icon;

    return (
      <span className={config.className}>
        <RoleIcon size={14} />
        {t[role] || role}
      </span>
    );
  }

  function openAddUserModal() {
    setFormError('');
    setSuccessMessage('');

    setForm({
      ...EMPTY_FORM,

      role: 'employee',

      regionId:
        !isCentralAdmin?.() && currentRegionId
          ? String(currentRegionId)
          : '',
    });

    setIsModalOpen(true);
  }

  function closeModal() {
    if (saving) {
      return;
    }

    setIsModalOpen(false);
    setFormError('');
  }

  function handleFormChange(event) {
    const { name, value } = event.target;

    setForm((currentForm) => {
      const updatedForm = {
        ...currentForm,
        [name]: value,
      };

      if (
        name === 'role' &&
        value === 'central_admin'
      ) {
        updatedForm.regionId = '';
      }

      return updatedForm;
    });
  }

  function validateForm() {
    const regionIsRequired =
      form.role !== 'central_admin';

    if (
      !form.name.trim() ||
      !form.email.trim() ||
      !form.password ||
      !form.role ||
      (regionIsRequired && !form.regionId)
    ) {
      return t.required;
    }

    const emailPattern =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(form.email.trim())) {
      return t.invalidEmail;
    }

    if (form.password.length < 8) {
      return t.shortPassword;
    }

    return '';
  }

  async function handleAddUser(event) {
    event.preventDefault();

    setFormError('');

    const validationError = validateForm();

    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSaving(true);

    try {
      const newUserPayload = {
        name: form.name.trim(),

        email: form.email
          .trim()
          .toLowerCase(),

        password: form.password,

        role: form.role,

        regionId:
          form.role === 'central_admin'
            ? null
            : form.regionId || null,
      };

      const createdUser =
        await createStaffUser(newUserPayload);

      setUsers((currentUsers) => [
        createdUser,
        ...currentUsers,
      ]);

      setIsModalOpen(false);
      setSuccessMessage(t.createSuccess);
    } catch (error) {
      console.error(
        'Unable to create user:',
        error
      );

      setFormError(
        error.message || t.loadError
      );
    } finally {
      setSaving(false);
    }
  }

  if (!hasManagementAccess) {
    return (
      <main className="users-page users-page--centered">
        <div className="state-card state-card--compact">
          <Shield size={36} />

          <h2>{t.accessDenied}</h2>
        </div>
      </main>
    );
  }

  return (
    <main
      className="users-page"
      dir={isHebrew ? 'rtl' : 'ltr'}
    >
      <header className="users-hero">
        <div>
          <div className="eyebrow">
            <Shield size={15} />

            {t.accessControl}
          </div>

          <h1>{t.title}</h1>

          <p>{t.subtitle}</p>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw
              size={17}
              className={loading ? 'spin' : ''}
            />

            {t.refresh}
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={openAddUserModal}
          >
            <Plus size={18} />

            {t.addUser}
          </button>
        </div>
      </header>

      {successMessage && (
        <div
          className="feedback-banner feedback-banner--success"
          role="status"
        >
          <CheckCircle2 size={18} />

          <span>{successMessage}</span>

          <button
            type="button"
            onClick={() => setSuccessMessage('')}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section className="stats-grid">
        <StatCard
          Icon={Users}
          label={t.totalUsers}
          value={statistics.total}
          tone="blue"
        />

        <StatCard
          Icon={Shield}
          label={t.managers}
          value={statistics.managers}
          tone="amber"
        />

        <StatCard
          Icon={User}
          label={t.employees}
          value={statistics.employees}
          tone="slate"
        />

        <StatCard
          Icon={Building2}
          label={t.representedRegions}
          value={statistics.activeRegions}
          tone="violet"
        />
      </section>

      <section className="users-panel">
        <div className="filter-bar">
          <label className="search-field">
            <Search size={18} />

            <input
              type="search"
              value={filters.search}
              placeholder={t.search}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,

                  search: event.target.value,
                }))
              }
            />
          </label>

          <label className="select-field">
            <select
              value={filters.role}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,

                  role: event.target.value,
                }))
              }
            >
              <option value="all">
                {t.allRoles}
              </option>

              <option value="central_admin">
                {t.central_admin}
              </option>

              <option value="region_boss">
                {t.region_boss}
              </option>

              <option value="employee">
                {t.employee}
              </option>
            </select>
          </label>

          <label className="select-field">
            <select
              value={filters.regionId}
              onChange={(event) =>
                setFilters((currentFilters) => ({
                  ...currentFilters,

                  regionId: event.target.value,
                }))
              }
            >
              <option value="all">
                {t.allRegions}
              </option>

              {regions.map((region) => (
                <option
                  key={region.id}
                  value={region.id}
                >
                  {localizeRegionName(region, language)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading ? (
          <div className="state-card">
            <Loader2
              className="spin"
              size={34}
            />

            <h2>{t.loading}</h2>
          </div>
        ) : loadError ? (
          <div
            className="state-card state-card--error"
            role="alert"
          >
            <AlertCircle size={36} />

            <h2>{t.loadError}</h2>

            <p>{loadError}</p>

            <button
              type="button"
              className="secondary-button"
              onClick={loadData}
            >
              <RefreshCw size={16} />

              {t.retry}
            </button>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="state-card">
            <Users size={40} />

            <h2>
              {users.length === 0
                ? t.noUsers
                : t.noResults}
            </h2>

            <p>
              {users.length === 0
                ? t.noUsersText
                : t.noResultsText}
            </p>

            {users.length === 0 && (
              <button
                type="button"
                className="primary-button"
                onClick={openAddUserModal}
              >
                <Plus size={17} />

                {t.addUser}
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="users-table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.email}</th>
                  <th>{t.role}</th>
                  <th>{t.region}</th>
                </tr>
              </thead>

              <tbody>
                {filteredUsers.map(
                  (staffUser) => (
                    <tr key={staffUser.id}>
                      <td data-label={t.name}>
                        <div className="identity-cell">
                          <div className="user-avatar">
                            {(staffUser.name || '?')
                              .trim()
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                          <div>
                            <strong>
                              {staffUser.name}
                            </strong>

                            <small>
                              #{staffUser.id}
                            </small>
                          </div>
                        </div>
                      </td>

                      <td data-label={t.email}>
                        <a
                          className="email-link"
                          href={`mailto:${staffUser.email}`}
                          dir="ltr"
                        >
                          <Mail size={15} />

                          {staffUser.email}
                        </a>
                      </td>

                      <td data-label={t.role}>
                        {getRoleBadge(
                          staffUser.role
                        )}
                      </td>

                      <td data-label={t.region}>
                        <span className="region-cell">
                          <Building2 size={15} />

                          {getRegionName(
                            staffUser
                          )}
                        </span>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isModalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={closeModal}
        >
          <section
            className="user-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
          >
            <div className="modal-header">
              <div>
                <h2>{t.addTitle}</h2>

                <p>{t.addSubtitle}</p>
              </div>

              <button
                type="button"
                className="icon-button"
                onClick={closeModal}
                disabled={saving}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {!isCentralAdmin?.() && (
              <div className="permission-note">
                <Shield size={17} />

                {t.restrictedRegion}
              </div>
            )}

            {formError && (
              <div
                className="feedback-banner feedback-banner--error"
                role="alert"
              >
                <AlertCircle size={18} />

                <span>{formError}</span>
              </div>
            )}

            <form
              className="user-form"
              onSubmit={handleAddUser}
            >
              <label>
                <span>{t.fullName}</span>

                <input
                  name="name"
                  value={form.name}
                  onChange={handleFormChange}
                  disabled={saving}
                  required
                />
              </label>

              <label>
                <span>{t.email}</span>

                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleFormChange}
                  disabled={saving}
                  dir="ltr"
                  required
                />
              </label>

              <label>
                <span>{t.password}</span>

                <input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={handleFormChange}
                  disabled={saving}
                  minLength={8}
                  dir="ltr"
                  required
                />
              </label>

              <div className="form-grid">
                <label>
                  <span>{t.role}</span>

                  <select
                    name="role"
                    value={form.role}
                    onChange={handleFormChange}
                    disabled={
                      saving ||
                      !isCentralAdmin?.()
                    }
                    required
                  >
                    <option value="employee">
                      {t.employee}
                    </option>

                    {isCentralAdmin?.() && (
                      <>
                        <option value="region_boss">
                          {t.region_boss}
                        </option>

                        <option value="central_admin">
                          {t.central_admin}
                        </option>
                      </>
                    )}
                  </select>
                </label>

                <label>
                  <span>{t.region}</span>

                  <select
                    name="regionId"
                    value={form.regionId}
                    onChange={handleFormChange}
                    disabled={
                      saving ||
                      form.role ===
                        'central_admin' ||
                      !isCentralAdmin?.()
                    }
                    required={
                      form.role !==
                      'central_admin'
                    }
                  >
                    <option value="">
                      {t.chooseRegion}
                    </option>

                    {regions.map((region) => (
                      <option
                        key={region.id}
                        value={region.id}
                      >
                        {localizeRegionName(region, language)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={closeModal}
                  disabled={saving}
                >
                  {t.cancel}
                </button>

                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2
                      className="spin"
                      size={17}
                    />
                  ) : (
                    <Plus size={17} />
                  )}

                  {saving
                    ? t.creating
                    : t.create}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function StatCard({
  Icon,
  label,
  value,
  tone,
}) {
  return (
    <article
      className={`stat-card stat-card--${tone}`}
    >
      <div className="stat-icon">
        <Icon size={20} />
      </div>

      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}

export default UsersPage;