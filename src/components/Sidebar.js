import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { regions } from '../data/mockData';

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
} from 'lucide-react';
function Sidebar({ collapsed, onToggle, language }) {
  const auth = useAuth();
  const navigate = useNavigate();

  const user = auth?.user;
  const logout = auth?.logout;

  // ✅ safe wrappers (never crash)
  const canUploadExcel = typeof auth?.canUploadExcel === 'function' ? auth.canUploadExcel : () => false;
  const canAssignPriority =
    typeof auth?.canAssignPriority === 'function' ? auth.canAssignPriority : () => false;

  // ✅ FIX: your AuthContext provides canManageUsers() now (alias)
  const canManageUsers = typeof auth?.canManageUsers === 'function' ? auth.canManageUsers : () => false;

  const handleLogout = () => {
    if (typeof logout === 'function') logout();
    navigate('/login');
  };

  // ✅ FIX: user region may be user.region OR user.regionId
  const userRegionId = user?.regionId ?? user?.region ?? null;

  const region = regions.find((r) => String(r.id) === String(userRegionId));
  const regionName = region
    ? language === 'he'
      ? region.name
      : region.nameEn
    : language === 'he'
      ? 'כל האזורים'
      : 'All Regions';

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

  const navItems = [
    { path: '/dashboard', icon: LayoutDashboard, label: language === 'he' ? 'לוח בקרה' : 'Dashboard', show: true },
    { path: '/map', icon: Map, label: language === 'he' ? 'מפת המעונות' : 'Dorm Map', show: true },
    { path: '/buildings', icon: Building2, label: language === 'he' ? 'בניינים וחדרים' : 'Buildings & Rooms', show: true },
    { path: '/students', icon: Users, label: language === 'he' ? 'סטודנטים' : 'Students', show: true },
    { path: '/upload', icon: Upload, label: language === 'he' ? 'העלאת קובץ' : 'Upload File', show: canUploadExcel() },
    { path: '/priority', icon: Star, label: language === 'he' ? 'סטודנטים עם בקשות מיוחדות' : 'Students with Special Requests', show: canAssignPriority() },
    { path: '/allocation', icon: Shuffle, label: language === 'he' ? 'שיבוץ' : 'Allocation', show: true },
    { path: '/transfers', icon: ArrowLeftRight, label: language === 'he' ? 'בקשות מעבר' : 'Transfer Requests', show: true },
    { path: '/reports', icon: BarChart3, label: language === 'he' ? 'דוחות' : 'Reports', show: true },
    { path: '/analysis', icon: TrendingUp, label: language === 'he' ? 'ניתוח נתונים' : 'Data Analysis', show: true },
    { path: '/users', icon: UserCog, label: language === 'he' ? 'מידע על עובדים ' : 'Workers Contacts', show: canManageUsers() },
    { path: '/settings', icon: Settings, label: language === 'he' ? 'הגדרות' : 'Settings', show: true },
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
        {navItems
          .filter((item) => item.show)
          .map((item) => (
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
