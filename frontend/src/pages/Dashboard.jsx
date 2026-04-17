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
  // Bybit pairs (USDT monitor)
  { monitorSymbol: 'BTCUSDT', tradeSymbol: 'BTCUSDT', base: 'BTC', basePrice: 65000 },
  { monitorSymbol: 'ETHUSDT', tradeSymbol: 'ETHUSDT', base: 'ETH', basePrice: 3500 },
  { monitorSymbol: 'SOLUSDT', tradeSymbol: 'SOLUSDT', base: 'SOL', basePrice: 180 },
  { monitorSymbol: 'BNBUSDT', tradeSymbol: 'BNBUSDT', base: 'BNB', basePrice: 420 },
];

// Derive base ticker from monitor symbol (handles both USDC and USDT)
function toBase(sym) {
  return sym?.replace(/USDC$|USDT$/, '') || sym || '';
}

// Initialize placeholder candle data synchronously so first render shows charts
const INIT_CANDLES = Object.fromEntries(
  PAIRS_CONFIG.map(p => [p.monitorSymbol, genCandles(p.basePrice, 60)])
);

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
  const [tradeStatus, setTradeStatus] = useState(null);
  // chartTick triggers re-render when candle data changes
  const [chartTick, setChartTick] = useState(0);

  const obdRef = useRef({});
  const [obdData, setObdData] = useState({});
  const lastObdAt = useRef(0);
  const [exchangeConnected, setExchangeConnected] = useState(false);
  // Initialize synchronously so charts render on first paint
  const candlesRef = useRef({ ...INIT_CANDLES });
  const deltaRef = useRef({});
  const [deltaData, setDeltaData] = useState({});
  const klineTimeRef = useRef({});

  const showTradeStatus = (ok, msg) => {
    setTradeStatus({ ok, msg });
    setTimeout(() => setTradeStatus(null), 3000);
  };

  const playAlert = useAlertSound();

  useEffect(() => {
    api.get('/pairs').then(({ data }) => setPairs(data)).catch(() => {});
    api.get('/balance').then(({ data }) => setBalances(Array.isArray(data) ? data : [])).catch(() => {});
    api.get('/trade').then(({ data }) => setPositions(Array.isArray(data) ? data : [])).catch(() => {});

    // Refresh balance every 60s so it updates after key changes without reload
    const balInterval = setInterval(() => {
      api.get('/balance').then(({ data }) => setBalances(Array.isArray(data) ? data : [])).catch(() => {});
    }, 60000);

    // Fetch real klines for each pair
    PAIRS_CONFIG.forEach(p => {
      api.get(`/klines?symbol=${p.monitorSymbol}&interval=1m&limit=60`)
        .then(({ data }) => {
          if (Array.isArray(data) && data.length) {
            // Handle both Binance array format [time, o, h, l, c, ...]
            // and Bybit object format { t, o, h, l, c }
            const candles = data.map(k => Array.isArray(k)
              ? { t: parseInt(k[0]), o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]) }
              : { t: k.t, o: k.o, h: k.h, l: k.l, c: k.c }
            ).filter(k => !isNaN(k.o));
            candlesRef.current[p.monitorSymbol] = candles.map(({ o, h, l, c }) => ({ o, h, l, c }));
            klineTimeRef.current[p.monitorSymbol] = candles[candles.length - 1]?.t ?? 0;
            // Compute 1h delta
            const firstOpen = candles[0]?.o;
            const lastClose = candles[candles.length - 1]?.c;
            if (firstOpen && lastClose) {
              deltaRef.current[p.monitorSymbol] = ((lastClose - firstOpen) / firstOpen) * 100;
              setDeltaData({ ...deltaRef.current });
            }
            setChartTick(t => t + 1); // trigger re-render with real data
          }
        })
        .catch(() => {});
    });

    const posInterval = setInterval(() => {
      api.get('/trade').then(({ data }) => setPositions(Array.isArray(data) ? data : [])).catch(() => {});
    }, 5000);

    const onBalanceRefresh = () => {
      api.get('/balance').then(({ data }) => setBalances(Array.isArray(data) ? data : [])).catch(() => {});
    };
    window.addEventListener('finik:balance-refresh', onBalanceRefresh);

    // Exchange WS health: green only if OBD_UPDATE arrived within last 15s
    const exchCheck = setInterval(() => {
      setExchangeConnected(Date.now() - lastObdAt.current < 15000);
    }, 3000);

    return () => {
      clearInterval(posInterval);
      clearInterval(balInterval);
      clearInterval(exchCheck);
      window.removeEventListener('finik:balance-refresh', onBalanceRefresh);
    };
  }, []);

  const onWsMessage = useCallback((msg) => {
    if (msg.type === 'OBD_UPDATE') {
      lastObdAt.current = Date.now();
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
        const newCandle = {
          o: parseFloat(k.o),
          h: parseFloat(k.h),
          l: parseFloat(k.l),
          c: parseFloat(k.c),
        };
        if (k.x && k.t !== klineTimeRef.current[sym]) {
          // Candle closed — push new, drop oldest
          klineTimeRef.current[sym] = k.t;
          arr.push(newCandle);
          if (arr.length > 60) arr.shift();
          setChartTick(t => t + 1); // re-render on minute close
        } else {
          // Update current candle in-place
          const last = arr[arr.length - 1];
          if (last) {
            last.c = newCandle.c;
            last.h = Math.max(last.h, newCandle.h);
            last.l = Math.min(last.l, newCandle.l);
          }
        }
        // Update 1h delta
        const firstOpen = arr[0]?.o;
        if (firstOpen) {
          deltaRef.current[sym] = ((newCandle.c - firstOpen) / firstOpen) * 100;
          setDeltaData({ ...deltaRef.current });
        }
      }
    }
    if (msg.type === 'SIGNAL') {
      playAlert();
      if (onNewSignal) onNewSignal(msg.signal);
    }
  }, [playAlert, onNewSignal]);

  useWebSocket(onWsMessage);

  // Determine display pairs — use DB pairs if loaded, fallback to config
  const allPairs = pairs.length > 0 ? pairs : PAIRS_CONFIG.slice(0, 4).map((p, i) => ({
    id: i + 1,
    monitorSymbol: p.monitorSymbol,
    tradeSymbol: p.tradeSymbol,
  }));
  const displayPairs = viewMode === 'grid' ? allPairs : [allPairs[selectedPairIdx] || allPairs[0]];

  const selPair = allPairs[selectedPairIdx] || allPairs[0];
  const selObd = selPair ? obdData[selPair.monitorSymbol] : null;
  const selCfg = PAIRS_CONFIG.find(p => p.monitorSymbol === selPair?.monitorSymbol);
  const currentPrice = selObd?.midPrice ?? selCfg?.basePrice ?? 0;
  const slPrice = currentPrice * (side === 'BUY' ? (1 - parseFloat(slPct) / 100) : (1 + parseFloat(slPct) / 100));
  const tpPrice = currentPrice * (side === 'BUY' ? (1 + parseFloat(tpPct) / 100) : (1 - parseFloat(tpPct) / 100));

  const selBase = toBase(selPair?.monitorSymbol);
  const usdtBalance = parseFloat(balances.find(b => b.asset === 'USDT')?.free ?? 0);
  const baseBalance = parseFloat(balances.find(b => b.asset === selBase)?.free ?? 0);

  const applyQuickAmount = (pct) => {
    const fraction = pct === 100 ? 1 : pct / 100;
    const qty = side === 'BUY'
      ? (currentPrice > 0 ? (usdtBalance * fraction) / currentPrice : 0)
      : (baseBalance * fraction);
    setQuantity(qty.toFixed(6));
  };

  const balanceAssets = ['USDT', 'BTC', 'ETH', 'SOL'];
  const balanceStrip = balanceAssets.map(asset => ({
    asset,
    free: parseFloat(balances.find(b => b.asset === asset)?.free ?? 0),
  }));

  const handleTradeSubmit = async () => {
    if (!selPair) return;
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) { showTradeStatus(false, 'Invalid quantity'); return; }
    try {
      await api.post('/trade/order', {
        symbol: selPair.tradeSymbol,
        side,
        quantity: qty,
        stopLoss: slPrice,
        takeProfit: tpPrice,
      });
      showTradeStatus(true, `${side} order placed`);
    } catch (err) {
      showTradeStatus(false, err.response?.data?.error || 'Order failed');
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
          <ConnIndicator connected={exchangeConnected} exchange={allPairs[0]?.monitorSymbol?.endsWith('USDT') ? 'Bybit' : 'Binance'}/>
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
              {b.asset === 'USDT'
                ? formatPrice(b.free, 2)
                : formatPrice(b.free, 4)}
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
            const delta1h = deltaData[pair.monitorSymbol] ?? null;
            // chartTick used as key on Sparkchart forces re-render when candles update
            const candles = candlesRef.current[pair.monitorSymbol] || [];
            const base = toBase(pair.monitorSymbol);
            return (
              <div
                key={pair.id || idx}
                className="pair-card"
                onClick={() => { setSelectedPairIdx(allPairs.indexOf(pair)); setViewMode('single'); }}
              >
                <div className="pair-head">
                  <div className="pair-symbol">
                    <CoinGlyph symbol={base} size={26}/>
                    <div>
                      <div className="pair-name">
                        <span>{base}</span>
                        <span className="quote">/{pair.monitorSymbol?.endsWith('USDC') ? 'USDC' : 'USDT'}</span>
                      </div>
                      <div style={{fontSize: 10, color: 'var(--text-3)'}}>Monitor · {pair.monitorSymbol?.endsWith('USDC') ? 'Binance' : 'Bybit'} spot</div>
                    </div>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <div className="pair-price">${formatPrice(price)}</div>
                    {delta1h !== null && (
                      <div className={`pair-delta ${delta1h >= 0 ? 'up' : 'dn'}`}>
                        {delta1h >= 0 ? '+' : ''}{delta1h.toFixed(2)}% 1h
                      </div>
                    )}
                  </div>
                </div>
                <div className="pair-body">
                  <div className="pair-chart-wrap">
                    <Sparkchart key={`${pair.monitorSymbol}-${chartTick}`} candles={candles}/>
                  </div>
                  <div className="pair-obd-wrap">
                    {[1, 2, 3, 4].map(i => {
                      const v = obd?.[`obd${i}`] ?? 0;
                      const pos = v >= 0;
                      const fillPct = Math.min(100, Math.abs(v));
                      return (
                        <div key={i} className="obd-row">
                          <span className="obd-label">OBD-{i}</span>
                          <div className="obd-bar">
                            <div
                              className={`obd-fill ${pos ? 'pos' : 'neg'}`}
                              style={{ left: 0, width: `${fillPct}%` }}
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
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Quick Trade</div>
                <div className="card-sub">Manual order · {selPair?.tradeSymbol || 'BTCUSDT'}</div>
              </div>
            </div>
            <div className="trade-panel">
              <div className="trade-pair-select">
                <CoinGlyph symbol={selBase} size={28}/>
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
                    <option key={p.id || i} value={i}>{toBase(p.monitorSymbol)}</option>
                  ))}
                </select>
              </div>

              <div className="trade-price-display mono">${formatPrice(currentPrice)}</div>

              <div className="side-toggle">
                <button className={`side-btn buy ${side === 'BUY' ? 'active' : ''}`} onClick={() => setSide('BUY')}>BUY · LONG</button>
                <button className={`side-btn sell ${side === 'SELL' ? 'active' : ''}`} onClick={() => setSide('SELL')}>SELL · SHORT</button>
              </div>

              <div className="field" style={{marginBottom: 10}}>
                <label className="label">Quantity ({selBase})</label>
                <input className="input mono" value={quantity} onChange={e => setQuantity(e.target.value)}/>
              </div>

              <div className="quick-amounts">
                {[['25%', 25], ['50%', 50], ['75%', 75], ['MAX', 100]].map(([label, pct]) => (
                  <button key={label} onClick={() => applyQuickAmount(pct)}>{label}</button>
                ))}
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
                <div className="row"><span>Stop loss</span><span style={{color: 'var(--short)'}}>${formatPrice(slPrice)}</span></div>
                <div className="row"><span>Take profit</span><span style={{color: 'var(--long)'}}>${formatPrice(tpPrice)}</span></div>
                <div className="row"><span>Risk / Reward</span><span>1 : {(parseFloat(tpPct) / parseFloat(slPct || 1)).toFixed(2)}</span></div>
              </div>

              {tradeStatus && (
                <div style={{
                  padding: '8px 12px', borderRadius: 'var(--radius)', fontSize: 12,
                  background: tradeStatus.ok ? 'color-mix(in srgb, var(--long) 12%, transparent)' : 'color-mix(in srgb, var(--short) 12%, transparent)',
                  color: tradeStatus.ok ? 'var(--long)' : 'var(--short)',
                  border: `1px solid color-mix(in srgb, ${tradeStatus.ok ? 'var(--long)' : 'var(--short)'} 30%, transparent)`,
                }}>
                  {tradeStatus.msg}
                </div>
              )}

              <button className={`submit-btn ${side === 'BUY' ? 'buy' : 'sell'}`} onClick={handleTradeSubmit}>
                {side} {selBase} · ${formatPrice(parseFloat(quantity || 0) * currentPrice)}
              </button>
            </div>
          </div>

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
                const base = toBase(p.symbol);
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
