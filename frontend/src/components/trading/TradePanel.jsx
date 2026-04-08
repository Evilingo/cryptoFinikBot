import { useState } from 'react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function TradePanel({ pairs, selectedPair, onSelectPair, obdData }) {
  const [side, setSide] = useState('BUY');
  const [quantity, setQuantity] = useState('');
  const [slPercent, setSlPercent] = useState('');
  const [tpPercent, setTpPercent] = useState('');
  const [loading, setLoading] = useState(false);

  const currentPrice = selectedPair
    ? obdData[selectedPair.monitorSymbol]?.midPrice
    : null;

  const handleOrder = async () => {
    if (!selectedPair || !quantity) return;

    const tradeSymbol = selectedPair.tradeSymbol.replace('/', '');
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return toast.error('Invalid quantity');

    let stopLoss = null;
    let takeProfit = null;

    if (currentPrice && slPercent) {
      const slPct = parseFloat(slPercent) / 100;
      stopLoss = side === 'BUY'
        ? currentPrice * (1 - slPct)
        : currentPrice * (1 + slPct);
    }

    if (currentPrice && tpPercent) {
      const tpPct = parseFloat(tpPercent) / 100;
      takeProfit = side === 'BUY'
        ? currentPrice * (1 + tpPct)
        : currentPrice * (1 - tpPct);
    }

    setLoading(true);
    try {
      const { data } = await api.post('/trade/order', {
        symbol: tradeSymbol,
        side,
        quantity: qty,
        stopLoss: stopLoss ? parseFloat(stopLoss.toFixed(2)) : undefined,
        takeProfit: takeProfit ? parseFloat(takeProfit.toFixed(2)) : undefined,
      });
      toast.success(`Order placed: ${data.type} #${data.orderId}`);
      setQuantity('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Order failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-4">
      <h2 className="text-sm font-semibold mb-3">Trade</h2>

      {/* Pair selector */}
      <div className="mb-3">
        <label className="block text-xs text-gray-500 mb-1">Pair (USDT)</label>
        <select
          value={selectedPair?.id || ''}
          onChange={(e) => {
            const p = pairs.find((x) => x.id === Number(e.target.value));
            if (p) onSelectPair(p);
          }}
          className="w-full text-sm"
        >
          {pairs.map((p) => (
            <option key={p.id} value={p.id}>{p.tradeSymbol}</option>
          ))}
        </select>
      </div>

      {/* Price display */}
      {currentPrice && (
        <div className="text-center text-lg font-bold mb-3 font-mono">
          ${currentPrice.toLocaleString()}
        </div>
      )}

      {/* Side toggle */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setSide('BUY')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
            side === 'BUY'
              ? 'bg-accent-green text-white'
              : 'bg-dark-700 text-gray-400'
          }`}
        >
          BUY
        </button>
        <button
          onClick={() => setSide('SELL')}
          className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
            side === 'SELL'
              ? 'bg-accent-red text-white'
              : 'bg-dark-700 text-gray-400'
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
        />
      </div>

      {/* SL / TP */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Stop Loss %</label>
          <input
            type="number"
            step="0.1"
            value={slPercent}
            onChange={(e) => setSlPercent(e.target.value)}
            className="w-full text-sm"
            placeholder="2.0"
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
            placeholder="3.0"
          />
        </div>
      </div>

      {/* SL/TP price preview */}
      {currentPrice && (slPercent || tpPercent) && (
        <div className="text-xs text-gray-500 mb-3 space-y-0.5">
          {slPercent && (
            <div>
              SL: ${(side === 'BUY'
                ? currentPrice * (1 - parseFloat(slPercent) / 100)
                : currentPrice * (1 + parseFloat(slPercent) / 100)
              ).toFixed(2)}
            </div>
          )}
          {tpPercent && (
            <div>
              TP: ${(side === 'BUY'
                ? currentPrice * (1 + parseFloat(tpPercent) / 100)
                : currentPrice * (1 - parseFloat(tpPercent) / 100)
              ).toFixed(2)}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleOrder}
        disabled={loading || !quantity}
        className={`w-full py-3 rounded-lg text-sm font-bold transition-colors ${
          side === 'BUY'
            ? 'bg-accent-green hover:bg-green-600 disabled:opacity-40'
            : 'bg-accent-red hover:bg-red-600 disabled:opacity-40'
        } text-white`}
      >
        {loading ? 'Placing...' : `${side} ${selectedPair?.tradeSymbol.replace('USDT', '') || ''}`}
      </button>
    </div>
  );
}
