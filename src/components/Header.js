import React from 'react';
import { useAuth } from '../context/AuthContext';
import { regions } from '../data/mockData';
import { Bell, Globe, Search } from 'lucide-react';

function Header({ language, onLanguageToggle }) {
  const { user, isCentralAdmin } = useAuth();
  const region = regions.find(r => r.id === user?.regionId);

  return (
    <header className="header">
      <div className="header-right">
        <div className="search-box">
          <Search size={18} />
          <input type="text" placeholder={language === 'he' ? 'חיפוש...' : 'Search...'} />
        </div>
      </div>

      <div className="header-left">
        <button className="icon-btn" title={language === 'he' ? 'התראות' : 'Notifications'}>
          <Bell size={20} />
          <span className="notification-badge">3</span>
        </button>

        <button className="icon-btn" onClick={onLanguageToggle} title={language === 'he' ? 'English' : 'עברית'}>
          <Globe size={20} />
          <span className="lang-text">{language === 'he' ? 'EN' : 'עב'}</span>
        </button>

        <div className="user-region-badge">
          {isCentralAdmin() ? (
            <span className="admin-badge">{language === 'he' ? 'מנהל מרכזי' : 'Central Admin'}</span>
          ) : (
            <span>{language === 'he' ? region?.name : region?.nameEn}</span>
          )}
        </div>
      </div>

      <style>{`
        .header {
          position: fixed;
          top: 0;
          right: 260px;
          left: 0;
          height: 64px;
          background: white;
          border-bottom: 1px solid #e5e7eb;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 24px;
          z-index: 90;
        }

        [dir="ltr"] .header {
          right: 0;
          left: 260px;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .search-box {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #f1f5f9;
          padding: 8px 16px;
          border-radius: 10px;
          width: 280px;
        }

        .search-box svg {
          color: #94a3b8;
        }

        .search-box input {
          border: none;
          background: none;
          outline: none;
          font-size: 14px;
          width: 100%;
          font-family: inherit;
        }

        .icon-btn {
          position: relative;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: #f1f5f9;
          border: none;
          color: #64748b;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          transition: all 0.2s;
        }

        .icon-btn:hover {
          background: #e2e8f0;
          color: #334155;
        }

        .notification-badge {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 16px;
          height: 16px;
          background: #ef4444;
          border-radius: 50%;
          font-size: 10px;
          font-weight: 600;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .lang-text {
          font-size: 11px;
          font-weight: 600;
        }

        .user-region-badge {
          padding: 8px 16px;
          background: linear-gradient(135deg, #3d9fe0, #2563eb);
          border-radius: 8px;
          color: white;
          font-size: 13px;
          font-weight: 500;
        }

        .admin-badge {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        @media (max-width: 768px) {
          .search-box {
            width: 180px;
          }
        }
      `}</style>
    </header>
  );
}

export default Header;
