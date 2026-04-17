import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import Settings from './pages/Settings';
import Stats from './pages/Stats';
import Sidebar from './components/layout/Sidebar';

// AdminRoute — only for Settings; redirects to /login if not authenticated
function AdminRoute({ children }) {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return authenticated ? children : <Navigate to="/login" state={{ from: '/settings' }} />;
}

function Layout({ children }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Layout><Dashboard /></Layout>} />
          <Route path="/signals" element={<Layout><Signals /></Layout>} />
          <Route path="/stats" element={<Layout><Stats /></Layout>} />
          <Route
            path="/settings"
            element={
              <AdminRoute>
                <Layout><Settings /></Layout>
              </AdminRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
