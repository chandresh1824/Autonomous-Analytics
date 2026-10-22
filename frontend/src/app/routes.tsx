import { Navigate, Route, Routes } from 'react-router-dom';
import { ChatPage } from '@/pages/ChatPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { HomePage } from '@/pages/HomePage';
import { SettingsPage } from '@/pages/SettingsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/ask" element={<HomePage />} />
      <Route path="/conversation" element={<ChatPage />} />
      <Route path="/chat" element={<Navigate to="/conversation" replace />} />
      <Route path="/dashboard" element={<Navigate to="/" replace />} />
      <Route path="/settings/*" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
