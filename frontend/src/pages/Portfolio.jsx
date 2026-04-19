import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { CoinGlyph, Icon, formatPrice } from '../components/primitives';
import { useStatusToast } from '../hooks/useStatusToast';

export default function Portfolio() {
  const [balance, setBalance] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [history, setHistory] = useState([]);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [cancelling, setCancelling] = useState(null); // orderId being cancelled
  const [tab, setTab] = useState('orders'); // 'orders' | 'history'

  const { status, showStatus } = useStatusToast();

  const [form, setForm] = useState({
    symbol: 'BTCUSDT',
    side: 'BUY',
    orderType: 'Market',
    qty: '',
    price: '',
    triggerPrice: '',
    stopLoss: '',
    takeProfit: '',
  });
  const [placing, setPlacing] = useState(false);

  const [botTrades, setBotTrades] = useState([]);
  const [loadingBotTrades, setLoadingBotTrades] = useState(true);

  // Load initial data
  useEffect(() => {
    api.get('/portfolio/balance')
      .then(({ data }) => setBalance(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingBalance(false));

    api.get('/portfolio/orders/open')
      .then(({ data }) => setOpenOrders(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingOrders(false));

    api.get('/portfolio/orders/history')
      .then(({ data }) => setHistory(Array.isArray(data) ? data : []))
      .catch(() => {});

    api.get('/trade')
      .then(({ data }) => setBotTrades(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingBotTrades(false));
  }, []);

  // WS realtime updates
  const onWsMessage = useCallback((msg) => {
    if (msg.type === 'PORTFOLIO_BALANCE' && Array.isArray(msg.coins)) {
      setBalance(msg.coins.filter(c => c.total > 0));
    }
    // Bot trade closed via WS
    if (msg.type === 'SIGNAL_OUTCOME' && msg.symbol) {
      setBotTrades(prev => prev.map(t =>
        t.symbol === msg.symbol && t.status === 'OPEN'
          ? { ...t, status: 'CLOSED', pnl: msg.pnl, closedAt: new Date().toISOString() }
          : t
      ));
    }
    if (msg.type === 'PORTFOLIO_ORDER' && msg.order) {
      const o = msg.order;
      if (o.orderStatus === 'New' || o.orderStatus === 'PartiallyFilled') {
        // Add or update in open orders
        setOpenOrders(prev => {
          const exists = prev.find(x => x.orderId === o.orderId);
          return exists
            ? prev.map(x => x.orderId === o.orderId ? o : x)
            : [o, ...prev];
        });
      } else if (o.orderStatus === 'Filled' || o.orderStatus === 'Cancelled' || o.orderStatus === 'Rejected') {
        // Remove from open, add to history
        setOpenOrders(prev => prev.filter(x => x.orderId !== o.orderId));
        setHistory(prev => [o, ...prev].slice(0, 100));
      }
    }
  }, []);

  useWebSocket(onWsMessage);

  const cancelOrder = async (order) => {
    if (!window.confirm(`Cancel ${order.side} ${order.symbol} order?`)) return;
    setCancelling(order.orderId);
    try {
      await api.delete(`/portfolio/orders/${order.orderId}?symbol=${order.symbol}`);
      setOpenOrders(prev => prev.filter(o => o.orderId !== order.orderId));
    } catch (err) {
      alert(err.response?.data?.error || 'Cancel failed');
    } finally {
      setCancelling(null);
    }
  };

  const refresh = async () => {
    setLoadingOrders(true);
    setLoadingBalance(true);
    const [balRes, ordRes] = await Promise.allSettled([
      api.get('/portfolio/balance'),
      api.get('/portfolio/orders/open'),
    ]);
    if (balRes.status === 'fulfilled') setBalance(balRes.value.data || []);
    if (ordRes.status === 'fulfilled') setOpenOrders(ordRes.value.data || []);
    setLoadingOrders(false);
    setLoadingBalance(false);
  };

  const placeOrder = async (e) => {
    e.preventDefault();
    if (!form.qty) return;
    setPlacing(true);
    try {
      const body = {
        symbol: form.symbol,
        side: form.side,
        orderType: form.orderType === 'Stop-Limit' ? 'Limit' : form.orderType,
        qty: parseFloat(form.qty),
      };
      if (form.price) body.price = parseFloat(form.price);
      if (form.triggerPrice) body.triggerPrice = parseFloat(form.triggerPrice);
      if (form.stopLoss) body.stopLoss = parseFloat(form.stopLoss);
      if (form.takeProfit) body.takeProfit = parseFloat(form.takeProfit);
      await api.post('/portfolio/orders', body);
      showStatus(true, 'Order placed');
      setForm(f => ({ ...f, qty: '', price: '', triggerPrice: '', stopLoss: '', takeProfit: '' }));
    } catch (err) {
      showStatus(false, err.response?.data?.error || 'Failed to place order');
    } finally {
      setPlacing(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 'var(--radius)',
    border: '1px solid var(--line)', background: 'var(--bg-2)', color: 'var(--text-1)',
    fontSize: 13, fontFamily: 'var(--font-mono)', boxSizing: 'border-box',
  };

  const labelStyle = {
    fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 4, display: 'block',
  };

  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-title">
          <h1>Portfolio</h1>
          <p>Live Bybit UTA account · spot holdings &amp; orders</p>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={refresh}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Balance section */}
        <div className="settings-section">
          <h3>Holdings</h3>
          <p className="subtitle">Spot wallet · free &amp; locked balances</p>

          {loadingBalance ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading...</div>
          ) : balance.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No assets found</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: 'var(--text-3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>
                  <th style={{ textAlign: 'left', padding: '6px 0', fontWeight: 600 }}>Asset</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>Free</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>Locked</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontWeight: 600 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {balance.map(c => (
                  <tr key={c.asset} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <CoinGlyph symbol={c.asset} size={20} />
                        <span style={{ fontWeight: 600 }}>{c.asset}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{c.free.toFixed(6)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: c.locked > 0 ? 'var(--text-2)' : 'var(--text-3)' }}>
                      {c.locked.toFixed(6)}
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{c.total.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Orders section */}
        <div className="settings-section">
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            {['orders', 'history'].map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                  fontSize: 14, fontWeight: 600,
                  color: tab === t ? 'var(--text-1)' : 'var(--text-3)',
                  borderBottom: tab === t ? '2px solid var(--primary)' : '2px solid transparent',
                }}
              >
                {t === 'orders' ? `Open Orders (${openOrders.length})` : `History (${history.length})`}
              </button>
            ))}
          </div>

          {tab === 'orders' && (
            loadingOrders ? (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading...</div>
            ) : openOrders.length === 0 ? (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No open orders</div>
            ) : (
              <OrdersTable orders={openOrders} onCancel={cancelOrder} cancelling={cancelling} />
            )
          )}

          {tab === 'history' && (
            history.length === 0 ? (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No history</div>
            ) : (
              <OrdersTable orders={history} onCancel={null} cancelling={null} />
            )
          )}
        </div>

        {/* Place Order section */}
        <div className="settings-section">
          <h3>Place Order</h3>

          {status && (
            <div style={{
              padding: '8px 12px',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              background: status.ok ? 'rgba(0,200,100,0.12)' : 'rgba(255,80,80,0.12)',
              color: status.ok ? 'var(--long)' : 'var(--short)',
              marginBottom: 12,
            }}>
              {status.msg}
            </div>
          )}

          <form onSubmit={placeOrder}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>

              {/* Symbol */}
              <div>
                <label style={labelStyle}>Symbol</label>
                <select
                  value={form.symbol}
                  onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
                  style={inputStyle}
                >
                  {['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              {/* Side */}
              <div>
                <label style={labelStyle}>Side</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['BUY', 'SELL'].map(s => (
                    <button
                      key={s} type="button"
                      onClick={() => setForm(f => ({ ...f, side: s }))}
                      className="btn"
                      style={{
                        flex: 1,
                        background: form.side === s
                          ? s === 'BUY' ? 'rgba(0,200,100,0.15)' : 'rgba(255,80,80,0.15)'
                          : 'transparent',
                        color: form.side === s
                          ? s === 'BUY' ? 'var(--long)' : 'var(--short)'
                          : 'var(--text-3)',
                        border: '1px solid',
                        borderColor: form.side === s
                          ? s === 'BUY' ? 'var(--long)' : 'var(--short)'
                          : 'var(--line)',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type */}
              <div>
                <label style={labelStyle}>Type</label>
                <select
                  value={form.orderType}
                  onChange={e => setForm(f => ({ ...f, orderType: e.target.value }))}
                  style={inputStyle}
                >
                  {['Market', 'Limit', 'Stop-Limit'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Qty */}
              <div>
                <label style={labelStyle}>Qty</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.001"
                  value={form.qty}
                  onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              {/* Price — Limit / Stop-Limit only */}
              {(form.orderType === 'Limit' || form.orderType === 'Stop-Limit') && (
                <div>
                  <label style={labelStyle}>Price</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="65000"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              )}

              {/* Trigger — Stop-Limit only */}
              {form.orderType === 'Stop-Limit' && (
                <div>
                  <label style={labelStyle}>Trigger</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="64500"
                    value={form.triggerPrice}
                    onChange={e => setForm(f => ({ ...f, triggerPrice: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              )}

              {/* Stop Loss */}
              <div>
                <label style={labelStyle}>SL (optional)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="63000"
                  value={form.stopLoss}
                  onChange={e => setForm(f => ({ ...f, stopLoss: e.target.value }))}
                  style={inputStyle}
                />
              </div>

              {/* Take Profit */}
              <div>
                <label style={labelStyle}>TP (optional)</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="68000"
                  value={form.takeProfit}
                  onChange={e => setForm(f => ({ ...f, takeProfit: e.target.value }))}
                  style={inputStyle}
                />
              </div>

            </div>

            <button type="submit" className="btn btn-primary" disabled={placing || !form.qty || parseFloat(form.qty) <= 0}>
              {placing ? 'Placing...' : 'Place Order'}
            </button>
          </form>
        </div>

        {/* Bot Trades section */}
        <div className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0 }}>Bot Trades</h3>
              <p className="subtitle" style={{ marginTop: 4 }}>Auto-executed by signal engine</p>
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {botTrades.filter(t => t.status === 'OPEN').length} open
            </span>
          </div>

          {loadingBotTrades ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading...</div>
          ) : botTrades.length === 0 ? (
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No bot trades</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
                <thead>
                  <tr style={{ color: 'var(--text-3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', fontWeight: 600 }}>Symbol</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Side</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Entry</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>SL</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>TP</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Qty</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Status</th>
                    <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontWeight: 600 }}>PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {botTrades.map(t => {
                    const base = t.symbol?.replace(/USDT$|USDC$/, '') || t.symbol;
                    const isBuy = t.side === 'BUY';
                    const isOpen = t.status === 'OPEN';
                    const pnlColor = t.pnl > 0.1 ? 'var(--long)' : t.pnl < -0.1 ? 'var(--short)' : 'var(--text-3)';
                    return (
                      <tr key={t.id} style={{ borderTop: '1px solid var(--line)', opacity: isOpen ? 1 : 0.7 }}>
                        <td style={{ padding: '10px 8px 10px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CoinGlyph symbol={base} size={18}/>
                            <span style={{ fontWeight: 600 }}>{t.symbol}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span className={`badge ${isBuy ? 'badge-long' : 'badge-short'}`}>
                            {isBuy ? '▲' : '▼'} {t.side}
                          </span>
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {t.price > 0 ? `$${formatPrice(t.price)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--short)', fontSize: 12 }}>
                          {t.stopLoss > 0 ? `$${formatPrice(t.stopLoss)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--long)', fontSize: 12 }}>
                          {t.takeProfit > 0 ? `$${formatPrice(t.takeProfit)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                          {t.quantity}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <span className={`badge ${isOpen ? 'badge-pending' : 'badge-win'}`}>
                            {isOpen ? 'OPEN' : 'CLOSED'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 0 10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: pnlColor, fontWeight: isOpen ? 400 : 600 }}>
                          {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${t.pnl}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function OrdersTable({ orders, onCancel, cancelling }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
        <thead>
          <tr style={{ color: 'var(--text-3)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.06em' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px 6px 0', fontWeight: 600 }}>Symbol</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Side</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Type</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Price</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Trigger</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Qty</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>Filled</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>Status</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>SL</th>
            <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 600 }}>TP</th>
            <th style={{ textAlign: 'right', padding: '6px 0 6px 8px', fontWeight: 600 }}>Time</th>
            {onCancel && <th style={{ width: 32 }} />}
          </tr>
        </thead>
        <tbody>
          {orders.map(o => {
            const base = o.symbol?.replace(/USDT$|USDC$/, '') || o.symbol;
            const isBuy = o.side === 'Buy';
            const isOpen = o.orderStatus === 'New' || o.orderStatus === 'PartiallyFilled';
            return (
              <tr key={o.orderId} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '10px 8px 10px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CoinGlyph symbol={base} size={18} />
                    <span style={{ fontWeight: 600 }}>{o.symbol}</span>
                  </div>
                </td>
                <td style={{ padding: '10px 8px' }}>
                  <span className={`badge ${isBuy ? 'badge-long' : 'badge-short'}`}>
                    {isBuy ? '▲' : '▼'} {o.side}
                  </span>
                </td>
                <td style={{ padding: '10px 8px', color: 'var(--text-2)', fontSize: 12 }}>
                  {o.stopOrderType || o.orderType}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {o.price > 0 ? `$${formatPrice(o.price)}` : '—'}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
                  {o.triggerPrice > 0 ? `$${formatPrice(o.triggerPrice)}` : '—'}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{o.qty}</td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                  {o.cumExecQty > 0 ? o.cumExecQty : '—'}
                </td>
                <td style={{ padding: '10px 8px' }}>
                  <StatusBadge status={o.orderStatus} />
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--short)', fontSize: 12 }}>
                  {o.stopLoss > 0 ? `$${formatPrice(o.stopLoss)}` : '—'}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--long)', fontSize: 12 }}>
                  {o.takeProfit > 0 ? `$${formatPrice(o.takeProfit)}` : '—'}
                </td>
                <td style={{ padding: '10px 0 10px 8px', textAlign: 'right', color: 'var(--text-3)', fontSize: 12 }}>
                  {o.createdTime ? new Date(o.createdTime).toLocaleTimeString() : '—'}
                </td>
                {onCancel && (
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>
                    {isOpen && (
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', padding: 4 }}
                        onClick={() => onCancel(o)}
                        disabled={cancelling === o.orderId}
                        title="Cancel order"
                      >
                        {cancelling === o.orderId ? '…' : '×'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    New: ['badge-pending', 'NEW'],
    PartiallyFilled: ['badge-warn', 'PARTIAL'],
    Filled: ['badge-win', 'FILLED'],
    Cancelled: ['badge-wait', 'CANCELLED'],
    Rejected: ['badge-loss', 'REJECTED'],
  };
  const [cls, label] = map[status] || ['badge-pending', status];
  return <span className={`badge ${cls}`}>{label}</span>;
}
