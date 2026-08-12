import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { localizeById } from '../utils/locationNames';

import {
  LayoutDashboard,
  Building2,
  Users,
  Upload,
  Star,
  Shuffle,
  ArrowLeftRight,
  BarChart3,
  Settings,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Shield,
  UserCog,
  Map,
  TrendingUp,  // ← ADD THIS
    HelpCircle,
} from 'lucide-react';
function Sidebar({ collapsed, onToggle, language }) {
  const auth = useAuth();
  const navigate = useNavigate();

  const user = auth?.user;
  const logout = auth?.logout;

  // ✅ safe wrappers (never crash)
  const canUploadExcel = typeof auth?.canUploadExcel === 'function' ? auth.canUploadExcel : () => false;
  const canAssistAllocation =
    typeof auth?.canAssistAllocation === 'function' ? auth.canAssistAllocation : () => false;

  // ✅ FIX: your AuthContext provides canManageUsers() now (alias)
  const canManageUsers = typeof auth?.canManageUsers === 'function' ? auth.canManageUsers : () => false;

  const handleLogout = () => {
    if (typeof logout === 'function') logout();
    navigate('/login');
  };

  // Region name comes straight from the backend user object (real data,
  // loaded from the DB) - no more hardcoded mockData region lookup table.
  // Localized via the centralized helper so it shows its English name
  // when the app language is English, instead of always staying Hebrew.
  const regionName = user?.region_name
    ? localizeById(user.region, user.region_name, language)
    : (language === 'he' ? 'כל האזורים' : 'All Regions');

  const getRoleName = () => {
    switch (user?.role) {
      case 'central_admin':
        return language === 'he' ? 'מנהל מרכזי' : 'Central Admin';
      case 'region_boss':
        return language === 'he' ? 'מנהל אזור' : 'Region Admin';
      case 'employee':
        return language === 'he' ? 'עובד' : 'Employee';
      default:
        return '';
    }
  };

  const navGroups = [
    {
      key: 'main',
      title: language === 'he' ? 'ראשי' : 'Main',
      items: [
        { path: '/dashboard', icon: LayoutDashboard, label: language === 'he' ? 'דף הבית' : 'Home', show: true },
      ],
    },
    {
      key: 'students',
      title: language === 'he' ? 'ניהול סטודנטים' : 'Student Management',
      items: [
        { path: '/upload', icon: Upload, label: language === 'he' ? 'העלאת קובץ' : 'Upload File', show: canUploadExcel() },
        { path: '/students', icon: Users, label: language === 'he' ? 'סטודנטים' : 'Students', show: true },
        { path: '/assisted-allocation', icon: Star, label: language === 'he' ? 'שיבוץ ידני' : 'Manual Allocation', show: canAssistAllocation() },
      ],
    },
    {
      key: 'allocation',
      title: language === 'he' ? 'תהליך השיבוץ' : 'Allocation Process',
      items: [
        { path: '/allocation', icon: Shuffle, label: language === 'he' ? 'שיבוץ' : 'Allocation', show: true },
        { path: '/transfers', icon: ArrowLeftRight, label: language === 'he' ? 'בקשות מעבר' : 'Transfer Requests', show: true },
      ],
    },
    {
      key: 'dormitory',
      title: language === 'he' ? 'ניהול מעונות' : 'Dormitory Management',
      items: [
        { path: '/buildings', icon: Building2, label: language === 'he' ? 'בניינים וחדרים' : 'Buildings and Rooms', show: true },
        { path: '/map', icon: Map, label: language === 'he' ? 'מפת המעונות' : 'Dormitory Map', show: true },
      ],
    },
    {
      key: 'reports',
      title: language === 'he' ? 'דוחות ונתונים' : 'Reports and Data',
      items: [
        { path: '/reports', icon: BarChart3, label: language === 'he' ? 'דוחות' : 'Reports', show: true },
        { path: '/analysis', icon: TrendingUp, label: language === 'he' ? 'ניתוח נתונים' : 'Data Analysis', show: true },
      ],
    },
    {
      key: 'system',
      title: language === 'he' ? 'ניהול מערכת' : 'System Management',
      items: [
        { path: '/users', icon: UserCog, label: language === 'he' ? 'מידע על עובדים' : 'Employee Information', show: canManageUsers() },
        { path: '/what-if', icon: HelpCircle, label: language === 'he' ? 'כללי מה אם' : 'What-If Rules', show: true },
        { path: '/settings', icon: Settings, label: language === 'he' ? 'הגדרות' : 'Settings', show: true },
      ],
    },
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="logo">
          <Building2 size={28} />
          {!collapsed && <span>Dormify</span>}
        </div>
        <button className="collapse-btn" onClick={onToggle}>
          {collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {!collapsed && (
        <div className="region-badge">
          <Shield size={14} />
          <span>{regionName}</span>
        </div>
      )}

      <nav className="sidebar-nav">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((item) => item.show);
          if (visibleItems.length === 0) return null;

          return (
            <div className="nav-group" key={group.key}>
              {!collapsed && <div className="nav-group-title">{group.title}</div>}
              {visibleItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  title={collapsed ? item.label : ''}
                >
                  <item.icon size={20} />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && (
          <div className="user-info">
            <div className="user-avatar">{(user?.name || 'U').charAt(0)}</div>
            <div className="user-details">
              <span className="user-name">{user?.name || ''}</span>
              <span className="user-role">{getRoleName()}</span>
            </div>
          </div>
        )}
        <button className="logout-btn" onClick={handleLogout} title={language === 'he' ? 'התנתקות' : 'Logout'}>
          <LogOut size={18} />
          {!collapsed && <span>{language === 'he' ? 'התנתקות' : 'Logout'}</span>}
        </button>
      </div>

      <style>{`
        .sidebar {
          position: fixed;
          top: 0;
          right: 0;
          width: 260px;
          height: 100vh;
          background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
          display: flex;
          flex-direction: column;
          transition: width 0.3s ease;
          z-index: 100;
        }

        [dir="ltr"] .sidebar {
          right: auto;
          left: 0;
        }

        .sidebar.collapsed {
          width: 72px;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 12px;
          color: white;
        }

        .logo span {
          font-size: 20px;
          font-weight: 700;
        }

        .collapse-btn {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.1);
          border: none;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .collapse-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: white;
        }

        .region-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 16px;
          padding: 10px 14px;
          background: rgba(61, 159, 224, 0.2);
          border-radius: 8px;
          color: #7dd3fc;
          font-size: 13px;
          font-weight: 500;
        }

        .sidebar-nav {
          flex: 1;
          padding: 8px;
          overflow-y: auto;
          overflow-x: hidden;
        }

        .nav-group {
          margin-bottom: 6px;
        }

        .nav-group-title {
          padding: 10px 14px 6px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.35);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .nav-group:first-child .nav-group-title {
          padding-top: 2px;
        }

        .sidebar.collapsed .nav-group {
          padding-top: 6px;
          margin-bottom: 0;
        }

        .sidebar.collapsed .nav-group:not(:first-child) {
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          margin-top: 6px;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          color: rgba(255, 255, 255, 0.7);
          text-decoration: none;
          border-radius: 10px;
          margin-bottom: 4px;
          transition: all 0.2s;
        }

        .nav-item:hover {
          background: rgba(255, 255, 255, 0.1);
          color: white;
        }

        .nav-item.active {
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          color: white;
          box-shadow: 0 4px 12px rgba(61, 159, 224, 0.3);
        }

        .nav-item span {
          font-size: 14px;
          font-weight: 500;
        }

        .sidebar.collapsed .nav-item {
          justify-content: center;
          padding: 12px;
        }

        .sidebar-footer {
          padding: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }

        .user-avatar {
          width: 40px;
          height: 40px;
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          font-size: 16px;
        }

        .user-details {
          display: flex;
          flex-direction: column;
        }

        .user-name {
          color: white;
          font-weight: 500;
          font-size: 14px;
        }

        .user-role {
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
        }

        .logout-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 10px;
          background: rgba(239, 68, 68, 0.2);
          border: none;
          border-radius: 8px;
          color: #fca5a5;
          font-size: 14px;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }

        .logout-btn:hover {
          background: rgba(239, 68, 68, 0.3);
          color: #fecaca;
        }

        .sidebar.collapsed .logout-btn span {
          display: none;
        }
      `}</style>
    </aside>
  );
}

export default Sidebar;
