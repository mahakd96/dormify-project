// UsersPage.js
import React from 'react';
import { useAuth } from '../context/AuthContext';
import { users, regions } from '../data/mockData';
import { UserCog, Plus, Shield, User } from 'lucide-react';

function UsersPage({ language }) {
  const { user: currentUser, canManageUsers, isCentralAdmin, getUserRegion } = useAuth();
  const userRegion = getUserRegion();

  const filteredUsers = users.filter(u => {
    if (isCentralAdmin()) return true;
    return u.regionId === userRegion;
  });

  const t = {
    he: { title: 'ניהול משתמשים', subtitle: 'צפייה וניהול משתמשי המערכת', addUser: 'הוסף משתמש', name: 'שם', email: 'אימייל', role: 'תפקיד', region: 'אזור', central_admin: 'מנהל מרכזי', region_boss: 'מנהל אזור', employee: 'עובד', allRegions: 'כל האזורים' },
    en: { title: 'User Management', subtitle: 'View and manage system users', addUser: 'Add User', name: 'Name', email: 'Email', role: 'Role', region: 'Region', central_admin: 'Central Admin', region_boss: 'Region Boss', employee: 'Employee', allRegions: 'All Regions' }
  }[language];

  if (!canManageUsers()) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>{language === 'he' ? 'אין לך הרשאה לדף זה' : 'No access'}</div>;
  }

  const getRoleBadge = (role) => {
    const config = { central_admin: { bg: '#fef3c7', color: '#b45309' }, region_boss: { bg: '#dbeafe', color: '#2563eb' }, employee: { bg: '#f1f5f9', color: '#64748b' } };
    const c = config[role];
    return <span style={{ background: c.bg, color: c.color, padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500 }}>{t[role]}</span>;
  };

  return (
    <div className="users-page">
      <div className="page-header"><div><h1>{t.title}</h1><p>{t.subtitle}</p></div><button className="add-btn"><Plus size={18} /> {t.addUser}</button></div>
      <div className="table-container">
        <table>
          <thead><tr><th>{t.name}</th><th>{t.email}</th><th>{t.role}</th><th>{t.region}</th></tr></thead>
          <tbody>
            {filteredUsers.map(u => {
              const region = regions.find(r => r.id === u.regionId);
              return (
                <tr key={u.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #3d9fe0, #2563eb)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 600 }}>{u.name[0]}</div>{u.name}</div></td>
                  <td style={{ direction: 'ltr' }}>{u.email}</td>
                  <td>{getRoleBadge(u.role)}</td>
                  <td>{region ? (language === 'he' ? region.name : region.nameEn) : t.allRegions}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <style>{`
        .users-page { padding: 24px; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
        .page-header h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
        .page-header p { color: #64748b; }
        .add-btn { display: flex; align-items: center; gap: 8px; padding: 10px 20px; background: linear-gradient(135deg, #3d9fe0, #2563eb); color: white; border: none; border-radius: 10px; font-family: inherit; cursor: pointer; }
        .table-container { background: white; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 14px 16px; text-align: right; border-bottom: 1px solid #f1f5f9; }
        [dir="ltr"] th, [dir="ltr"] td { text-align: left; }
        th { background: #f8fafc; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; }
        tr:hover { background: #f8fafc; }
      `}</style>
    </div>
  );
}

export default UsersPage;
