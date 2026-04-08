import { useState, useEffect } from 'react';
import api from '../../services/api';

export default function OpenPositions() {
  const [trades, setTrades] = useState([]);

  useEffect(() => {
    api.get('/trade')
      .then(({ data }) => setTrades(data.filter((t) => t.status === 'OPEN')))
      .catch(() => {});

    const interval = setInterval(() => {
      api.get('/trade')
        .then(({ data }) => setTrades(data.filter((t) => t.status === 'OPEN')))
        .catch(() => {});
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-dark-800 rounded-xl border border-dark-600 p-4 flex-1 overflow-auto">
      <h2 className="text-sm font-semibold mb-3">Open Positions</h2>

      {trades.length === 0 ? (
        <div className="text-xs text-gray-500">No open positions</div>
      ) : (
        <div className="space-y-2">
          {trades.map((t) => (
            <div key={t.id} className="flex items-center justify-between bg-dark-700 rounded-lg px-3 py-2">
              <div>
                <span className={`text-xs font-bold ${t.side === 'BUY' ? 'text-accent-green' : 'text-accent-red'}`}>
                  {t.side}
                </span>
                <span className="text-xs text-gray-400 ml-2">{t.symbol}</span>
              </div>
              <div className="text-right">
                <div className="text-xs font-mono">{t.quantity}</div>
                <div className="text-[10px] text-gray-500">@ ${t.price?.toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
