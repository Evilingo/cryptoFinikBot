import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAlertSound } from '../hooks/useAlertSound';
import { CoinGlyph, ConnIndicator, formatPrice } from '../components/primitives';
import { Sparkchart, genCandles } from '../components/charts';

const PAIRS_CONFIG = [
  { monitorSymbol: 'BTCUSDC', tradeSymbol: 'BTCUSDT', base: 'BTC', basePrice: 65000 },
  { monitorSymbol: 'ETHUSDC', tradeSymbol: 'ETHUSDT', base: 'ETH', basePrice: 3500 },
  { monitorSymbol: 'SOLUSDC', tradeSymbol: 'SOLUSDT', base: 'SOL', basePrice: 180 },
  { monitorSymbol: 'BNBUSDC', tradeSymbol: 'BNBUSDT', base: 'BNB', basePrice: 420 },
];

const MAX_OBD_HISTORY = 720;

export default function Dashboard({ onOpenSignal, onNewSignal }) {
  const [pairs, setPairs] = useState([]);
  const [viewMode, setViewMode] = useState('grid');
  const [balances, setBalances] = useState([]);
  const [positions, setPositions] = useState([]);
  const [side, setSide] = useState('BUY');
  const [quantity, setQuantity] = useState('0.015');
  const [slPct, setSlPct] = useState('1.5');
  const [tpPct, setTpPct] = useState('3.0');
  const [selectedPairIdx, setSelectedPairIdx] = useState(0);

  const obdRef = useRef({});
  const [obdData, setObdData] = useState({});
  const candlesRef = useRef({});

  // Initialize candles with placeholder data
  useEffect(() => {
    PAIRS_CONFIG.forEach(p => {
      if (!candlesRef.current[p.monitorSymbol]) {
        candlesRef.current[p.monitorSymbol] = genCandles(p.basePrice, 60);
      }
    });
  }, []);

  const playAlert = useAlertSound();

  useEffect(() => {
    api.get('/pairs').then(({ data }) => setPairs(data)).catch(() => {});
    api.get('/balance').then(({ data }) => setBalances(data)).catch(() => {});
    api.get('/trade').then(({ data }) => setPositions(Array.isArray(data) ? data : [])).catch(() => {});

    // Fetch klines for each pair
    PAIRS_CONFIG.forEach(p => {
      api.get(`/klines?symbol=${p.monitorSymbol}&interval=1m&limit=60`)
        .then(({ data }) => {
          if (Array.isArray(data) && data.length) {
            candlesRef.current[p.monitorSymbol] = data.map(k => ({
              o: parseFloat(k[1]),
              h: parseFloat(k[2]),
              l: parseFloat(k[3]),
              c: parseFloat(k[4]),
            }));
          }
        })
        .catch(() => {});
    });

    // Poll positions every 5s
    const posInterval = setInterval(() => {
      api.get('/trade').then(({ data }) => setPositions(Array.isArray(data) ? data : [])).catch(() => {});
    }, 5000);
    return () => clearInterval(posInterval);
  }, []);

  const onWsMessage = useCallback((msg) => {
    if (msg.type === 'OBD_UPDATE') {
      obdRef.current[msg.symbol] = {
        obd1: msg.obd1, obd2: msg.obd2,
        obd3: msg.obd3, obd4: msg.obd4,
        midPrice: msg.midPrice,
        timestamp: msg.timestamp,
      };
      setObdData({ ...obdRef.current });
    }
    if (msg.type === 'KLINE') {
      const sym = msg.symbol;
      const k = msg.kline;
      if (k && candlesRef.current[sym]) {
        const arr = candlesRef.current[sym];
        const last = arr[arr.length - 1];
        if (last) {
          last.c = k.close;
          last.h = Math.max(last.h, k.high);
          last.l = Math.min(last.l, k.low);
        }
      }
    }
    if (msg.type === 'SIGNAL') {
      playAlert();
      if (onNewSignal) onNewSignal(msg.signal);
    }
  }, [playAlert, onNewSignal]);

  const { connected } = useWebSocket(onWsMessage);

  // Determine display pairs
  const allPairs = pairs.length > 0 ? pairs : PAIRS_CONFIG.map((p, i) => ({
    id: i + 1,
    monitorSymbol: p.monitorSymbol,
    tradeSymbol: p.tradeSymbol,
    base: p.base,
  }));
  const displayPairs = viewMode === 'grid' ? allPairs : [allPairs[selectedPairIdx] || allPairs[0]];

  const selPair = allPairs[selectedPairIdx] || allPairs[0];
  const selObd = selPair ? obdData[selPair.monitorSymbol] : null;
  const currentPrice = selObd?.midPrice ?? PAIRS_CONFIG[selectedPairIdx]?.basePrice ?? 0;
  const slPrice = currentPrice * (side === 'BUY' ? (1 - parseFloat(slPct)/100) : (1 + parseFloat(slPct)/100));
  const tpPrice = currentPrice * (side === 'BUY' ? (1 + parseFloat(tpPct)/100) : (1 - parseFloat(tpPct)/100));

  // Balance strip: USDT, USDC, BTC, ETH
  const balanceAssets = ['USDT', 'USDC', 'BTC', 'ETH'];
  const balanceStrip = balanceAssets.map(asset => {
    const found = balances.find(b => b.asset === asset);
    return { asset, free: found ? parseFloat(found.free) : 0, usdValue: found?.usdValue ?? null };
  });

  const handleTradeSubmit = async () => {
    if (!selPair) return;
    try {
      await api.post('/trade/order', {
        symbol: selPair.tradeSymbol,
        side,
        quantity: parseFloat(quantity),
        stopLoss: slPrice,
        takeProfit: tpPrice,
      });
    } catch (err) {
      console.error('Trade error:', err);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <h1>Dashboard</h1>
          <p>4 pairs monitored · OBD engine live</p>
        </div>
        <div className="topbar-actions">
          <ConnIndicator connected={connected}/>
          <div className="seg">
            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>2×2</button>
            <button className={viewMode === 'single' ? 'active' : ''} onClick={() => setViewMode('single')}>Focus</button>
          </div>
        </div>
      </div>

      {/* Balance strip */}
      <div className="balance-strip" style={{marginBottom: 20}}>
        {balanceStrip.map(b => (
          <div key={b.asset} className="balance-cell">
            <div className="balance-label">{b.asset} balance</div>
            <div className="balance-value">
              {b.asset === 'BTC' || b.asset === 'ETH'
                ? formatPrice(b.free, 4)
                : formatPrice(b.free, 2)}
            </div>
            <div className="balance-sub">
              {b.usdValue != null && (
                <span className="balance-usd">≈ ${formatPrice(b.usdValue, 2)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        {/* Pair cards */}
        <div className="dash-charts" style={viewMode === 'single' ? {gridTemplateColumns: '1fr', gridTemplateRows: '1fr'} : {}}>
          {displayPairs.map((pair, idx) => {
            const obd = obdData[pair.monitorSymbol];
            const cfg = PAIRS_CONFIG.find(p => p.monitorSymbol === pair.monitorSymbol);
            const price = obd?.midPrice ?? cfg?.basePrice ?? 0;
            const delta24h = obd?.delta24h ?? 0;
            const candles = candlesRef.current[pair.monitorSymbol] || [];
            const base = pair.base || pair.monitorSymbol?.replace(/USDC$/, '');
            return (
              <div
                key={pair.id || idx}
                className="pair-card"
                onClick={() => {
                  setSelectedPairIdx(allPairs.indexOf(pair));
                  setViewMode('single');
                }}
              >
                <div className="pair-head">
                  <div className="pair-symbol">
                    <CoinGlyph symbol={base} size={26}/>
                    <div>
                      <div className="pair-name">
                        <span>{base}</span><span className="quote">/USDC</span>
                      </div>
                      <div style={{fontSize: 10, color: 'var(--text-3)'}}>Monitor · Binance spot</div>
                    </div>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div className="pair-price">${formatPrice(price)}</div>
                    <div className={`pair-delta ${delta24h >= 0 ? 'up' : 'dn'}`}>
                      {delta24h >= 0 ? '+' : ''}{delta24h.toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="pair-body">
                  <div className="pair-chart-wrap">
                    <Sparkchart candles={candles}/>
                  </div>
                  <div className="pair-obd-wrap">
                    {[1, 2, 3, 4].map(i => {
                      const v = obd?.[`obd${i}`] ?? 0;
                      const pct = Math.max(-40, Math.min(40, v));
                      const pos = pct >= 0;
                      return (
                        <div key={i} className="obd-row">
                          <span className="obd-label">OBD-{i}</span>
                          <div className="obd-bar">
                            <div
                              className={`obd-fill ${pos ? 'pos' : 'neg'}`}
                              style={{
                                left: pos ? '50%' : `${50 + pct * 1.25}%`,
                                width: `${Math.abs(pct) * 1.25}%`,
                              }}
                            />
                          </div>
                          <span className={`obd-val ${pos ? 'pos' : 'neg'}`}>{v.toFixed(1)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right panel */}
        <div className="dash-right">
          {/* Quick Trade */}
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Quick Trade</div>
                <div className="card-sub">Manual order · {selPair?.tradeSymbol || 'BTCUSDT'}</div>
              </div>
            </div>
            <div className="trade-panel">
              {/* Pair selector */}
              <div className="trade-pair-select">
                <CoinGlyph symbol={selPair?.base || selPair?.monitorSymbol?.replace(/USDC$/, '') || 'BTC'} size={28}/>
                <div style={{flex: 1}}>
                  <div style={{fontWeight: 600, fontSize: 14}}>{selPair?.tradeSymbol || 'BTCUSDT'}</div>
                  <div className="mono" style={{fontSize: 11, color: 'var(--text-3)'}}>Spot · MAKER 0.10% / TAKER 0.10%</div>
                </div>
                <select
                  value={selectedPairIdx}
                  onChange={e => setSelectedPairIdx(Number(e.target.value))}
                  style={{background: 'transparent', border: 'none', color: 'var(--text-2)', fontSize: 12, outline: 'none'}}
                >
                  {allPairs.map((p, i) => (
                    <option key={p.id || i} value={i}>
                      {p.base || p.monitorSymbol?.replace(/USDC$/, '')}
                    </option>
                  ))}
                </select>
              </div>

              <div className="trade-price-display mono">${formatPrice(currentPrice)}</div>

              <div className="side-toggle">
                <button className={`side-btn buy ${side === 'BUY' ? 'active' : ''}`} onClick={() => setSide('BUY')}>BUY · LONG</button>
                <button className={`side-btn sell ${side === 'SELL' ? 'active' : ''}`} onClick={() => setSide('SELL')}>SELL · SHORT</button>
              </div>

              <div className="field" style={{marginBottom: 10}}>
                <label className="label">Quantity ({selPair?.base || 'BTC'})</label>
                <input className="input mono" value={quantity} onChange={e => setQuantity(e.target.value)}/>
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
                <div className="row"><span>Entry</span><span>${formatPrice(currentPrice)}</span></div>
                <div className="row">
                  <span>Stop loss</span>
                  <span style={{color: 'var(--short)'}}>${formatPrice(slPrice)}</span>
                </div>
                <div className="row">
                  <span>Take profit</span>
                  <span style={{color: 'var(--long)'}}>${formatPrice(tpPrice)}</span>
                </div>
                <div className="row">
                  <span>Risk / Reward</span>
                  <span>1 : {(parseFloat(tpPct) / parseFloat(slPct || 1)).toFixed(2)}</span>
                </div>
              </div>

              <button className={`submit-btn ${side === 'BUY' ? 'buy' : 'sell'}`} onClick={handleTradeSubmit}>
                {side} {selPair?.base || 'BTC'} · ${formatPrice(parseFloat(quantity || 0) * currentPrice)}
              </button>
            </div>
          </div>

          {/* Open Positions */}
          <div className="card" style={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column'}}>
            <div className="card-header">
              <div>
                <div className="card-title">Open positions</div>
                <div className="card-sub">{positions.length} active</div>
              </div>
            </div>
            <div className="positions" style={{overflowY: 'auto', flex: 1}}>
              {positions.map((p, i) => {
                const pnl = parseFloat(p.pnl || 0);
                const pnlPct = parseFloat(p.pnlPct || 0);
                const base = (p.symbol || '').replace(/USDT$|USDC$/, '');
                return (
                  <div key={p.id || i} className="position">
                    <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                      <CoinGlyph symbol={base} size={24}/>
                      <div>
                        <div className="position-sym">{p.symbol}</div>
                        <div className="position-qty">
                          <span style={{color: p.side === 'BUY' ? 'var(--long)' : 'var(--short)', fontWeight: 600}}>{p.side}</span>
                          {' '}{p.quantity} · ${formatPrice(parseFloat(p.price || 0))}
                        </div>
                      </div>
                    </div>
                    <div className={`position-pnl ${pnl >= 0 ? 'up' : 'dn'}`}>
                      {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}
                      <small>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</small>
                    </div>
                  </div>
                );
              })}
              {positions.length === 0 && <div className="empty">No open positions</div>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
