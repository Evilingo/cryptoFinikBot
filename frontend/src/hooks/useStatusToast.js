import { useState, useRef } from 'react';

export function useStatusToast(timeout = 3000) {
  const [status, setStatus] = useState(null);
  const timerRef = useRef(null);
  const showStatus = (ok, msg) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setStatus({ ok, msg });
    timerRef.current = setTimeout(() => setStatus(null), timeout);
  };
  return { status, showStatus };
}
