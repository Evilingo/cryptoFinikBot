import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Signals from './pages/Signals';
import Settings from './pages/Settings';
import Stats from './pages/Stats';
import Sidebar from './components/layout/Sidebar';

function ProtectedRoute({ children }) {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return authenticated ? children : <Navigate to="/login" />;
}

function Layout({ children }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout><Dashboard /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/signals"
          element={
            <ProtectedRoute>
              <Layout><Signals /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/stats"
          element={
            <ProtectedRoute>
              <Layout><Stats /></Layout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Layout><Settings /></Layout>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AuthProvider>
  );
}
