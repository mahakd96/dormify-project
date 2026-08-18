import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';

// Components
import Sidebar from './components/Sidebar';
import Header from './components/Header';

// Pages
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import BuildingsPage from './pages/BuildingsPage';
import StudentsPage from './pages/StudentsPage';
import UploadPage from './pages/UploadPage';
import AssistedAllocationPage from './pages/AssistedAllocationPage';
import AllocationPage from './pages/AllocationPage';
import AllocationResultsPage from './pages/AllocationResultsPage';
import TransfersPage from './pages/TransfersPage';
import ReportsPage from './pages/ReportsPage';
import UsersPage from './pages/UsersPage';
import SettingsPage from './pages/SettingsPage';
import MapPage from './pages/MapPage';
// At the top imports:
import AnalysisPage from './pages/AnalysisPage';
import WhatIfPage from './pages/WhatIfPage';

// Inside Routes:

// Main Layout with Sidebar + Header
function MainLayout({ language, onLanguageToggle, sidebarCollapsed, onSidebarToggle }) {
  return (
    <div
      className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      dir={language === 'he' ? 'rtl' : 'ltr'}
    >
      <Sidebar collapsed={sidebarCollapsed} onToggle={onSidebarToggle} language={language} />
      <Header language={language} onLanguageToggle={onLanguageToggle} />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

// Auth gate for protected area
function ProtectedLayout({ language, onLanguageToggle, sidebarCollapsed, onSidebarToggle }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <MainLayout
      language={language}
      onLanguageToggle={onLanguageToggle}
      sidebarCollapsed={sidebarCollapsed}
      onSidebarToggle={onSidebarToggle}
    />
  );
}

function AppContent() {
  const [language, setLanguage] = useState('he');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, loading } = useAuth();

  const toggleLanguage = () => setLanguage((lang) => (lang === 'he' ? 'en' : 'he'));
  const toggleSidebar = () => setSidebarCollapsed((c) => !c);

  return (
    <Routes>
      {/* Login */}
      <Route
  path="/login"
  element={
    loading ? (
      <div className="loading">Loading...</div>
    ) : user ? (
      <Navigate to="/dashboard" replace />
    ) : (
      <LoginPage
        language={language}
        onLanguageToggle={toggleLanguage}
      />
    )
  }
/>

      {/* Protected app shell */}
      <Route
        element={
          <ProtectedLayout
            language={language}
            onLanguageToggle={toggleLanguage}
            sidebarCollapsed={sidebarCollapsed}
            onSidebarToggle={toggleSidebar}
          />
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<HomePage language={language} />} />
        {/* Old Data & Statistics page was merged into the unified /analysis page */}
        <Route path="/system-overview" element={<Navigate to="/analysis" replace />} />
        <Route path="/map" element={<MapPage language={language} />} />
        <Route path="/buildings" element={<BuildingsPage language={language} />} />
        <Route path="/students" element={<StudentsPage language={language} />} />
        <Route path="/upload" element={<UploadPage language={language} />} />
        <Route path="/assisted-allocation" element={<AssistedAllocationPage language={language} />} />
        {/* Old Accessibility / Special Requests page - preserved as an alias */}
        <Route path="/priority" element={<Navigate to="/assisted-allocation" replace />} />
        <Route path="/allocation" element={<AllocationPage language={language} />} />
          <Route path="/analysis" element={<AnalysisPage language={language} />} />
          <Route path="/what-if" element={<WhatIfPage language={language} />} />
        <Route path="/allocation/results" element={<AllocationResultsPage language={language} />} />
        <Route path="/transfers" element={<TransfersPage language={language} />} />
        <Route path="/reports" element={<ReportsPage language={language} />} />
        <Route path="/users" element={<UsersPage language={language} />} />
        <Route
          path="/settings"
          element={<SettingsPage language={language} onLanguageToggle={toggleLanguage} />}
        />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>

      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Heebo', -apple-system, BlinkMacSystemFont, sans-serif;
          background: #f1f5f9;
          min-height: 100vh;
        }

        .app-layout {
          min-height: 100vh;
        }

        .main-content {
          margin-right: 260px;
          margin-top: 64px;
          min-height: calc(100vh - 64px);
          transition: margin 0.3s ease;
        }

        [dir="ltr"] .main-content {
          margin-right: 0;
          margin-left: 260px;
        }

        .app-layout.sidebar-collapsed .main-content {
          margin-right: 72px;
        }

        [dir="ltr"] .app-layout.sidebar-collapsed .main-content {
          margin-right: 0;
          margin-left: 72px;
        }

        .loading {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          font-size: 18px;
          color: #64748b;
        }

        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        ::-webkit-scrollbar-track {
          background: #f1f5f9;
        }

        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: #94a3b8;
        }
      `}</style>
    </AuthProvider>
  );
}

export default App;