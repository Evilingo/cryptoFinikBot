import { useState, useEffect } from 'react';
import api from '../services/api';

function Tooltip({ text }) {
  return (
    <span className="relative group inline-flex items-center">
      <span className="ml-1 w-3.5 h-3.5 rounded-full bg-dark-600 text-gray-500 text-[10px] inline-flex items-center justify-center cursor-help hover:text-gray-300 hover:bg-dark-500 transition-colors font-bold select-none">?</span>
      <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 w-56 bg-dark-900 border border-dark-500 text-gray-200 text-xs rounded-lg px-3 py-2 z-50 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-normal leading-relaxed">
        {text}
      </span>
    </span>
  );
}

function StatCard({ label, value, sub, color = 'text-white', tooltip }) {
  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
      <div className="flex items-center text-xs text-gray-500 mb-1">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function FieldLabel({ children, tip }) {
  return (
    <label className="flex items-center text-xs text-gray-400 mb-1">
      {children}
      {tip && <Tooltip text={tip} />}
    </label>
  );
}

function DirectionToggle({ value, onChange }) {
  return (
    <div className="flex gap-1">
      {[
        { id: 'BOTH',  label: 'Оба' },
        { id: 'LONG',  label: 'LONG' },
        { id: 'SHORT', label: 'SHORT' },
      ].map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
            value === id
              ? id === 'LONG'  ? 'bg-green-500/20 text-accent-green border-green-500/40'
              : id === 'SHORT' ? 'bg-red-500/20 text-accent-red border-red-500/40'
              : 'bg-accent-blue/20 text-accent-blue border-accent-blue/40'
              : 'bg-dark-700 text-gray-400 hover:bg-dark-600 border-transparent'
          }`}
        >
          {label}
        </button>
      ))}
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

function snapshotDuration(s) {
  if (!s.from || !s.to) return null;
  const hours = (new Date(s.to) - new Date(s.from)) / 3600000;
  if (hours < 48) return `~${Math.round(hours)}ч`;
  return `~${Math.round(hours / 24)} дн`;
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [backtest, setBacktest] = useState(null);
  const [btRunning, setBtRunning] = useState(false);
  const [btError, setBtError] = useState(null);
  const [activeTab, setActiveTab] = useState('stats');

  // Optimize state
  const [optRunning, setOptRunning]   = useState(false);
  const [optResults, setOptResults]   = useState(null);
  const [optError, setOptError]       = useState(null);
  const [optPairIds, setOptPairIds]   = useState([]);
  const [optFrom, setOptFrom]         = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [optTo, setOptTo]             = useState(() => new Date().toISOString().slice(0, 10));
  const [optSortKey, setOptSortKey]   = useState('totalPnl');
  const [optDirection, setOptDirection] = useState('BOTH');

  // Backtest form state
  const [btPairId, setBtPairId]       = useState('');
  const [btFrom, setBtFrom]           = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [btTo, setBtTo]               = useState(() => new Date().toISOString().slice(0, 10));
  const [btThreshold, setBtThreshold] = useState(10);
  const [btSl, setBtSl]               = useState(1.5);
  const [btTp, setBtTp]               = useState(3.0);
  const [btDirection, setBtDirection] = useState('BOTH');

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
      const params = {
        pairId: btPairId, from: btFrom, to: btTo + 'T23:59:59Z',
        threshold: btThreshold, slPct: btSl, tpPct: btTp,
      };
      if (btDirection !== 'BOTH') params.direction = btDirection;
      const { data } = await api.get('/stats/backtest', { params });
      setBacktest(data);
    } catch (err) {
      setBtError(err.response?.data?.error || 'Ошибка при запуске бэктеста');
    } finally {
      setBtRunning(false);
    }
  };

  const runOptimize = async () => {
    setOptRunning(true);
    setOptResults(null);
    setOptError(null);
    try {
      const params = { from: optFrom, to: optTo + 'T23:59:59Z' };
      if (optPairIds.length > 0) params.pairIds = optPairIds.join(',');
      if (optDirection !== 'BOTH') params.direction = optDirection;
      const { data } = await api.get('/stats/optimize', { params });
      setOptResults(data);
    } catch (err) {
      setOptError(err.response?.data?.error || 'Ошибка оптимизации');
    } finally {
      setOptRunning(false);
    }
  };

  const togglePair = (pairId) => {
    setOptPairIds((prev) =>
      prev.includes(pairId) ? prev.filter((id) => id !== pairId) : [...prev, pairId]
    );
  };

  const tabs = [
    { id: 'stats',    label: 'Результаты' },
    { id: 'analytics', label: 'Аналитика' },
    { id: 'backtest', label: 'Бэктест' },
    { id: 'optimize', label: 'Оптимизация' },
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

              <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
                <h2 className="text-sm font-semibold mb-3">LONG vs SHORT</h2>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(analytics.byDirection || {}).map(([dir, data]) => (
                    <div key={dir} className={`rounded-lg p-4 border ${dir === 'LONG' ? 'border-accent-green/30 bg-accent-green/5' : 'border-accent-red/30 bg-accent-red/5'}`}>
                      <div className={`text-sm font-bold mb-2 ${dir === 'LONG' ? 'text-accent-green' : 'text-accent-red'}`}>
                        {dir === 'LONG' ? '▲' : '▼'} {dir}
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
                {snapshots.map((s) => {
                  const dur = snapshotDuration(s);
                  const lowData = s.count < 2880; // менее 1 дня
                  return (
                    <div key={s.pairId} className={`rounded-lg p-3 border ${lowData ? 'bg-yellow-900/10 border-yellow-700/30' : 'bg-dark-700 border-transparent'}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="text-sm font-medium">{s.symbol.replace('USDC', 'USDT')}</div>
                        {lowData && <span className="text-[10px] text-yellow-500 font-medium">мало данных</span>}
                      </div>
                      <div className="text-lg font-bold text-accent-blue">{s.count.toLocaleString()}</div>
                      <div className="text-[10px] text-gray-500">
                        {dur ? `${dur}` : ''}{s.from ? ` · с ${new Date(s.from).toLocaleDateString('ru-RU')}` : 'нет данных'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Backtest config */}
          <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
            <h2 className="text-sm font-semibold mb-4">Настройки бэктеста</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              <div>
                <FieldLabel>Пара</FieldLabel>
                <select value={btPairId} onChange={(e) => setBtPairId(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm">
                  {snapshots.map((s) => (
                    <option key={s.pairId} value={s.pairId}>{s.symbol.replace('USDC', 'USDT')} ({s.count.toLocaleString()} снп)</option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>С даты</FieldLabel>
                <input type="date" value={btFrom} onChange={(e) => setBtFrom(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <FieldLabel>По дату</FieldLabel>
                <input type="date" value={btTo} onChange={(e) => setBtTo(e.target.value)} className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <FieldLabel tip="Минимальное синхронное движение всех 4 OBD индикаторов (в пунктах), при котором засчитывается сигнал. Чем выше — тем реже, но «чище» сигналы.">
                  Threshold (OBD дип)
                </FieldLabel>
                <input type="number" value={btThreshold} onChange={(e) => setBtThreshold(e.target.value)} step="1" min="1" max="50" className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <FieldLabel tip="Stop Loss в % от цены входа. При достижении этого уровня сделка закрывается с убытком.">
                  SL %
                </FieldLabel>
                <input type="number" value={btSl} onChange={(e) => setBtSl(e.target.value)} step="0.1" min="0.1" max="10" className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <FieldLabel tip="Take Profit в % от цены входа. При достижении этого уровня сделка закрывается с прибылью. Рекомендуется TP/SL ≥ 2.">
                  TP %
                </FieldLabel>
                <input type="number" value={btTp} onChange={(e) => setBtTp(e.target.value)} step="0.1" min="0.1" max="20" className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
            </div>

            <div className="flex items-center gap-4 mb-4">
              <div>
                <FieldLabel tip="Фильтровать сигналы только по одному направлению. LONG — покупка на росте, SHORT — продажа на падении. Полезно для анализа каждого направления отдельно.">
                  Направление
                </FieldLabel>
                <DirectionToggle value={btDirection} onChange={setBtDirection} />
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

          {btError && (
            <div className="bg-red-900/20 border border-red-700 rounded-xl p-3 text-sm text-red-400">{btError}</div>
          )}

          {/* Backtest results */}
          {backtest && (
            <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
              <h2 className="text-sm font-semibold mb-4">Результаты бэктеста</h2>

              {backtest.stats ? (
                <>
                  {backtest.stats.total < 50 && backtest.stats.total > 0 && (
                    <div className="mb-4 flex items-start gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-3 py-2 text-xs text-yellow-400">
                      <span className="mt-0.5">⚠</span>
                      <span>Найдено только {backtest.stats.total} сигналов — мало для статистически достоверных выводов. Рекомендуется минимум 50 сигналов. Расширьте период или снизьте Threshold.</span>
                    </div>
                  )}

                  <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
                    <StatCard label="Сигналов" value={backtest.stats.total}
                      tooltip="Общее количество сигналов, обнаруженных за выбранный период с учётом 15-минутного кулдауна." />
                    <StatCard label="Winrate" value={`${backtest.stats.winRate}%`}
                      color={backtest.stats.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'}
                      tooltip="Процент сделок, завершившихся в прибыль (цена достигла TP раньше SL)." />
                    <StatCard label="WIN" value={backtest.stats.wins} color="text-accent-green"
                      tooltip="Количество сделок, в которых цена достигла Take Profit." />
                    <StatCard label="LOSS" value={backtest.stats.losses} color="text-accent-red"
                      tooltip="Количество сделок, в которых цена достигла Stop Loss." />
                    <StatCard label="Total P&L" value={`${backtest.stats.totalPnl > 0 ? '+' : ''}${backtest.stats.totalPnl}%`}
                      color={backtest.stats.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}
                      tooltip="Суммарный P&L по всем сделкам — сумма всех выигрышей и проигрышей в процентах." />
                    <StatCard label="Avg P&L" value={`${backtest.stats.avgPnl > 0 ? '+' : ''}${backtest.stats.avgPnl}%`}
                      color={backtest.stats.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}
                      tooltip="Средний P&L на одну сделку. Положительное значение означает, что стратегия прибыльна в среднем." />
                    <StatCard label="Max Drawdown" value={`-${backtest.stats.maxDrawdown}%`}
                      color="text-accent-red"
                      tooltip="Максимальное падение капитала от пика до дна на equity кривой. Показывает худший возможный убыток, если войти в самый неудачный момент." />
                    <StatCard label="Макс. серия" value={backtest.stats.maxConsecutiveLosses}
                      sub="убытков подряд"
                      color={backtest.stats.maxConsecutiveLosses >= 5 ? 'text-accent-red' : 'text-yellow-400'}
                      tooltip="Максимальное количество убыточных сделок подряд. Важно для управления капиталом — показывает, насколько долго может быть «полоса неудач»." />
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

      {/* TAB: Optimize */}
      {activeTab === 'optimize' && (
        <div className="space-y-6">
          <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
            <h2 className="text-sm font-semibold mb-1">Перебор параметров</h2>
            <p className="text-xs text-gray-500 mb-4">
              Перебирает threshold [5,8,10,12,15,20] × SL [0.3,0.5,0.7,1.0]% × TP [1.0,1.5,2.0,3.0]% и показывает лучшие комбинации.
            </p>

            <div className="mb-4">
              <FieldLabel tip="Пары для оптимизации. Если ничего не выбрано — тестируются все активные пары одновременно.">
                Пары (пусто = все)
              </FieldLabel>
              <div className="flex gap-2 flex-wrap mt-1">
                {snapshots.map((s) => (
                  <button
                    key={s.pairId}
                    onClick={() => togglePair(s.pairId)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      optPairIds.includes(s.pairId)
                        ? 'bg-accent-blue text-white'
                        : 'bg-dark-700 text-gray-400 hover:bg-dark-600'
                    }`}
                  >
                    {s.symbol.replace('USDC', 'USDT')}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <FieldLabel>С даты</FieldLabel>
                <input type="date" value={optFrom} onChange={(e) => setOptFrom(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
              <div>
                <FieldLabel>По дату</FieldLabel>
                <input type="date" value={optTo} onChange={(e) => setOptTo(e.target.value)}
                  className="w-full bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm" />
              </div>
            </div>

            <div className="mb-4">
              <FieldLabel tip="Тестировать сигналы только одного направления. Позволяет найти лучшие параметры отдельно для LONG и SHORT.">
                Направление
              </FieldLabel>
              <DirectionToggle value={optDirection} onChange={setOptDirection} />
            </div>

            <button
              onClick={runOptimize}
              disabled={optRunning || snapshots.length === 0}
              className="px-4 py-2 bg-accent-blue hover:bg-blue-600 disabled:opacity-50 rounded-lg text-sm font-medium"
            >
              {optRunning ? 'Считаю...' : 'Запустить оптимизацию'}
            </button>
          </div>

          {optError && (
            <div className="bg-red-900/20 border border-red-700 rounded-xl p-3 text-sm text-red-400">{optError}</div>
          )}

          {optResults && (
            <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">
                  Результаты — {optResults.combinations} комбинаций
                </h2>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  Сортировка:
                  {[
                    { key: 'totalPnl',   label: 'Total P&L' },
                    { key: 'avgPnl',     label: 'Avg P&L' },
                    { key: 'winRate',    label: 'Winrate' },
                    { key: 'maxDrawdown', label: 'Drawdown ↑' },
                  ].map(({ key, label }) => (
                    <button key={key} onClick={() => setOptSortKey(key)}
                      className={`px-2 py-1 rounded ${optSortKey === key ? 'bg-accent-blue text-white' : 'bg-dark-700 hover:bg-dark-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 border-b border-dark-600">
                    <tr>
                      <th className="text-left py-2 px-2">#</th>
                      <th className="text-left py-2 px-2">Пара</th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">Threshold<Tooltip text="Минимальный дип OBD для засчёта сигнала." /></span>
                      </th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">SL%<Tooltip text="Stop Loss в % от цены входа." /></span>
                      </th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">TP%<Tooltip text="Take Profit в % от цены входа." /></span>
                      </th>
                      <th className="text-right py-2 px-2">Сигн.</th>
                      <th className="text-right py-2 px-2">W/L</th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">WR<Tooltip text="Winrate — доля прибыльных сделок." /></span>
                      </th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">Total P&L<Tooltip text="Суммарный P&L по всем сделкам данной комбинации." /></span>
                      </th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">Avg P&L<Tooltip text="Средний P&L на сделку." /></span>
                      </th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">DD<Tooltip text="Max Drawdown — максимальное падение капитала от пика до дна." /></span>
                      </th>
                      <th className="text-right py-2 px-2">
                        <span className="inline-flex items-center">SL×<Tooltip text="Максимальная серия убытков подряд." /></span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-700">
                    {[...optResults.results]
                      .sort((a, b) => optSortKey === 'maxDrawdown' ? a[optSortKey] - b[optSortKey] : b[optSortKey] - a[optSortKey])
                      .slice(0, 30)
                      .map((r, i) => (
                        <tr key={i} className={`hover:bg-dark-700 ${i < 3 ? 'bg-dark-700/40' : ''}`}>
                          <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                          <td className="py-2 px-2 font-medium">{r.symbol.replace('USDT', '').replace('USDC', '')}</td>
                          <td className="py-2 px-2 text-right font-mono">{r.threshold}</td>
                          <td className="py-2 px-2 text-right font-mono">{r.slPct}%</td>
                          <td className="py-2 px-2 text-right font-mono">{r.tpPct}%</td>
                          <td className="py-2 px-2 text-right">{r.total}</td>
                          <td className="py-2 px-2 text-right">
                            <span className="text-accent-green">{r.wins}</span>
                            <span className="text-gray-600">/</span>
                            <span className="text-accent-red">{r.losses}</span>
                          </td>
                          <td className={`py-2 px-2 text-right font-mono ${r.winRate >= 50 ? 'text-accent-green' : 'text-accent-red'}`}>
                            {r.winRate}%
                          </td>
                          <td className={`py-2 px-2 text-right font-mono font-bold ${r.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                            {r.totalPnl > 0 ? '+' : ''}{r.totalPnl}%
                          </td>
                          <td className={`py-2 px-2 text-right font-mono ${r.avgPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                            {r.avgPnl > 0 ? '+' : ''}{r.avgPnl}%
                          </td>
                          <td className="py-2 px-2 text-right font-mono text-accent-red">
                            -{r.maxDrawdown}%
                          </td>
                          <td className={`py-2 px-2 text-right font-mono ${r.maxConsLosses >= 5 ? 'text-accent-red' : 'text-gray-400'}`}>
                            {r.maxConsLosses}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
