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
          className={`h-full rounded-full ${isPositive ? 'bg-accent-green' : 'bg-accent-red'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function EquityCurve({ curve }) {
  if (!curve?.length) return null;
  const min = Math.min(...curve, 0);
  const max = Math.max(...curve, 0);
  const range = max - min || 1;
  const w = 600;
  const h = 80;
  const pts = curve.map((v, i) => {
    const x = (i / (curve.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const lastVal = curve[curve.length - 1];
  return (
    <div className="mt-3">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>Equity curve</span>
        <span className={lastVal >= 0 ? 'text-accent-green' : 'text-accent-red'}>
          {lastVal >= 0 ? '+' : ''}{lastVal.toFixed(2)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-16">
        <polyline points={pts} fill="none" stroke={lastVal >= 0 ? '#22c55e' : '#ef4444'} strokeWidth="2" />
        <line x1="0" y1={h - ((0 - min) / range) * h} x2={w} y2={h - ((0 - min) / range) * h}
          stroke="#374151" strokeWidth="1" strokeDasharray="4 2" />
      </svg>
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [backtest, setBacktest] = useState(null);
  const [btRunning, setBtRunning] = useState(false);
  const [btError, setBtError] = useState(null);
  const [activeTab, setActiveTab] = useState('stats');

  // Backtest form state
  const [btPairId, setBtPairId] = useState('');
  const [btFrom, setBtFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [btTo, setBtTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [btThreshold, setBtThreshold] = useState(10);
  const [btSl, setBtSl] = useState(1.5);
  const [btTp, setBtTp] = useState(3.0);

  useEffect(() => {
    api.get('/stats').then(({ data }) => setStats(data)).catch(() => {});
    api.get('/stats/analytics').then(({ data }) => setAnalytics(data)).catch(() => {});
    api.get('/stats/snapshots').then(({ data }) => {
      setSnapshots(data);
      if (data.length > 0 && !btPairId) setBtPairId(String(data[0].pairId));
    }).catch(() => {});
  }, []);

  const runBacktest = async () => {
    if (!btPairId) return;
    setBtRunning(true);
    setBacktest(null);
    setBtError(null);
    try {
      const { data } = await api.get('/stats/backtest', {
        params: { pairId: btPairId, from: btFrom, to: btTo + 'T23:59:59Z', threshold: btThreshold, slPct: btSl, tpPct: btTp },
      });
      setBacktest(data);
    } catch (err) {
      setBtError(err.response?.data?.error || 'Ошибка при запуске бэктеста');
    } finally {
      setBtRunning(false);
    }
  };

  const tabs = [
    { id: 'stats', label: 'Результаты' },
    { id: 'analytics', label: 'Аналитика' },
    { id: 'backtest', label: 'Бэктест' },
  ];

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-4">Signal Accuracy</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-dark-600">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB: Stats */}
      {activeTab === 'stats' && (
        <>
          {!stats || stats.total === 0 ? (
            <div className="bg-dark-800 rounded-xl border border-dark-600 p-8 text-center text-gray-500">
              No completed signals yet. Stats will appear after signals are tracked.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
                <StatCard label="Total Signals" value={stats.total} />
                <StatCard label="Win Rate" value={`${stats.winRate}%`} color={stats.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'} />
                <StatCard label="Wins" value={stats.wins} color="text-accent-green" />
                <StatCard label="Losses" value={stats.losses} color="text-accent-red" />
                <StatCard label="Avg P&L" value={`${stats.avgPnl > 0 ? '+' : ''}${stats.avgPnl}%`} color={stats.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} />
                <StatCard label="Total P&L" value={`${stats.totalPnl > 0 ? '+' : ''}${stats.totalPnl}%`} color={stats.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} />
              </div>

              <div className="bg-dark-800 rounded-xl border border-dark-600 p-4 mb-6">
                <h2 className="text-sm font-semibold mb-3">By Pair</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(stats.byPair).map(([sym, data]) => (
                    <div key={sym} className="bg-dark-700 rounded-lg p-3">
                      <div className="font-medium text-sm mb-2">{sym.replace('USDC', '')}</div>
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className={`text-lg font-bold ${data.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'}`}>{data.winRate}%</span>
                        <span className="text-xs text-gray-500">win rate</span>
                      </div>
                      <div className="text-xs text-gray-400">{data.wins}W / {data.losses}L of {data.total}</div>
                      <div className={`text-xs font-mono mt-1 ${data.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        avg {data.avgPnl > 0 ? '+' : ''}{data.avgPnl}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
                <h2 className="text-sm font-semibold mb-3">Recent Results (last 20)</h2>
                <div className="flex gap-1 mb-4">
                  {(stats.recent || []).map((r) => (
                    <div key={r.id}
                      className={`flex-1 h-8 rounded-sm ${r.outcome === 'WIN' ? 'bg-accent-green' : r.outcome === 'LOSS' ? 'bg-accent-red' : 'bg-gray-600'}`}
                      title={`${r.pair?.monitorSymbol} ${r.direction} ${r.outcome} ${r.outcomePnl}%`}
                    />
                  ))}
                </div>
                <div className="space-y-1.5">
                  {(stats.recent || []).map((r) => (
                    <div key={r.id} className="flex items-center gap-3">
                      <span className="w-10 text-xs text-gray-500">{r.pair?.monitorSymbol.replace('USDC', '')}</span>
                      <span className={`w-10 text-xs font-bold ${r.outcome === 'WIN' ? 'text-accent-green' : r.outcome === 'LOSS' ? 'text-accent-red' : 'text-gray-400'}`}>{r.outcome}</span>
                      <div className="flex-1"><PnlBar value={r.outcomePnl || 0} max={Math.max(...(stats.recent || []).map((x) => Math.abs(x.outcomePnl || 0)), 1)} /></div>
                      <span className="text-[10px] text-gray-600 w-20 text-right">
                        {new Date(r.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* TAB: Analytics */}
      {activeTab === 'analytics' && (
        <>
          {!analytics ? (
            <div className="text-gray-500">Loading...</div>
          ) : (
            <div className="space-y-6">
              {/* By confidence */}
              <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
                <h2 className="text-sm font-semibold mb-3">Winrate по уровню уверенности</h2>
                <div className="grid grid-cols-4 gap-3">
                  {(analytics.byConfidence || []).map((b) => (
                    <div key={b.label} className="bg-dark-700 rounded-lg p-3 text-center">
                      <div className="text-xs text-gray-400 mb-1">Confidence {b.label}</div>
                      <div className={`text-xl font-bold ${b.winRate >= 50 ? 'text-accent-green' : b.total === 0 ? 'text-gray-500' : 'text-accent-red'}`}>
                        {b.total === 0 ? '—' : `${b.winRate}%`}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{b.wins}W / {b.losses}L ({b.total})</div>
                      {b.total > 0 && (
                        <div className={`text-xs font-mono mt-1 ${b.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          avg {b.avgPnl > 0 ? '+' : ''}{b.avgPnl}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* By direction */}
              <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
                <h2 className="text-sm font-semibold mb-3">LONG vs SHORT</h2>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(analytics.byDirection || {}).map(([dir, data]) => (
                    <div key={dir} className={`rounded-lg p-4 border ${dir === 'LONG' ? 'border-accent-green/30 bg-accent-green/5' : 'border-accent-red/30 bg-accent-red/5'}`}>
                      <div className={`text-sm font-bold mb-2 ${dir === 'LONG' ? 'text-accent-green' : 'text-accent-red'}`}>
                        {dir === 'LONG' ? '🟢' : '🔴'} {dir}
                      </div>
                      <div className="text-2xl font-bold mb-1">{data.total === 0 ? '—' : `${data.winRate}%`}</div>
                      <div className="text-xs text-gray-400">{data.wins}W / {data.losses}L of {data.total}</div>
                      {data.total > 0 && (
                        <div className={`text-xs font-mono mt-1 ${data.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                          avg {data.avgPnl > 0 ? '+' : ''}{data.avgPnl}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* By hour heatmap */}
              <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
                <h2 className="text-sm font-semibold mb-3">Winrate по часам (UTC)</h2>
                <div className="grid grid-cols-12 gap-1">
                  {(analytics.byHour || []).map((h) => {
                    const hasData = h.total > 0;
                    const intensity = hasData ? h.winRate / 100 : null;
                    return (
                      <div key={h.hour} className="text-center">
                        <div
                          className="h-8 rounded text-[10px] flex items-center justify-center font-mono"
                          style={{
                            backgroundColor: hasData
                              ? `rgba(${h.winRate >= 50 ? '34,197,94' : '239,68,68'},${0.2 + intensity * 0.6})`
                              : '#1f2937',
                            color: hasData ? 'white' : '#4b5563',
                          }}
                          title={`${h.hour}:00 UTC — ${h.total} signals, ${h.winRate}% WR`}
                        >
                          {hasData ? `${h.winRate}%` : '—'}
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5">{h.hour}h</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB: Backtest */}
      {activeTab === 'backtest' && (
        <div className="space-y-6">
          {/* Snapshot status */}
          <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
            <h2 className="text-sm font-semibold mb-3">OBD данные для бэктеста</h2>
            {snapshots.length === 0 ? (
              <p className="text-sm text-gray-500">Снапшоты ещё не накоплены. Они записываются каждые 30 секунд автоматически.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {snapshots.map((s) => (
                  <div key={s.pairId} className="bg-dark-700 rounded-lg p-3">
                    <div className="text-sm font-medium">{s.symbol.replace('USDC', '')}</div>
                    <div className="text-lg font-bold text-accent-blue">{s.count.toLocaleString()}</div>
                    <div className="text-[10px] text-gray-500">
                      {s.from ? `с ${new Date(s.from).toLocaleDateString('ru-RU')}` : 'нет данных'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Backtest config */}
          <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
            <h2 className="text-sm font-semibold mb-4">Настройки бэктеста</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Пара</label>
                <select value={btPairId} onChange={(e) => setBtPairId(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm">
                  {snapshots.map((s) => (
                    <option key={s.pairId} value={s.pairId}>{s.symbol.replace('USDC', '')} ({s.count} снапшотов)</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">С даты</label>
                <input type="date" value={btFrom} onChange={(e) => setBtFrom(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">По дату</label>
                <input type="date" value={btTo} onChange={(e) => setBtTo(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Threshold (OBD дип)</label>
                <input type="number" value={btThreshold} onChange={(e) => setBtThreshold(e.target.value)} step="1" min="1" max="50" className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">SL %</label>
                <input type="number" value={btSl} onChange={(e) => setBtSl(e.target.value)} step="0.1" min="0.1" max="10" className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">TP %</label>
                <input type="number" value={btTp} onChange={(e) => setBtTp(e.target.value)} step="0.1" min="0.1" max="20" className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
            </div>
            <button
              onClick={runBacktest}
              disabled={btRunning || snapshots.length === 0}
              className="px-4 py-2 bg-accent-blue hover:bg-blue-600 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {btRunning ? 'Запуск...' : 'Запустить бэктест'}
            </button>
          </div>

          {/* Backtest error */}
          {btError && (
            <div className="bg-red-900/20 border border-red-700 rounded-xl p-3 text-sm text-red-400">
              {btError}
            </div>
          )}

          {/* Backtest results */}
          {backtest && (
            <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
              <h2 className="text-sm font-semibold mb-4">Результаты бэктеста</h2>

              {backtest.stats ? (
                <>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
                    <StatCard label="Сигналов" value={backtest.stats.total} />
                    <StatCard label="Winrate" value={`${backtest.stats.winRate}%`} color={backtest.stats.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'} />
                    <StatCard label="WIN" value={backtest.stats.wins} color="text-accent-green" />
                    <StatCard label="LOSS" value={backtest.stats.losses} color="text-accent-red" />
                    <StatCard label="Total P&L" value={`${backtest.stats.totalPnl > 0 ? '+' : ''}${backtest.stats.totalPnl}%`} color={backtest.stats.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} />
                    <StatCard label="Avg P&L" value={`${backtest.stats.avgPnl > 0 ? '+' : ''}${backtest.stats.avgPnl}%`} color={backtest.stats.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'} />
                  </div>

                  <EquityCurve curve={backtest.equityCurve} />

                  {backtest.signals.length > 0 && (
                    <div className="mt-4 max-h-60 overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="text-gray-500 border-b border-dark-600">
                          <tr>
                            <th className="text-left py-1">Время</th>
                            <th className="text-left py-1">Dir</th>
                            <th className="text-right py-1">Вход</th>
                            <th className="text-right py-1">Выход</th>
                            <th className="text-right py-1">P&L</th>
                            <th className="text-center py-1">Итог</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-700">
                          {backtest.signals.map((s, i) => (
                            <tr key={i} className="hover:bg-dark-700">
                              <td className="py-1 text-gray-500">{new Date(s.createdAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                              <td className={`py-1 font-bold ${s.direction === 'LONG' ? 'text-accent-green' : 'text-accent-red'}`}>{s.direction}</td>
                              <td className="py-1 text-right font-mono">{s.entryPrice.toFixed(2)}</td>
                              <td className="py-1 text-right font-mono">{s.exitPrice.toFixed(2)}</td>
                              <td className={`py-1 text-right font-mono ${s.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{s.pnl > 0 ? '+' : ''}{s.pnl}%</td>
                              <td className={`py-1 text-center font-bold ${s.outcome === 'WIN' ? 'text-accent-green' : s.outcome === 'LOSS' ? 'text-accent-red' : 'text-gray-400'}`}>{s.outcome}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-sm">
                  Недостаточно снапшотов в выбранном периоде. Нужно минимум 24 точки (12 минут при 30с интервале).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
