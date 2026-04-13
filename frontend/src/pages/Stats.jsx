import { useState, useEffect } from 'react';
import api from '../services/api';

function StatCard({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function PnlBar({ value, max }) {
  const width = Math.min(Math.abs(value) / (max || 1) * 100, 100);
  const isPositive = value >= 0;
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 text-right text-xs font-mono">
        <span className={isPositive ? 'text-accent-green' : 'text-accent-red'}>
          {isPositive ? '+' : ''}{value.toFixed(2)}%
        </span>
      </div>
      <div className="flex-1 h-2 bg-dark-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isPositive ? 'bg-accent-green' : 'bg-accent-red'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get('/stats').then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  if (!stats) return <div className="text-gray-500">Loading...</div>;

  const recent = stats.recent || [];
  const maxPnl = recent.length > 0
    ? Math.max(...recent.map((r) => Math.abs(r.outcomePnl || 0)), 1)
    : 1;

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-4">Signal Accuracy</h1>

      {stats.total === 0 ? (
        <div className="bg-dark-800 rounded-xl border border-dark-600 p-8 text-center text-gray-500">
          No completed signals yet. Stats will appear after signals are tracked.
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
            <StatCard label="Total Signals" value={stats.total} />
            <StatCard label="Win Rate" value={`${stats.winRate}%`} color={stats.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'} />
            <StatCard label="Wins" value={stats.wins} color="text-accent-green" />
            <StatCard label="Losses" value={stats.losses} color="text-accent-red" />
            <StatCard label="Avg P&L" value={`${stats.avgPnl > 0 ? '+' : ''}${stats.avgPnl}%`} color={stats.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} />
            <StatCard label="Total P&L" value={`${stats.totalPnl > 0 ? '+' : ''}${stats.totalPnl}%`} color={stats.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} />
          </div>

          {/* By pair */}
          <div className="bg-dark-800 rounded-xl border border-dark-600 p-4 mb-6">
            <h2 className="text-sm font-semibold mb-3">By Pair</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(stats.byPair).map(([sym, data]) => (
                <div key={sym} className="bg-dark-700 rounded-lg p-3">
                  <div className="font-medium text-sm mb-2">{sym.replace('USDC', '')}</div>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-lg font-bold ${data.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {data.winRate}%
                    </span>
                    <span className="text-xs text-gray-500">win rate</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {data.wins}W / {data.losses}L of {data.total}
                  </div>
                  <div className={`text-xs font-mono mt-1 ${data.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                    avg {data.avgPnl > 0 ? '+' : ''}{data.avgPnl}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent results */}
          <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
            <h2 className="text-sm font-semibold mb-3">Recent Results (last 20)</h2>

            {/* Win/loss streak visualization */}
            <div className="flex gap-1 mb-4">
              {recent.map((r) => (
                <div
                  key={r.id}
                  className={`flex-1 h-8 rounded-sm ${
                    r.outcome === 'WIN' ? 'bg-accent-green' : r.outcome === 'LOSS' ? 'bg-accent-red' : 'bg-gray-600'
                  }`}
                  title={`${r.pair?.monitorSymbol} ${r.direction} ${r.outcome} ${r.outcomePnl}%`}
                />
              ))}
            </div>

            {/* P&L bars */}
            <div className="space-y-1.5">
              {recent.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="w-10 text-xs text-gray-500">{r.pair?.monitorSymbol.replace('USDC', '')}</span>
                  <span className={`w-10 text-xs font-bold ${r.outcome === 'WIN' ? 'text-accent-green' : r.outcome === 'LOSS' ? 'text-accent-red' : 'text-gray-400'}`}>
                    {r.outcome}
                  </span>
                  <div className="flex-1">
                    <PnlBar value={r.outcomePnl || 0} max={maxPnl} />
                  </div>
                  <span className="text-[10px] text-gray-600 w-20 text-right">
                    {new Date(r.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
