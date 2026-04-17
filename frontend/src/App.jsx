import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import Settings from './pages/Settings';
import Stats from './pages/Stats';
import Sidebar from './components/layout/Sidebar';
import SignalModal from './components/SignalModal';
import LiveSignalBanner from './components/LiveSignalBanner';

function AdminRoute({ children }) {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-0)' }}>
        <div style={{ width: 32, height: 32, border: '2px solid var(--primary)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  return authenticated ? children : <Navigate to="/login" state={{ from: '/settings' }} />;
}

export default function App() {
  const [activeSignal, setActiveSignal] = useState(null);
  const [liveBanner, setLiveBanner] = useState(null);

  return (
    <AuthProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <AppLayout
                activeSignal={activeSignal}
                setActiveSignal={setActiveSignal}
                liveBanner={liveBanner}
                setLiveBanner={setLiveBanner}
              />
            }
          />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}

function AppLayout({ activeSignal, setActiveSignal, liveBanner, setLiveBanner }) {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Dashboard onOpenSignal={setActiveSignal} onNewSignal={setLiveBanner} />} />
            <Route path="/signals" element={<Signals onOpenSignal={setActiveSignal} />} />
            <Route path="/stats" element={<Stats />} />
            <Route
              path="/settings"
              element={
                <AdminRoute>
                  <Settings />
                </AdminRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </ErrorBoundary>
      </main>

      {activeSignal && (
        <SignalModal
          signal={activeSignal}
          onClose={() => setActiveSignal(null)}
        />
      )}

      {liveBanner && (
        <LiveSignalBanner
          signal={liveBanner}
          onClose={() => setLiveBanner(null)}
          onOpen={(s) => { setActiveSignal(s); setLiveBanner(null); }}
        />
      )}
    </div>
  );
}
