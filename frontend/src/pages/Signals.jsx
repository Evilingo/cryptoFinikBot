import { useState, useEffect, useMemo, Fragment } from 'react';
import api from '../services/api';
import { CoinGlyph, Icon, DirectionBadge, ConfidenceBadge, OutcomeBadge, formatPrice, formatTime } from '../components/primitives';

export default function Signals({ onOpenSignal }) {
  const [rawSignals, setRawSignals] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [filterDir, setFilterDir] = useState('ALL');
  const [filterOutcome, setFilterOutcome] = useState('ALL');
  const limit = 50;

  useEffect(() => {
    api.get(`/signals?limit=${limit}&offset=${page * limit}`)
      .then(({ data }) => {
        setRawSignals(data.signals || []);
        setTotal(data.total || 0);
      })
      .catch(() => {});
  }, [page]);

  // Normalize signal fields
  const signals = useMemo(() => rawSignals.map(s => ({
    ...s,
    pair: s.pair?.monitorSymbol || s.monitorSymbol || (typeof s.pair === 'string' ? s.pair : '') || '',
    analysis: s.claudeAnalysis || s.analysis || '',
    sl: s.suggestedSl || s.stopLoss || s.sl,
    tp: s.suggestedTp || s.takeProfit || s.tp,
    strategy: s.strategy || 'OBD',
    ofiRatio: s.ofiRatio ?? null,
    obd: [s.obd1, s.obd2, s.obd3, s.obd4],
    pnl: s.outcomePnl ?? s.pnl ?? null,
    price: s.price ?? 0,
    createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
  })), [rawSignals]);

  const filtered = useMemo(() => signals.filter(s => {
    if (filterDir !== 'ALL' && s.direction !== filterDir) return false;
    if (filterOutcome === 'PENDING' && s.outcome) return false;
    if (filterOutcome !== 'ALL' && filterOutcome !== 'PENDING' && s.outcome !== filterOutcome) return false;
    return true;
  }), [signals, filterDir, filterOutcome]);

  const stats = useMemo(() => {
    const resolved = signals.filter(s => s.outcome && s.outcome !== 'BREAKEVEN');
    const wins = resolved.filter(s => s.outcome === 'WIN').length;
    const pnl = signals.reduce((a, s) => a + (s.pnl || 0), 0);
    return {
      total: signals.length,
      winRate: resolved.length ? Math.round((wins / resolved.length) * 100) : 0,
      pnl,
    };
  }, [signals]);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>Signals</h1>
          <p>Signal history from OBD &amp; OFI engines · confirmed by Claude</p>
        </div>
        <div className="topbar-actions">
          <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
            <div style={{textAlign: 'right'}}>
              <div style={{fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>Winrate</div>
              <div className="mono" style={{fontSize: 16, fontWeight: 600, color: 'var(--long)'}}>{stats.winRate}%</div>
            </div>
            <div style={{textAlign: 'right'}}>
              <div style={{fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em'}}>Cumulative PnL</div>
              <div className="mono" style={{fontSize: 16, fontWeight: 600, color: stats.pnl >= 0 ? 'var(--long)' : 'var(--short)'}}>
                {stats.pnl >= 0 ? '+' : ''}{stats.pnl.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Single unified filter bar */}
      <div className="filters-bar">
        <div className="seg">
          {['ALL', 'LONG', 'SHORT', 'WAIT'].map(d => (
            <button key={d} className={filterDir === d ? 'active' : ''} onClick={() => setFilterDir(d)}>{d}</button>
          ))}
        </div>
        <div style={{width: 1, height: 24, background: 'var(--line)'}}/>
        <div className="seg">
          {['ALL', 'WIN', 'LOSS', 'PENDING'].map(o => (
            <button key={o} className={filterOutcome === o ? 'active' : ''} onClick={() => setFilterOutcome(o)}>{o}</button>
          ))}
        </div>
        <div style={{marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)'}}>
          {filtered.length} / {total} signals
        </div>
      </div>

      <div className="signals-table">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Pair</th>
              <th>Direction</th>
              <th className="num">Price</th>
              <th className="num">Confidence</th>
              <th className="num">Strategy</th>
              <th>Outcome</th>
              <th className="num">PnL</th>
              <th>Claude analysis</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => {
              const isOpen = expanded === s.id;
              const base = s.pair.replace(/USDC$|USDT$/, '');
              return (
                <Fragment key={s.id}>
                  <tr onClick={() => setExpanded(isOpen ? null : s.id)}>
                    <td className="time">{formatTime(s.createdAt)}</td>
                    <td>
                      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                        <CoinGlyph symbol={base} size={22}/>
                        <span style={{fontWeight: 600}}>{base}</span>
                      </div>
                    </td>
                    <td><DirectionBadge dir={s.direction}/></td>
                    <td className="num">${formatPrice(s.price)}</td>
                    <td className="num"><ConfidenceBadge value={s.confidence}/></td>
                    <td className="num">
                      {s.strategy === 'OFI' ? (
                        <span style={{display: 'inline-flex', alignItems: 'center', gap: 5}}>
                          <span style={{fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--primary)', background: 'var(--primary-soft)', padding: '1px 6px', borderRadius: 8}}>OFI</span>
                          <span style={{color: 'var(--text-3)', fontSize: 11}}>{s.ofiRatio != null ? `${s.ofiRatio}%` : '—'}</span>
                        </span>
                      ) : (
                        <span style={{display: 'inline-flex', alignItems: 'center', gap: 5}}>
                          <span style={{fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-3)', background: 'var(--bg-2)', padding: '1px 6px', borderRadius: 8}}>OBD</span>
                          {s.obd.every(v => v != null) ? (
                            <span style={{display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 16}}>
                              {s.obd.map((v, i) => (
                                <span key={i} title={`obd${i+1}: ${v.toFixed(1)}`} style={{
                                  display: 'inline-block', width: 5, borderRadius: 2,
                                  height: `${Math.max(3, Math.round(v / 100 * 16))}px`,
                                  background: v > 60 ? 'var(--long)' : v < 40 ? 'var(--short)' : 'var(--text-3)',
                                  opacity: 0.75,
                                }}/>
                              ))}
                            </span>
                          ) : <span style={{color: 'var(--text-4)'}}>—</span>}
                        </span>
                      )}
                    </td>
                    <td><OutcomeBadge outcome={s.outcome} direction={s.direction}/></td>
                    <td className="num">
                      {s.pnl != null ? (
                        <span style={{color: s.pnl > 0 ? 'var(--long)' : s.pnl < 0 ? 'var(--short)' : 'var(--text-3)', fontWeight: 600}}>
                          {s.pnl > 0 ? '+' : ''}{s.pnl.toFixed(2)}%
                        </span>
                      ) : <span style={{color: 'var(--text-4)'}}>—</span>}
                    </td>
                    <td className="analysis"><div className="preview">{s.analysis}</div></td>
                    <td><span style={{color: 'var(--text-4)'}}>{isOpen ? '▾' : '▸'}</span></td>
                  </tr>
                  {isOpen && (
                    <tr className="expanded-row">
                      <td colSpan={10}>
                        <div style={{display: 'flex', gap: 24}}>
                          <div style={{flex: 1, minWidth: 0}}>
                            <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8}}>
                              <span style={{fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--primary)', background: 'var(--primary-soft)', padding: '2px 7px', borderRadius: 10}}>AI</span>
                              <span style={{fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>Claude analysis</span>
                            </div>
                            <div className="analysis-full">{s.analysis}</div>
                            <div className="expanded-meta">
                              {s.strategy === 'OFI' ? (
                                <span>OFI ratio: <strong className="mono">{s.ofiRatio != null ? `${s.ofiRatio}% buy pressure` : '—'}</strong></span>
                              ) : (
                                <span>OBD: <strong className="mono">{s.obd.every(v => v != null) ? s.obd.map(v => v.toFixed(1)).join(' | ') : '—'}</strong></span>
                              )}
                              {s.sl && <span>SL: <strong className="mono" style={{color: 'var(--short)'}}>${formatPrice(s.sl)}</strong></span>}
                              {s.tp && <span>TP: <strong className="mono" style={{color: 'var(--long)'}}>${formatPrice(s.tp)}</strong></span>}
                              {s.sl && s.tp && (
                                <span>RR: <strong className="mono">1 : {(Math.abs(s.tp - s.price) / Math.abs(s.price - s.sl)).toFixed(2)}</strong></span>
                              )}
                            </div>
                          </div>
                          {onOpenSignal && (
                            <div style={{width: 200, display: 'flex', flexDirection: 'column', gap: 8}}>
                              <button
                                className="btn btn-ghost"
                                onClick={(e) => { e.stopPropagation(); onOpenSignal({ ...s, monitorSymbol: s.pair }); }}
                              >
                                Open in modal
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > limit && (
        <div style={{display: 'flex', alignItems: 'center', gap: 16, marginTop: 16}}>
          <button
            className="btn btn-ghost"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            style={{opacity: page === 0 ? 0.4 : 1}}
          >
            Previous
          </button>
          <span style={{fontSize: 13, color: 'var(--text-3)'}}>
            {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => setPage(p => p + 1)}
            disabled={(page + 1) * limit >= total}
            style={{opacity: (page + 1) * limit >= total ? 0.4 : 1}}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
