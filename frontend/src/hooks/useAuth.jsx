import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api, { setAccessToken, getAccessToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authenticated, setAuthenticated] = useState(!!getAccessToken());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to refresh on mount
    api.post('/auth/refresh')
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        setAuthenticated(true);
      })
      .catch(() => {
        setAuthenticated(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password, remember = true) => {
    const { data } = await api.post('/auth/login', { username, password, remember });
    setAccessToken(data.accessToken);
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch {}
    setAccessToken(null);
    setAuthenticated(false);
  }, []);

  return (
    <AuthContext.Provider value={{ authenticated, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
