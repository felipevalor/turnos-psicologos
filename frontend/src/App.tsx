import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PatientView } from './pages/PatientView';
import { Login } from './pages/Login';
import { AdminDashboard } from './pages/AdminDashboard';
import { apiLogout } from './lib/api';
import type { Psychologist } from './lib/types';

function AdminRoute() {
  const [psychologist, setPsychologist] = useState<Psychologist | null>(() => {
    try {
      const stored = localStorage.getItem('psi_user');
      return stored ? (JSON.parse(stored) as Psychologist) : null;
    } catch {
      return null;
    }
  });

  const handleLogin = (psych: Psychologist) => {
    setPsychologist(psych);
  };

  const handleLogout = async () => {
    await apiLogout();
    localStorage.removeItem('psi_user');
    localStorage.removeItem('psi_token');
    setPsychologist(null);
  };

  if (!psychologist) {
    return <Login onLogin={handleLogin} />;
  }

  return <AdminDashboard psychologist={psychologist} onLogout={handleLogout} />;
}

import { NotificationProvider } from './lib/NotificationContext';

export default function App() {
  // Reload if session data is cleared in another tab
  useEffect(() => {
    const handler = () => {
      if (!localStorage.getItem('psi_user')) {
        window.location.reload();
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <NotificationProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/" element={<PatientView />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </NotificationProvider>
  );
}
