const COIN_COLORS = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#9945ff',
  BNB: '#f3ba2f',
};

export function Logo({ size = 36, showWord = true, sub = true }) {
  return (
    <div className="logo">
      <div className="logo-mark" style={{ width: size, height: size }}>
        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="flog" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.18"/>
              <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="36" height="36" rx="6" fill="var(--primary)"/>
          <rect x="2" y="2" width="36" height="36" rx="6" fill="url(#flog)"/>
          <rect x="2.5" y="2.5" width="35" height="35" rx="5.5" fill="none"
                stroke="var(--bg-0)" strokeOpacity="0.12" strokeWidth="1"/>
          <path d="M13 11 h14 v3.8 h-10 v5.4 h8 v3.8 h-8 v6.2 h-4 z"
                fill="var(--bg-0)"/>
          <circle cx="30" cy="28" r="2.2" fill="var(--bg-0)"/>
        </svg>
      </div>
      {showWord && (
        <div>
          <div className="logo-word">Finik<span className="dot">.</span></div>
          {sub && <div className="logo-sub">Signals engine</div>}
        </div>
      )}
    </div>
  );
}

export function Icon({ name, size = 18 }) {
  const paths = {
    dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
    signal: <><path d="M3 12h3l3-7 4 14 3-7h5"/></>,
    stats: <><path d="M3 20V10m6 10V4m6 16v-8m6 8v-5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
    logout: <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></>,
    close: <><path d="M6 6l12 12M6 18L18 6"/></>,
    filter: <><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></>,
    search: <><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow_up: <><path d="M12 19V5M5 12l7-7 7 7"/></>,
    arrow_dn: <><path d="M12 5v14M5 12l7 7 7-7"/></>,
    bell: <><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></>,
    chevron: <><path d="M9 6l6 6-6 6"/></>,
    sparkle: <><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/></>,
    play: <><path d="M5 3l14 9-14 9V3z"/></>,
    pause: <><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></>,
    grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    maximize: <><path d="M3 3h7v2H5v5H3V3zM14 3h7v7h-2V5h-5V3zM21 14v7h-7v-2h5v-5h2zM10 21H3v-7h2v5h5v2z"/></>,
    telegram: <><path d="M21.5 4.3L2.5 12.1c-1 .4-1 1.5 0 1.8l4.7 1.5 1.8 5.7c.2.7 1.1.9 1.7.4l2.7-2.2 4.9 3.6c.8.6 2 .2 2.2-.8l3.3-16c.3-1.3-1-2.4-2.3-1.8zM9.5 15.2l.8 4.3 1.6-2 3-2.4-5.4.1z"/></>,
    key: <><circle cx="8" cy="15" r="4"/><path d="M10.85 12.15L19 4M19 4l2 2M15 8l2 2"/></>,
    shield: <><path d="M12 2l9 4v6c0 5-4 9-9 10-5-1-9-5-9-10V6l9-4z"/></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function CoinGlyph({ symbol, size = 26 }) {
  const base = typeof symbol === 'string'
    ? symbol.replace(/USDC$|USDT$/, '')
    : symbol;
  const color = COIN_COLORS[base] || '#d4a574';
  return (
    <div
      className="coin-glyph"
      style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}
    >
      {base?.[0]}
    </div>
  );
}

export function ConfidenceBadge({ value }) {
  if (value == null) return <span className="badge badge-pending">—</span>;
  const cls = value >= 70 ? 'conf-high' : value >= 55 ? 'conf-med' : 'conf-low';
  return (
    <span className={`conf-pill ${cls}`}>
      <span className="dot" />{value}%
    </span>
  );
}

export function DirectionBadge({ dir }) {
  const cls = dir === 'LONG' ? 'badge-long' : dir === 'SHORT' ? 'badge-short' : 'badge-wait';
  const arrow = dir === 'LONG' ? '▲' : dir === 'SHORT' ? '▼' : '◆';
  return <span className={`badge ${cls}`}>{arrow} {dir}</span>;
}

export function OutcomeBadge({ outcome, direction }) {
  if (!outcome) {
    if (direction === 'WAIT') return <span className="badge badge-wait">NO TRADE</span>;
    return <span className="badge badge-pending">OPEN</span>;
  }
  const map = { WIN: 'badge-win', LOSS: 'badge-loss', BREAKEVEN: 'badge-warn' };
  return <span className={`badge ${map[outcome] || 'badge-pending'}`}>{outcome}</span>;
}

export function Toggle({ on, onChange }) {
  return <div className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}

export function ConnIndicator({ connected = true, exchange = 'Binance' }) {
  return (
    <span className="conn-indicator">
      <span className="d" style={!connected ? { background: 'var(--short)' } : {}} />
      {connected ? `${exchange} ws · live` : 'Disconnected'}
    </span>
  );
}

export function formatPrice(v, decimals) {
  if (v == null) return '—';
  const d = decimals ?? (v > 1000 ? 2 : v > 10 ? 2 : 3);
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function formatTime(ts) {
  const d = new Date(ts);
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
