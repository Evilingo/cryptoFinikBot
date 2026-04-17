import { useState, useEffect } from 'react';
import api from '../services/api';
import { Icon } from '../components/primitives';
import { EquityChart } from '../components/charts';

function Tooltip({ text }) {
  return (
    <span className="relative group inline-flex items-center" style={{position: 'relative', display: 'inline-flex'}}>
      <span style={{
        marginLeft: 4, width: 14, height: 14, borderRadius: '50%',
        background: 'var(--bg-3)', color: 'var(--text-3)', fontSize: 10,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'help', fontWeight: 700,
      }} title={text}>?</span>
    </span>
  );
}

function DirectionToggle({ value, onChange }) {
  return (
    <div style={{display: 'flex', gap: 4}}>
      {[
        { id: 'BOTH', label: 'Both' },
        { id: 'LONG', label: 'LONG' },
        { id: 'SHORT', label: 'SHORT' },
      ].map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`btn btn-ghost ${value === id ? 'active' : ''}`}
          style={{
            padding: '6px 12px', fontSize: 12,
            ...(value === id && id === 'LONG' ? { background: 'color-mix(in srgb, var(--long) 15%, transparent)', color: 'var(--long)', borderColor: 'color-mix(in srgb, var(--long) 25%, transparent)' } : {}),
            ...(value === id && id === 'SHORT' ? { background: 'color-mix(in srgb, var(--short) 15%, transparent)', color: 'var(--short)', borderColor: 'color-mix(in srgb, var(--short) 25%, transparent)' } : {}),
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function snapshotDuration(s) {
  if (!s.from || !s.to) return null;
  const hours = (new Date(s.to) - new Date(s.from)) / 3600000;
  if (hours < 48) return `~${Math.round(hours)}h`;
  return `~${Math.round(hours / 24)}d`;
}

export default function Stats() {
  const [stats, setStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [backtest, setBacktest] = useState(null);
  const [btRunning, setBtRunning] = useState(false);
  const [btError, setBtError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  const [optRunning, setOptRunning] = useState(false);
  const [optResults, setOptResults] = useState(null);
  const [optError, setOptError] = useState(null);
  const [optPairIds, setOptPairIds] = useState([]);
  const [optFrom, setOptFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [optTo, setOptTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [optSortKey, setOptSortKey] = useState('totalPnl');
  const [optDirection, setOptDirection] = useState('BOTH');

  const [btPairId, setBtPairId] = useState('');
  const [btFrom, setBtFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10); });
  const [btTo, setBtTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [btThreshold, setBtThreshold] = useState(10);
  const [btSl, setBtSl] = useState(1.5);
  const [btTp, setBtTp] = useState(3.0);
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
      const params = { pairId: btPairId, from: btFrom, to: btTo + 'T23:59:59Z', threshold: btThreshold, slPct: btSl, tpPct: btTp };
      if (btDirection !== 'BOTH') params.direction = btDirection;
      const { data } = await api.get('/stats/backtest', { params });
      setBacktest(data);
    } catch (err) {
      setBtError(err.response?.data?.error || 'Backtest error');
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
      setOptError(err.response?.data?.error || 'Optimization error');
    } finally {
      setOptRunning(false);
    }
  };

  const togglePair = (pairId) => {
    setOptPairIds(prev => prev.includes(pairId) ? prev.filter(id => id !== pairId) : [...prev, pairId]);
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'backtest', label: 'Backtest' },
    { id: 'optimize', label: 'Optimize' },
  ];

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>Performance</h1>
          <p>Signal statistics, backtest and analytics from accumulated OBD data</p>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost">Export CSV</button>
        </div>
      </div>

      <div className="stats-tabs">
        {tabs.map(t => (
          <button key={t.id} className={`tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ====== OVERVIEW ====== */}
      {activeTab === 'overview' && (
        <>
          {!stats || stats.total === 0 ? (
            <div className="card" style={{padding: 48, textAlign: 'center'}}>
              <div style={{color: 'var(--text-3)', fontSize: 14}}>No completed signals yet. Stats will appear after signals are tracked.</div>
            </div>
          ) : (
            <>
              <div className="kpi-grid">
                <div className="kpi">
                  <div className="kpi-label">Total signals</div>
                  <div className="kpi-value">{stats.total}</div>
                  <div className="kpi-sub">{stats.wins}W / {stats.losses}L</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Win rate</div>
                  <div className="kpi-value mono" style={{color: stats.winRate >= 50 ? 'var(--long)' : 'var(--short)'}}>{stats.winRate}%</div>
                  <div className="kpi-sub">Resolved signals</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Cumulative PnL</div>
                  <div className="kpi-value mono" style={{color: stats.totalPnl >= 0 ? 'var(--long)' : 'var(--short)'}}>
                    {stats.totalPnl > 0 ? '+' : ''}{stats.totalPnl}%
                  </div>
                  <div className="kpi-sub">avg {stats.avgPnl > 0 ? '+' : ''}{stats.avgPnl}% per trade</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Avg PnL</div>
                  <div className="kpi-value mono" style={{color: stats.avgPnl >= 0 ? 'var(--long)' : 'var(--short)'}}>
                    {stats.avgPnl > 0 ? '+' : ''}{stats.avgPnl}%
                  </div>
                  <div className="kpi-sub">per signal</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Max drawdown</div>
                  <div className="kpi-value mono" style={{color: 'var(--short)'}}>
                    -{stats.maxDrawdown ?? 0}%
                  </div>
                  <div className="kpi-sub">peak to trough</div>
                </div>
                <div className="kpi">
                  <div className="kpi-label">Streak</div>
                  <div className="kpi-value mono" style={{color: (stats.maxConsecutiveLosses ?? 0) >= 5 ? 'var(--short)' : 'var(--text-2)'}}>
                    {stats.maxConsecutiveLosses ?? 0}
                  </div>
                  <div className="kpi-sub">max losses in a row</div>
                </div>
              </div>

              {/* By pair */}
              <div className="two-col" style={{marginBottom: 20}}>
                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">By Pair</div></div>
                  </div>
                  <div className="bar-row">
                    {Object.entries(stats.byPair || {}).map(([sym, data]) => (
                      <div key={sym} className="bar-item">
                        <span className="bar-label">{sym.replace('USDC', '')}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{width: `${data.winRate}%`}}/>
                        </div>
                        <span className="bar-count">{data.total}</span>
                        <span className="bar-wr" style={{color: data.winRate >= 50 ? 'var(--long)' : 'var(--short)'}}>
                          {data.winRate}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">Recent Results</div><div className="card-sub">Last 20</div></div>
                  </div>
                  <div style={{padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4}}>
                    <div style={{display: 'flex', gap: 2, marginBottom: 8}}>
                      {(stats.recent || []).map((r) => (
                        <div key={r.id} style={{
                          flex: 1, height: 24, borderRadius: 3,
                          background: r.outcome === 'WIN' ? 'var(--long)' : r.outcome === 'LOSS' ? 'var(--short)' : 'var(--bg-3)',
                        }} title={`${r.pair?.monitorSymbol} ${r.direction} ${r.outcome}`}/>
                      ))}
                    </div>
                    {(stats.recent || []).slice(0, 5).map((r) => (
                      <div key={r.id} style={{display: 'flex', alignItems: 'center', gap: 10, fontSize: 12}}>
                        <span style={{color: 'var(--text-3)', minWidth: 36}}>{r.pair?.monitorSymbol?.replace('USDC', '')}</span>
                        <span style={{fontWeight: 700, color: r.outcome === 'WIN' ? 'var(--long)' : r.outcome === 'LOSS' ? 'var(--short)' : 'var(--text-3)', minWidth: 32}}>{r.outcome}</span>
                        <span className="mono" style={{color: r.outcomePnl >= 0 ? 'var(--long)' : 'var(--short)', fontWeight: 600}}>
                          {r.outcomePnl > 0 ? '+' : ''}{(r.outcomePnl || 0).toFixed(2)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ====== ANALYTICS ====== */}
      {activeTab === 'analytics' && (
        <>
          {!analytics ? (
            <div style={{color: 'var(--text-3)'}}>Loading...</div>
          ) : (
            <div style={{display: 'flex', flexDirection: 'column', gap: 20}}>
              <div className="card">
                <div className="card-header">
                  <div><div className="card-title">Winrate by confidence</div></div>
                </div>
                <div className="bar-row">
                  {(analytics.byConfidence || []).map(b => (
                    <div key={b.label} className="bar-item">
                      <span className="bar-label">{b.label}</span>
                      <div className="bar-track">
                        <div className="bar-fill" style={{width: `${b.winRate}%`}}/>
                      </div>
                      <span className="bar-count">{b.total}</span>
                      <span className="bar-wr" style={{color: b.winRate >= 65 ? 'var(--long)' : b.winRate >= 50 ? 'var(--warn)' : 'var(--short)'}}>
                        {b.total === 0 ? '—' : `${b.winRate}%`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="two-col">
                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">LONG vs SHORT</div></div>
                  </div>
                  <div className="bar-row">
                    {Object.entries(analytics.byDirection || {}).map(([dir, data]) => (
                      <div key={dir} style={{marginBottom: 10}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13}}>
                          <span style={{fontWeight: 600, color: dir === 'LONG' ? 'var(--long)' : 'var(--short)'}}>
                            {dir === 'LONG' ? '▲' : '▼'} {dir}
                          </span>
                          <span className="mono" style={{color: 'var(--text-2)'}}>{data.total} / {data.winRate}%</span>
                        </div>
                        <div className="bar-track" style={{height: 10}}>
                          <div className="bar-fill" style={{
                            width: `${data.winRate}%`,
                            background: dir === 'LONG' ? 'var(--long)' : 'var(--short)',
                          }}/>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div><div className="card-title">Hourly performance</div><div className="card-sub">UTC · winrate by hour</div></div>
                  </div>
                  <div style={{padding: 16, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6}}>
                    {(analytics.byHour || []).filter(h => h.total > 0).slice(0, 12).map(h => (
                      <div key={h.hour} style={{
                        background: `color-mix(in srgb, ${h.winRate >= 50 ? 'var(--long)' : 'var(--short)'} ${20 + h.winRate * 0.6}%, var(--bg-3))`,
                        borderRadius: 6,
                        padding: '8px 4px',
                        textAlign: 'center',
                      }}>
                        <div className="mono" style={{fontSize: 10, color: 'var(--text-3)'}}>{h.hour}h</div>
                        <div style={{fontSize: 11, fontWeight: 600, color: h.winRate >= 50 ? 'var(--long)' : 'var(--short)'}}>{h.winRate}%</div>
                        <div style={{fontSize: 9, color: 'var(--text-4)'}}>{h.total}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ====== BACKTEST ====== */}
      {activeTab === 'backtest' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 20}}>
          {/* Snapshot status */}
          <div className="card">
            <div className="card-header">
              <div><div className="card-title">OBD data for backtest</div></div>
            </div>
            <div style={{padding: 16}}>
              {snapshots.length === 0 ? (
                <p style={{fontSize: 13, color: 'var(--text-3)'}}>Snapshots not yet accumulated. They are recorded every 30 seconds automatically.</p>
              ) : (
                <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12}}>
                  {snapshots.map(s => {
                    const dur = snapshotDuration(s);
                    const lowData = s.count < 2880;
                    return (
                      <div key={s.pairId} style={{
                        background: lowData ? 'color-mix(in srgb, var(--warn) 8%, var(--bg-2))' : 'var(--bg-2)',
                        border: `1px solid ${lowData ? 'color-mix(in srgb, var(--warn) 30%, transparent)' : 'var(--line)'}`,
                        borderRadius: 'var(--radius)', padding: 12,
                      }}>
                        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: 4}}>
                          <div style={{fontSize: 13, fontWeight: 600}}>{s.symbol.replace('USDC', 'USDT')}</div>
                          {lowData && <span style={{fontSize: 10, color: 'var(--warn)', fontWeight: 600}}>low data</span>}
                        </div>
                        <div className="mono" style={{fontSize: 18, fontWeight: 700, color: 'var(--primary)'}}>{s.count.toLocaleString()}</div>
                        <div style={{fontSize: 10, color: 'var(--text-3)'}}>
                          {dur}{s.from ? ` · from ${new Date(s.from).toLocaleDateString()}` : ' · no data'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Config */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Backtest configuration</div>
                <div className="card-sub">Replay against accumulated OBD snapshots</div>
              </div>
              <button
                className="btn btn-primary"
                onClick={runBacktest}
                disabled={btRunning || snapshots.length === 0}
                style={{opacity: btRunning || snapshots.length === 0 ? 0.5 : 1}}
              >
                <Icon name="play" size={14}/>{btRunning ? 'Running...' : 'Run backtest'}
              </button>
            </div>
            <div className="backtest-form">
              <div className="field">
                <label className="label">Pair</label>
                <select className="select" value={btPairId} onChange={e => setBtPairId(e.target.value)}>
                  {snapshots.map(s => (
                    <option key={s.pairId} value={s.pairId}>{s.symbol.replace('USDC', 'USDT')} ({s.count.toLocaleString()} snp)</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">From</label>
                <input type="date" className="input" value={btFrom} onChange={e => setBtFrom(e.target.value)}/>
              </div>
              <div className="field">
                <label className="label">To</label>
                <input type="date" className="input" value={btTo} onChange={e => setBtTo(e.target.value)}/>
              </div>
              <div className="field">
                <label className="label">Threshold <Tooltip text="Minimum synchronous OBD movement for signal detection"/></label>
                <input type="number" className="input mono" value={btThreshold} onChange={e => setBtThreshold(e.target.value)} step="1" min="1" max="50"/>
              </div>
              <div className="field">
                <label className="label">SL %</label>
                <input type="number" className="input mono" value={btSl} onChange={e => setBtSl(e.target.value)} step="0.1" min="0.1" max="10"/>
              </div>
              <div className="field">
                <label className="label">TP %</label>
                <input type="number" className="input mono" value={btTp} onChange={e => setBtTp(e.target.value)} step="0.1" min="0.1" max="20"/>
              </div>
            </div>
            <div style={{padding: '12px 16px', borderTop: '1px solid var(--line)'}}>
              <div style={{fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>Direction</div>
              <DirectionToggle value={btDirection} onChange={setBtDirection}/>
            </div>
          </div>

          {btError && (
            <div style={{background: 'color-mix(in srgb, var(--short) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--short) 30%, transparent)', borderRadius: 'var(--radius)', padding: '12px 16px', fontSize: 13, color: 'var(--short)'}}>
              {btError}
            </div>
          )}

          {backtest && (
            <div style={{display: 'flex', flexDirection: 'column', gap: 20}}>
              {backtest.stats ? (
                <>
                  {backtest.stats.total < 50 && backtest.stats.total > 0 && (
                    <div style={{background: 'color-mix(in srgb, var(--warn) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)', borderRadius: 'var(--radius)', padding: '12px 16px', fontSize: 13, color: 'var(--warn)'}}>
                      Only {backtest.stats.total} signals found — not enough for statistically reliable conclusions. Recommend minimum 50 signals. Extend the period or lower the threshold.
                    </div>
                  )}
                  <div className="kpi-grid">
                    <div className="kpi">
                      <div className="kpi-label">Signals</div>
                      <div className="kpi-value mono">{backtest.stats.total}</div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-label">Win rate</div>
                      <div className="kpi-value mono" style={{color: backtest.stats.winRate >= 50 ? 'var(--long)' : 'var(--short)'}}>
                        {backtest.stats.winRate}%
                      </div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-label">Total PnL</div>
                      <div className="kpi-value mono" style={{color: backtest.stats.totalPnl >= 0 ? 'var(--long)' : 'var(--short)'}}>
                        {backtest.stats.totalPnl > 0 ? '+' : ''}{backtest.stats.totalPnl}%
                      </div>
                    </div>
                    <div className="kpi">
                      <div className="kpi-label">Max drawdown</div>
                      <div className="kpi-value mono" style={{color: 'var(--short)'}}>-{backtest.stats.maxDrawdown}%</div>
                    </div>
                  </div>

                  <div style={{fontSize: 12, color: 'var(--text-3)', display: 'flex', gap: 6}}>
                    <span style={{color: 'var(--warn)'}}>★</span>
                    PnL already includes exchange commission
                    <span className="mono" style={{color: 'var(--warn)'}}>-{backtest.stats.feeTotalPct}%</span>
                    <span>({backtest.stats.total} trades × 0.2% round-trip)</span>
                  </div>

                  {backtest.equityCurve && (
                    <div className="card">
                      <div className="card-header">
                        <div><div className="card-title">Simulated equity curve</div></div>
                      </div>
                      <div className="equity-chart">
                        <EquityChart data={backtest.equityCurve}/>
                      </div>
                    </div>
                  )}

                  {backtest.signals && backtest.signals.length > 0 && (
                    <div className="signals-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Dir</th>
                            <th className="num">Entry</th>
                            <th className="num">Exit</th>
                            <th className="num">PnL</th>
                            <th>Outcome</th>
                          </tr>
                        </thead>
                        <tbody>
                          {backtest.signals.map((s, i) => (
                            <tr key={i}>
                              <td className="time">{new Date(s.createdAt).toLocaleDateString()}</td>
                              <td><span style={{fontWeight: 700, color: s.direction === 'LONG' ? 'var(--long)' : 'var(--short)'}}>{s.direction}</span></td>
                              <td className="num">{s.entryPrice.toFixed(2)}</td>
                              <td className="num">{s.exitPrice.toFixed(2)}</td>
                              <td className="num" style={{color: s.pnl >= 0 ? 'var(--long)' : 'var(--short)', fontWeight: 600}}>
                                {s.pnl > 0 ? '+' : ''}{s.pnl}%
                              </td>
                              <td>
                                <span style={{fontWeight: 700, color: s.outcome === 'WIN' ? 'var(--long)' : s.outcome === 'LOSS' ? 'var(--short)' : 'var(--text-3)'}}>
                                  {s.outcome}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : (
                <div style={{color: 'var(--text-3)', fontSize: 13}}>
                  Not enough snapshots in the selected period. Minimum 24 data points required.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ====== OPTIMIZE ====== */}
      {activeTab === 'optimize' && (
        <div style={{display: 'flex', flexDirection: 'column', gap: 20}}>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Parameter sweep</div>
                <div className="card-sub">threshold [5,8,10,12,15,20] × SL [0.3,0.5,0.7,1.0]% × TP [1.0,1.5,2.0,3.0]%</div>
              </div>
              <button
                className="btn btn-primary"
                onClick={runOptimize}
                disabled={optRunning || snapshots.length === 0}
                style={{opacity: optRunning || snapshots.length === 0 ? 0.5 : 1}}
              >
                <Icon name="play" size={14}/>{optRunning ? 'Running...' : 'Run optimize'}
              </button>
            </div>
            <div style={{padding: 16}}>
              <div style={{marginBottom: 14}}>
                <div className="label" style={{marginBottom: 8}}>Pairs (empty = all)</div>
                <div style={{display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                  {snapshots.map(s => (
                    <button
                      key={s.pairId}
                      onClick={() => togglePair(s.pairId)}
                      className={`btn btn-ghost ${optPairIds.includes(s.pairId) ? 'active' : ''}`}
                      style={{fontSize: 12, padding: '6px 12px'}}
                    >
                      {s.symbol.replace('USDC', 'USDT')}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14}}>
                <div className="field">
                  <label className="label">From</label>
                  <input type="date" className="input" value={optFrom} onChange={e => setOptFrom(e.target.value)}/>
                </div>
                <div className="field">
                  <label className="label">To</label>
                  <input type="date" className="input" value={optTo} onChange={e => setOptTo(e.target.value)}/>
                </div>
              </div>
              <div>
                <div className="label" style={{marginBottom: 8}}>Direction</div>
                <DirectionToggle value={optDirection} onChange={setOptDirection}/>
              </div>
            </div>
          </div>

          {optError && (
            <div style={{background: 'color-mix(in srgb, var(--short) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--short) 30%, transparent)', borderRadius: 'var(--radius)', padding: '12px 16px', fontSize: 13, color: 'var(--short)'}}>
              {optError}
            </div>
          )}

          {optResults && (
            <div className="card">
              <div className="card-header">
                <div><div className="card-title">Results — {optResults.combinations} combinations</div></div>
                <div style={{display: 'flex', gap: 4}}>
                  {[
                    { key: 'totalPnl', label: 'Total PnL' },
                    { key: 'avgPnl', label: 'Avg PnL' },
                    { key: 'winRate', label: 'Winrate' },
                    { key: 'maxDrawdown', label: 'Drawdown' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setOptSortKey(key)}
                      className={`btn btn-ghost ${optSortKey === key ? 'active' : ''}`}
                      style={{fontSize: 11, padding: '4px 10px'}}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{overflowX: 'auto'}}>
                <table style={{width: '100%', borderCollapse: 'collapse', fontSize: 12}}>
                  <thead>
                    <tr style={{background: 'var(--bg-2)', borderBottom: '1px solid var(--line)'}}>
                      <th style={{padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>#</th>
                      <th style={{padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>Pair</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>Threshold</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>SL%</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>TP%</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>Sig.</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>W/L</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>WR</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>Total PnL</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>Avg PnL</th>
                      <th style={{padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontSize: 10, letterSpacing: '0.06em', fontWeight: 600}}>DD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...optResults.results]
                      .sort((a, b) => optSortKey === 'maxDrawdown' ? a[optSortKey] - b[optSortKey] : b[optSortKey] - a[optSortKey])
                      .slice(0, 30)
                      .map((r, i) => (
                        <tr key={i} style={{borderBottom: '1px solid var(--line)', background: i < 3 ? 'color-mix(in srgb, var(--primary) 4%, transparent)' : 'transparent'}}>
                          <td style={{padding: '10px 12px', color: 'var(--text-4)'}}>{i + 1}</td>
                          <td style={{padding: '10px 12px', fontWeight: 600}}>{r.symbol?.replace('USDT', '').replace('USDC', '')}</td>
                          <td style={{padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)'}}>{r.threshold}</td>
                          <td style={{padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)'}}>{r.slPct}%</td>
                          <td style={{padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)'}}>{r.tpPct}%</td>
                          <td style={{padding: '10px 12px', textAlign: 'right'}}>{r.total}</td>
                          <td style={{padding: '10px 12px', textAlign: 'right'}}>
                            <span style={{color: 'var(--long)'}}>{r.wins}</span>
                            <span style={{color: 'var(--text-4)'}}>/</span>
                            <span style={{color: 'var(--short)'}}>{r.losses}</span>
                          </td>
                          <td style={{padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: r.winRate >= 50 ? 'var(--long)' : 'var(--short)'}}>
                            {r.winRate}%
                          </td>
                          <td style={{padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700, color: r.totalPnl >= 0 ? 'var(--long)' : 'var(--short)'}}>
                            {r.totalPnl > 0 ? '+' : ''}{r.totalPnl}%
                          </td>
                          <td style={{padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: r.avgPnl >= 0 ? 'var(--long)' : 'var(--short)'}}>
                            {r.avgPnl > 0 ? '+' : ''}{r.avgPnl}%
                          </td>
                          <td style={{padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--short)'}}>
                            -{r.maxDrawdown}%
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
    </>
  );
}
