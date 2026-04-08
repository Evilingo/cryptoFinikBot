import { useState, useEffect } from 'react';
import PairChart from '../charts/PairChart';
import IndicatorPanel from '../charts/IndicatorPanel';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function SignalModal({ signal, pairs, obdData, klinesRef, onClose }) {
  const [side, setSide] = useState(signal.direction === 'LONG' ? 'BUY' : 'SELL');
  const [quantity, setQuantity] = useState('');
  const [slPercent, setSlPercent] = useState('');
  const [tpPercent, setTpPercent] = useState('');
  const [loading, setLoading] = useState(false);

  const pair = pairs.find((p) => p.monitorSymbol === signal.monitorSymbol);
  const currentPrice = signal.price;
  const obd = obdData[signal.monitorSymbol];

  // Pre-fill SL/TP from Claude suggestions
  useEffect(() => {
    if (signal.suggestedSl && currentPrice) {
      const slPct = Math.abs((currentPrice - signal.suggestedSl) / currentPrice * 100);
      setSlPercent(slPct.toFixed(1));
    }
    if (signal.suggestedTp && currentPrice) {
      const tpPct = Math.abs((signal.suggestedTp - currentPrice) / currentPrice * 100);
      setTpPercent(tpPct.toFixed(1));
    }
  }, [signal, currentPrice]);

  const handleOrder = async () => {
    if (!pair || !quantity) return;
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return toast.error('Invalid quantity');

    let stopLoss = null;
    let takeProfit = null;

    if (slPercent) {
      const pct = parseFloat(slPercent) / 100;
      stopLoss = side === 'BUY' ? currentPrice * (1 - pct) : currentPrice * (1 + pct);
    }
    if (tpPercent) {
      const pct = parseFloat(tpPercent) / 100;
      takeProfit = side === 'BUY' ? currentPrice * (1 + pct) : currentPrice * (1 - pct);
    }

    setLoading(true);
    try {
      const { data } = await api.post('/trade/order', {
        symbol: pair.tradeSymbol.replace('/', ''),
        side,
        quantity: qty,
        stopLoss: stopLoss ? parseFloat(stopLoss.toFixed(2)) : undefined,
        takeProfit: takeProfit ? parseFloat(takeProfit.toFixed(2)) : undefined,
      });
      toast.success(`Order placed: ${data.type} #${data.orderId}`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Order failed');
    } finally {
      setLoading(false);
    }
  };

  const dirColor = signal.direction === 'LONG'
    ? 'text-accent-green' : signal.direction === 'SHORT'
      ? 'text-accent-red' : 'text-gray-400';

  const dirBg = signal.direction === 'LONG'
    ? 'bg-green-500/10 border-green-500/30' : signal.direction === 'SHORT'
      ? 'bg-red-500/10 border-red-500/30' : 'bg-gray-500/10 border-gray-500/30';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-[900px] max-w-[95vw] max-h-[90vh] bg-dark-800 border border-dark-500 rounded-2xl shadow-2xl overflow-hidden flex flex-col">

        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b border-dark-600 ${dirBg}`}>
          <div className="flex items-center gap-4">
            <span className={`text-2xl font-bold ${dirColor}`}>
              {signal.direction === 'LONG' ? '▲' : signal.direction === 'SHORT' ? '▼' : '●'} {signal.direction}
            </span>
            <span className="text-lg font-semibold">
              {signal.monitorSymbol?.replace('USDC', '')}/USDC
            </span>
            <span className="text-lg font-mono text-gray-300">
              ${currentPrice?.toLocaleString()}
            </span>
            {signal.confidence != null && (
              <span className="px-2 py-0.5 rounded bg-dark-700 text-xs text-gray-400">
                Confidence: {signal.confidence}%
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* Left: Chart + OBD + Analysis */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Chart */}
            <div className="flex-1 min-h-[300px]">
              {pair && (
                <PairChart symbol={pair.monitorSymbol} klineRef={klinesRef} />
              )}
            </div>

            {/* OBD indicators */}
            <IndicatorPanel obd={obd} />

            {/* Claude Analysis */}
            <div className="px-4 py-3 border-t border-dark-600 bg-dark-900/50">
              <div className="text-xs text-gray-500 mb-1">Claude Analysis</div>
              <div className="text-sm text-gray-300 leading-relaxed">
                {signal.claudeAnalysis}
              </div>
              <div className="flex gap-4 mt-2 text-xs text-gray-500">
                <span>OBD: {signal.obd1?.toFixed(1)} | {signal.obd2?.toFixed(1)} | {signal.obd3?.toFixed(1)} | {signal.obd4?.toFixed(1)}</span>
                {signal.suggestedSl && <span>SL: ${signal.suggestedSl.toLocaleString()}</span>}
                {signal.suggestedTp && <span>TP: ${signal.suggestedTp.toLocaleString()}</span>}
              </div>
            </div>
          </div>

          {/* Right: Trade form */}
          <div className="w-72 border-l border-dark-600 p-4 flex flex-col bg-dark-800">
            <h3 className="text-sm font-semibold mb-4">Quick Trade — {pair?.tradeSymbol}</h3>

            {/* Side toggle */}
            <div className="flex gap-1 mb-4">
              <button
                onClick={() => setSide('BUY')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                  side === 'BUY' ? 'bg-accent-green text-white' : 'bg-dark-700 text-gray-400'
                }`}
              >
                BUY
              </button>
              <button
                onClick={() => setSide('SELL')}
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                  side === 'SELL' ? 'bg-accent-red text-white' : 'bg-dark-700 text-gray-400'
                }`}
              >
                SELL
              </button>
            </div>

            {/* Quantity */}
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">Quantity</label>
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full text-sm"
                placeholder="0.001"
                autoFocus
              />
            </div>

            {/* SL / TP */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Stop Loss %</label>
                <input
                  type="number"
                  step="0.1"
                  value={slPercent}
                  onChange={(e) => setSlPercent(e.target.value)}
                  className="w-full text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Take Profit %</label>
                <input
                  type="number"
                  step="0.1"
                  value={tpPercent}
                  onChange={(e) => setTpPercent(e.target.value)}
                  className="w-full text-sm"
                />
              </div>
            </div>

            {/* SL/TP price preview */}
            {currentPrice && (slPercent || tpPercent) && (
              <div className="text-xs text-gray-500 mb-4 space-y-0.5">
                {slPercent && (
                  <div>SL: ${(side === 'BUY'
                    ? currentPrice * (1 - parseFloat(slPercent) / 100)
                    : currentPrice * (1 + parseFloat(slPercent) / 100)
                  ).toFixed(2)}</div>
                )}
                {tpPercent && (
                  <div>TP: ${(side === 'BUY'
                    ? currentPrice * (1 + parseFloat(tpPercent) / 100)
                    : currentPrice * (1 - parseFloat(tpPercent) / 100)
                  ).toFixed(2)}</div>
                )}
              </div>
            )}

            <div className="mt-auto space-y-2">
              <button
                onClick={handleOrder}
                disabled={loading || !quantity}
                className={`w-full py-3 rounded-lg text-sm font-bold transition-colors text-white ${
                  side === 'BUY'
                    ? 'bg-accent-green hover:bg-green-600 disabled:opacity-40'
                    : 'bg-accent-red hover:bg-red-600 disabled:opacity-40'
                }`}
              >
                {loading ? 'Placing...' : `${side} ${pair?.tradeSymbol?.replace('USDT', '') || ''}`}
              </button>
              <button
                onClick={onClose}
                className="w-full py-2 rounded-lg text-sm text-gray-400 bg-dark-700 hover:bg-dark-600"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
