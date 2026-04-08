import { useRef, useCallback } from 'react';

/**
 * Генерирует звуковой алерт программно через Web Audio API.
 * Три восходящих тона — привлекает внимание трейдера.
 */
export function useAlertSound() {
  const ctxRef = useRef(null);

  const play = useCallback(() => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      const ctx = ctxRef.current;
      const now = ctx.currentTime;

      // Три восходящих тона: 520 → 680 → 880 Hz
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

      // Повторяем через 1 секунду для усиления
      setTimeout(() => {
        const now2 = ctx.currentTime;
        const freqs2 = [520, 680, 880];
        freqs2.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0, now2 + i * 0.15);
          gain.gain.linearRampToValueAtTime(0.25, now2 + i * 0.15 + 0.02);
          gain.gain.linearRampToValueAtTime(0, now2 + i * 0.15 + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now2 + i * 0.15);
          osc.stop(now2 + i * 0.15 + 0.2);
        });
      }, 800);
    } catch {
      // Audio не поддерживается — игнорируем
    }
  }, []);

  return play;
}
