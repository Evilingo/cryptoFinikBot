import { useState, useEffect } from 'react';
import api from '../services/api';
import { CoinGlyph, Icon, formatPrice, formatTime } from '../components/primitives';

function StatusBadge({ status }) {
  if (status === 'OPEN') return <span className="badge badge-pending">OPEN</span>;
  return <span className="badge badge-win">CLOSED</span>;
}

function SideBadge({ side }) {
  const cls = side === 'BUY' ? 'badge-long' : 'badge-short';
  const arrow = side === 'BUY' ? '▲' : '▼';
  return <span className={`badge ${cls}`}>{arrow} {side}</span>;
}

export default function Trades() {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/trade')
      .then(({ data }) => setTrades(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const open = trades.filter(t => t.status === 'OPEN');
  const closed = trades.filter(t => t.status === 'CLOSED');
  const totalPnl = closed.reduce((a, t) => a + (t.pnl || 0), 0);

  const base = (symbol) => symbol.replace(/USDT$|USDC$|BUSD$/, '');

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>Trades</h1>
          <p>Real orders placed on exchange · auto-trade + manual</p>
        </div>
        <div className="topbar-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Open</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{open.length}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Closed PnL</div>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: totalPnl >= 0 ? 'var(--long)' : 'var(--short)' }}>
                {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48, color: 'var(--text-3)' }}>Loading…</div>
      ) : trades.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 64, color: 'var(--text-3)' }}>
          <Icon name="grid" size={32} />
          <span>No trades yet</span>
        </div>
      ) : (
        <div className="signals-table">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Side</th>
                <th className="num">Entry</th>
                <th className="num">Quantity</th>
                <th className="num">Notional</th>
                <th className="num">Stop Loss</th>
                <th className="num">Take Profit</th>
                <th>Status</th>
                <th className="num">PnL</th>
                <th>Order ID</th>
              </tr>
            </thead>
            <tbody>
              {trades.map(t => (
                <tr key={t.id}>
                  <td className="time">{formatTime(t.createdAt)}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <CoinGlyph symbol={base(t.symbol)} size={22} />
                      <span style={{ fontWeight: 600 }}>{base(t.symbol)}</span>
                    </div>
                  </td>
                  <td><SideBadge side={t.side} /></td>
                  <td className="num mono">${formatPrice(t.price)}</td>
                  <td className="num mono">{t.quantity.toFixed(6)}</td>
                  <td className="num mono">${formatPrice(t.price * t.quantity)}</td>
                  <td className="num mono" style={{ color: t.stopLoss ? 'var(--short)' : 'var(--text-4)' }}>
                    {t.stopLoss ? `$${formatPrice(t.stopLoss)}` : '—'}
                  </td>
                  <td className="num mono" style={{ color: t.takeProfit ? 'var(--long)' : 'var(--text-4)' }}>
                    {t.takeProfit ? `$${formatPrice(t.takeProfit)}` : '—'}
                  </td>
                  <td><StatusBadge status={t.status} /></td>
                  <td className="num">
                    {t.pnl != null ? (
                      <span style={{ color: t.pnl > 0 ? 'var(--long)' : t.pnl < 0 ? 'var(--short)' : 'var(--text-3)', fontWeight: 600 }}>
                        {t.pnl > 0 ? '+' : ''}{t.pnl.toFixed(2)}%
                      </span>
                    ) : <span style={{ color: 'var(--text-4)' }}>—</span>}
                  </td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {t.binanceOrderId || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
