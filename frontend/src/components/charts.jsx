import { useEffect, useRef, useState } from 'react';

export function genCandles(basePrice, count = 60) {
  const candles = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = (Math.random() - 0.5) * price * 0.003;
    const close = open + drift;
    const high = Math.max(open, close) * (1 + Math.random() * 0.001);
    const low = Math.min(open, close) * (1 - Math.random() * 0.001);
    candles.push({ o: open, c: close, h: high, l: low });
    price = close;
  }
  return candles;
}

export function Sparkchart({ candles, height = 100 }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 300, h: height });

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  if (!candles || !candles.length || w < 10) return <div ref={ref} style={{width:'100%',height:'100%'}}/>;

  let hi = Math.max(...candles.map(c => c.h));
  let lo = Math.min(...candles.map(c => c.l));
  if (hi === lo) { const p = hi * 0.002 || 0.5; hi += p; lo -= p; }
  const range = hi - lo;
  const pad = 6;
  const chartH = h - pad * 2;
  const y = v => pad + chartH - ((v - lo) / range) * chartH;
  const cw = (w - 8) / candles.length;
  const bodyW = Math.max(1.5, cw * 0.65);

  const linePts = candles.map((c, i) => `${i * cw + cw/2 + 4},${y(c.c)}`).join(' ');

  return (
    <div ref={ref} style={{width:'100%',height:'100%'}}>
      <svg className="sparkchart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`fillg-${candles.length}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.15"/>
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <polygon
          points={`4,${h-pad} ${linePts} ${w-4},${h-pad}`}
          fill={`url(#fillg-${candles.length})`}
        />
        {candles.map((c, i) => {
          const x = i * cw + 4;
          const up = c.c >= c.o;
          return (
            <g key={i}>
              <line x1={x + cw/2} x2={x + cw/2} y1={y(c.h)} y2={y(c.l)} className="wick" opacity="0.5"/>
              <rect
                x={x + (cw - bodyW) / 2}
                y={y(Math.max(c.o, c.c))}
                width={bodyW}
                height={Math.max(1, Math.abs(y(c.o) - y(c.c)))}
                className={up ? 'candle-up' : 'candle-dn'}
                opacity="0.85"
              />
            </g>
          );
        })}
        <polyline points={linePts} fill="none" stroke="var(--primary)" strokeWidth="1.2" opacity="0.9"/>
      </svg>
    </div>
  );
}

export function EquityChart({ data }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 600, h: 240 });

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  if (!data || data.length < 2) {
    return <div ref={ref} style={{width:'100%', height: size.h + 'px'}} />;
  }

  const { w, h } = size;
  const hi = Math.max(...data);
  const lo = Math.min(...data);
  const range = hi - lo || 1;
  const pad = 20;
  const chartH = h - pad * 2;
  const pts = data.map((v, i) => `${pad + (i / (data.length - 1)) * (w - pad * 2)},${pad + chartH - ((v - lo) / range) * chartH}`).join(' ');

  return (
    <div ref={ref} style={{width:'100%', height: h + 'px'}}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{width:'100%', height:'100%'}}>
        <defs>
          <linearGradient id="equityG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.3"/>
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(p => (
          <line key={p} x1={pad} x2={w-pad} y1={pad + chartH * p} y2={pad + chartH * p} stroke="var(--line)" strokeDasharray="2 4"/>
        ))}
        <polygon points={`${pad},${h-pad} ${pts} ${w-pad},${h-pad}`} fill="url(#equityG)"/>
        <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2"/>
        <line x1={pad} x2={w-pad}
          y1={pad + chartH - ((1000 - lo) / range) * chartH}
          y2={pad + chartH - ((1000 - lo) / range) * chartH}
          stroke="var(--text-4)" strokeDasharray="3 3"/>
      </svg>
    </div>
  );
}
