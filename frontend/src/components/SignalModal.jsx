import { useState, useRef } from 'react';
import api from '../services/api';
import { CoinGlyph, Icon, ConfidenceBadge, formatPrice } from './primitives';
import { Sparkchart, genCandles } from './charts';

export default function SignalModal({ signal, onClose }) {
  const candles = useRef(genCandles(signal.price || 65000, 60)).current;

  const [qty, setQty] = useState('0.015');
  const [slPct, setSlPct] = useState(
    signal.sl ? Math.abs((signal.price - signal.sl) / signal.price * 100).toFixed(1) : '1.5'
  );
  const [tpPct, setTpPct] = useState(
    signal.tp ? Math.abs((signal.tp - signal.price) / signal.price * 100).toFixed(1) : '3.0'
  );

  // Normalize signal fields
  const price = signal.price ?? 0;
  const direction = signal.direction || 'LONG';
  const analysis = signal.claudeAnalysis || signal.analysis || '';
  const sl = signal.suggestedSl || signal.stopLoss || signal.sl;
  const tp = signal.suggestedTp || signal.takeProfit || signal.tp;
  const obd = signal.obd || [signal.obd1 ?? 0, signal.obd2 ?? 0, signal.obd3 ?? 0, signal.obd4 ?? 0];
  const monSym = signal.monitorSymbol || signal.pair?.monitorSymbol || signal.pair || '';
  const base = monSym.replace(/USDC$|USDT$/, '');

  const side = direction === 'SHORT' ? 'SELL' : 'BUY';
  const slPrice = price * (side === 'BUY' ? (1 - parseFloat(slPct) / 100) : (1 + parseFloat(slPct) / 100));
  const tpPrice = price * (side === 'BUY' ? (1 + parseFloat(tpPct) / 100) : (1 - parseFloat(tpPct) / 100));
  const rr = (parseFloat(tpPct) / parseFloat(slPct || 1)).toFixed(2);

  const handleTrade = async () => {
    try {
      const tradeSymbol = monSym.replace('USDC', 'USDT');
      await api.post('/trade/order', {
        symbol: tradeSymbol,
        side,
        quantity: parseFloat(qty),
        stopLoss: slPrice,
        takeProfit: tpPrice,
      });
      onClose();
    } catch (err) {
      console.error('Trade error:', err);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className={`modal-head ${direction.toLowerCase()}`}>
          <div className="modal-title">
            <span className={`modal-direction ${direction.toLowerCase()}`}>
              {direction === 'LONG' ? '▲' : '▼'} {direction}
            </span>
            <CoinGlyph symbol={base} size={26}/>
            <span className="modal-sym">{base}/USDC</span>
            <span className="modal-price mono">${formatPrice(price)}</span>
            <ConfidenceBadge value={signal.confidence}/>
          </div>
          <button className="modal-close" onClick={onClose}>
            <Icon name="close" size={16}/>
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-left">
            {/* Chart */}
            <div className="modal-chart">
              <Sparkchart candles={candles} height={248}/>
            </div>

            {/* OBD */}
            <div className="modal-obds">
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10}}>
                <span style={{fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>Order Book Depth · 4 levels</span>
                <span className="mono" style={{fontSize: 11, color: 'var(--text-3)'}}>last 12 snapshots</span>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10}}>
                {obd.map((v, i) => {
                  const pct = Math.max(-40, Math.min(40, v));
                  return (
                    <div key={i} style={{background: 'var(--bg-2)', borderRadius: 'var(--radius)', padding: '10px 12px'}}>
                      <div style={{fontSize: 10, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.06em'}}>OBD-{i + 1}</div>
                      <div className="mono" style={{fontSize: 18, fontWeight: 700, color: v >= 0 ? 'var(--long)' : 'var(--short)', marginTop: 4}}>
                        {v > 0 ? '+' : ''}{v.toFixed(1)}
                      </div>
                      <div style={{height: 3, background: 'var(--bg-3)', borderRadius: 2, marginTop: 6, overflow: 'hidden'}}>
                        <div style={{height: '100%', width: `${Math.abs(pct) * 2.5}%`, background: v >= 0 ? 'var(--long)' : 'var(--short)'}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Analysis */}
            <div className="modal-analysis">
              <div className="label">
                <span className="ai-pill">AI</span>
                <span style={{fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600}}>Claude analysis</span>
              </div>
              <div className="analysis-text">{analysis || 'No analysis available.'}</div>
              {sl && tp && (
                <div className="levels-grid">
                  <div className="level-card">
                    <div className="level-label">Entry</div>
                    <div className="level-value mono">${formatPrice(price)}</div>
                    <div className="level-delta">market · Binance spot</div>
                  </div>
                  <div className="level-card">
                    <div className="level-label">Stop Loss</div>
                    <div className="level-value sl mono">${formatPrice(sl)}</div>
                    <div className="level-delta">-{(Math.abs(price - sl) / price * 100).toFixed(2)}%</div>
                  </div>
                  <div className="level-card">
                    <div className="level-label">Take Profit</div>
                    <div className="level-value tp mono">${formatPrice(tp)}</div>
                    <div className="level-delta">+{(Math.abs(tp - price) / price * 100).toFixed(2)}% · RR 1:{(Math.abs(tp - price) / Math.abs(price - sl)).toFixed(1)}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Trade panel */}
          <div className="modal-right">
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
              <h3 style={{fontSize: 14, fontWeight: 600}}>Trade this signal</h3>
              <span className="mono" style={{fontSize: 11, color: 'var(--text-3)'}}>{monSym.replace('USDC', 'USDT')}</span>
            </div>

            <div className="side-toggle">
              <button className={`side-btn buy ${side === 'BUY' ? 'active' : ''}`} disabled>BUY</button>
              <button className={`side-btn sell ${side === 'SELL' ? 'active' : ''}`} disabled>SELL</button>
            </div>

            <div className="field">
              <label className="label">Quantity</label>
              <input className="input mono" value={qty} onChange={e => setQty(e.target.value)}/>
            </div>
            <div className="quick-amounts">
              {['25%', '50%', '75%', 'MAX'].map(x => <button key={x}>{x}</button>)}
            </div>

            <div className="row2">
              <div className="field">
                <label className="label">Stop Loss %</label>
                <input className="input mono" value={slPct} onChange={e => setSlPct(e.target.value)}/>
              </div>
              <div className="field">
                <label className="label">Take Profit %</label>
                <input className="input mono" value={tpPct} onChange={e => setTpPct(e.target.value)}/>
              </div>
            </div>

            <div className="trade-preview">
              <div className="row"><span>Entry</span><span>${formatPrice(price)}</span></div>
              <div className="row"><span>Stop loss</span><span style={{color: 'var(--short)'}}>${formatPrice(slPrice)}</span></div>
              <div className="row"><span>Take profit</span><span style={{color: 'var(--long)'}}>${formatPrice(tpPrice)}</span></div>
              <div className="row"><span>Risk/Reward</span><span>1 : {rr}</span></div>
              <div className="row"><span>Notional</span><span>${formatPrice(parseFloat(qty || 0) * price)}</span></div>
            </div>

            <div style={{marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8}}>
              <button
                className={`submit-btn ${side === 'BUY' ? 'buy' : 'sell'}`}
                onClick={handleTrade}
              >
                {side} · ${formatPrice(parseFloat(qty || 0) * price)}
              </button>
              <button className="btn btn-ghost" style={{justifyContent: 'center'}} onClick={onClose}>
                Skip signal
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
