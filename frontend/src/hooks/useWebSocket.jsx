import { useEffect, useRef, useCallback, useState } from 'react';
import axios from 'axios';
import { getAccessToken, setAccessToken } from '../services/api';

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef(null);
  const mountedRef = useRef(true);
  const retryCountRef = useRef(0);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getAccessToken();
    const url = token
      ? `${protocol}//${window.location.host}/ws?token=${token}`
      : `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setConnected(true);
      retryCountRef.current = 0;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current?.(data);
      } catch {}
    };

    ws.onclose = (event) => {
      setConnected(false);
      if (event.code === 1000) return;
      const delay = Math.min(3000 * Math.pow(2, retryCountRef.current), 30000);
      retryCountRef.current += 1;
      reconnectTimer.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        try {
          const { data } = await axios.post('/api/auth/refresh', null, { withCredentials: true });
          setAccessToken(data.accessToken);
        } catch {
          // refresh failed — redirect to login
          window.location.href = '/login';
          return;
        }
        connect();
      }, delay);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close(1000);
    };
  }, [connect]);

  return { connected };
}
