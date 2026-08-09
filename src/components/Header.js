import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Search } from 'lucide-react';

function Header({ language, onLanguageToggle }) {
  const navigate = useNavigate();

  const [searchTerm, setSearchTerm] = useState('');
  const [showResults, setShowResults] = useState(false);

  const navigationItems = useMemo(
    () => [
      {
        labelHe: 'דף הבית',
        labelEn: 'Home',
        path: '/',
        keywords: [
          'בית',
          'דף הבית',
          'ראשי',
          'dashboard',
          'home',
        ],
      },

      {
        labelHe: 'סטודנטים',
        labelEn: 'Students',
        path: '/students',
        keywords: [
          'סטודנט',
          'סטודנטים',
          'students',
          'student',
        ],
      },

      {
        labelHe: 'שיבוץ',
        labelEn: 'Allocation',
        path: '/allocation',
        keywords: [
          'שיבוץ',
          'הקצאה',
          'allocation',
        ],
      },

      {
        labelHe: 'תוצאות שיבוץ',
        labelEn: 'Allocation Results',
        path: '/allocation/results',
        keywords: [
          'תוצאות',
          'תוצאות שיבוץ',
          'שיבוץ תוצאות',
          'allocation results',
          'results',
        ],
      },

      {
        labelHe: 'בקשות מעבר',
        labelEn: 'Transfer Requests',
        path: '/requests',
        keywords: [
          'בקשות',
          'בקשה',
          'בקשות מעבר',
          'בקשת מעבר',
          'מעבר',
          'transfer',
          'requests',
        ],
      },

      {
        labelHe: 'בניינים וחדרים',
        labelEn: 'Buildings and Rooms',
        path: '/buildings',
        keywords: [
          'בניין',
          'בניינים',
          'חדר',
          'חדרים',
          'דירה',
          'דירות',
          'בניינים וחדרים',
          'buildings',
          'rooms',
          'apartments',
        ],
      },

      {
        labelHe: 'מפת המעונות',
        labelEn: 'Dormitory Map',
        path: '/map',
        keywords: [
          'מפה',
          'מפת המעונות',
          'מפת מעונות',
          'מעונות',
          'map',
          'dormitory map',
        ],
      },

      {
        labelHe: 'דוחות',
        labelEn: 'Reports',
        path: '/reports',
        keywords: [
          'דוח',
          'דוחות',
          'reports',
          'report',
        ],
      },

      {
        labelHe: 'ניתוח נתונים',
        labelEn: 'Data Analysis',
        path: '/analysis',
        keywords: [
          'ניתוח',
          'ניתוח נתונים',
          'נתונים',
          'סטטיסטיקה',
          'אנליזה',
          'analysis',
          'analytics',
          'data analysis',
        ],
      },

      {
        labelHe: 'מידע על עובדים',
        labelEn: 'Staff Information',
        path: '/staff',
        keywords: [
          'עובד',
          'עובדים',
          'מידע על עובדים',
          'צוות',
          'מנהלים',
          'staff',
          'employees',
        ],
      },

      {
        labelHe: 'כללי מה אם',
        labelEn: 'What If Rules',
        path: '/what-if',
        keywords: [
          'מה אם',
          'כללי מה אם',
          'what if',
          'what-if',
          'rules',
        ],
      },

      {
        labelHe: 'הגדרות',
        labelEn: 'Settings',
        path: '/settings',
        keywords: [
          'הגדרות',
          'הגדרה',
          'settings',
          'preferences',
        ],
      },
    ],
    []
  );

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return [];
    }

    return navigationItems.filter((item) => {
      const searchableValues = [
        item.labelHe,
        item.labelEn,
        ...(item.keywords || []),
      ];

      return searchableValues.some((value) =>
        String(value).toLowerCase().includes(query)
      );
    });
  }, [searchTerm, navigationItems]);

  const handleNavigate = (path) => {
    navigate(path);
    setSearchTerm('');
    setShowResults(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && filteredItems.length > 0) {
      handleNavigate(filteredItems[0].path);
    }

    if (event.key === 'Escape') {
      setShowResults(false);
    }
  };

  return (
    <header className="header">
      <div className="header-right">
        <div className="search-wrapper">
          <div className="search-box">
            <Search size={18} />

            <input
              type="text"
              value={searchTerm}
              placeholder={
                language === 'he'
                  ? 'חיפוש...'
                  : 'Search...'
              }
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
            />
          </div>

          {showResults && searchTerm.trim() !== '' && (
            <div className="search-results">
              {filteredItems.length > 0 ? (
                filteredItems.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    className="search-result-item"
                    onClick={() =>
                      handleNavigate(item.path)
                    }
                  >
                    <Search size={15} />

                    <span>
                      {language === 'he'
                        ? item.labelHe
                        : item.labelEn}
                    </span>
                  </button>
                ))
              ) : (
                <div className="search-no-results">
                  {language === 'he'
                    ? 'לא נמצאו תוצאות'
                    : 'No results found'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="header-left">

        <button
          className="icon-btn"
          onClick={onLanguageToggle}
          title={
            language === 'he'
              ? 'English'
              : 'עברית'
          }
        >
          <Globe size={20} />

          <span className="lang-text">
            {language === 'he'
              ? 'EN'
              : 'עב'}
          </span>
        </button>


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

        .search-wrapper {
          position: relative;
        }

        .search-box {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #f1f5f9;
          padding: 8px 16px;
          border-radius: 10px;
          width: 280px;
          transition: all 0.2s ease;
        }

        .search-box:focus-within {
          background: white;
          box-shadow:
            0 0 0 1px #cbd5e1,
            0 6px 18px rgba(15, 23, 42, 0.08);
        }

        .search-box svg {
          color: #94a3b8;
          flex-shrink: 0;
        }

        .search-box input {
          border: none;
          background: none;
          outline: none;
          font-size: 14px;
          width: 100%;
          font-family: inherit;
          color: #334155;
        }

        .search-box input::placeholder {
          color: #94a3b8;
        }

        .search-results {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 280px;
          max-height: 340px;
          overflow-y: auto;
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          box-shadow:
            0 14px 34px rgba(15, 23, 42, 0.15);
          z-index: 300;
        }

        [dir="ltr"] .search-results {
          right: auto;
          left: 0;
        }

        .search-result-item {
          width: 100%;
          border: none;
          background: white;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 9px;
          font-family: inherit;
          font-size: 14px;
          color: #334155;
          cursor: pointer;
          text-align: start;
          transition: all 0.15s ease;
        }

        .search-result-item:hover {
          background: #f1f5f9;
          color: #2563eb;
        }

        .search-result-item + .search-result-item {
          border-top: 1px solid #f1f5f9;
        }

        .search-result-item svg {
          flex-shrink: 0;
        }

        .search-no-results {
          padding: 16px;
          font-size: 13px;
          color: #94a3b8;
          text-align: center;
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

        .lang-text {
          font-size: 11px;
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .search-box {
            width: 180px;
          }

          .search-results {
            width: 240px;
          }
        }
      `}</style>
    </header>
  );
}

export default Header;