import { useRef, useCallback, useEffect } from 'react';

/**
 * Генерирует звуковой алерт программно через Web Audio API.
 * Три восходящих тона — привлекает внимание трейдера.
 */
export function useAlertSound() {
  const ctxRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function playTones(ctx) {
    const now = ctx.currentTime;
    const freqs = [520, 680, 880];
    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.15);
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.15 + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + i * 0.15 + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.2);
    });
  }

  const play = useCallback(() => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = ctxRef.current;
      playTones(ctx);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (ctxRef.current) playTones(ctxRef.current);
        timerRef.current = null;
      }, 800);
    } catch {
      // Audio не поддерживается
    }
  }, []);

  return play;
}
