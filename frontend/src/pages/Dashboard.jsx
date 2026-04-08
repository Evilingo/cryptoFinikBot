import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAlertSound } from '../hooks/useAlertSound';
import Header from '../components/layout/Header';
import PairChart from '../components/charts/PairChart';
import IndicatorPanel from '../components/charts/IndicatorPanel';
import TradePanel from '../components/trading/TradePanel';
import OpenPositions from '../components/trading/OpenPositions';
import SignalModal from '../components/signals/SignalModal';
import OrderBookHeatmap from '../components/charts/OrderBookHeatmap';

export default function Dashboard() {
  const [pairs, setPairs] = useState([]);
  const [selectedPair, setSelectedPair] = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'single'
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [balances, setBalances] = useState([]);
  const obdRef = useRef({}); // symbol -> { obd1..4, midPrice, heatmap }
  const [obdData, setObdData] = useState({});
  const klinesRef = useRef({}); // symbol -> latest kline
  const [activeSignal, setActiveSignal] = useState(null);

  const playAlert = useAlertSound();

  useEffect(() => {
    api.get('/pairs').then(({ data }) => {
      setPairs(data);
      if (data.length > 0) setSelectedPair(data[0]);
    });
    api.get('/balance').then(({ data }) => setBalances(data)).catch(() => {});
  }, []);

  const onWsMessage = useCallback((msg) => {
    if (msg.type === 'OBD_UPDATE') {
      obdRef.current[msg.symbol] = {
        obd1: msg.obd1, obd2: msg.obd2,
        obd3: msg.obd3, obd4: msg.obd4,
        midPrice: msg.midPrice, heatmap: msg.heatmap,
        timestamp: msg.timestamp,
      };
      setObdData({ ...obdRef.current });
    }
    if (msg.type === 'KLINE') {
      klinesRef.current[msg.symbol] = msg.kline;
    }
    if (msg.type === 'BALANCE') {
      setBalances(msg.balances);
    }
    if (msg.type === 'SIGNAL') {
      // Play alert sound
      playAlert();
      // Open signal modal with chart + trade form
      setActiveSignal(msg.signal);
    }
  }, [playAlert]);

  const { connected } = useWebSocket(onWsMessage);

  const displayPairs = viewMode === 'grid' ? pairs : (selectedPair ? [selectedPair] : []);

  return (
    <div className="flex flex-col h-full gap-4">
      <Header
        balances={balances}
        connected={connected}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        showHeatmap={showHeatmap}
        onToggleHeatmap={() => setShowHeatmap((v) => !v)}
      />

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Charts Area */}
        <div className="flex-1 min-w-0">
          {/* Pair tabs (single mode) */}
          {viewMode === 'single' && (
            <div className="flex gap-1 mb-3">
              {pairs.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPair(p)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    selectedPair?.id === p.id
                      ? 'bg-accent-blue text-white'
                      : 'bg-dark-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {p.monitorSymbol.replace('USDC', '')}
                </button>
              ))}
            </div>
          )}

          <div className={`grid gap-3 h-full ${
            viewMode === 'grid' ? 'grid-cols-2 grid-rows-2' : 'grid-cols-1'
          }`}>
            {displayPairs.map((pair) => (
              <div key={pair.id} className="flex flex-col bg-dark-800 rounded-xl border border-dark-600 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-dark-600">
                  <span className="font-semibold text-sm">
                    {pair.monitorSymbol.replace('USDC', '')}/USDC
                  </span>
                  <span className="text-xs text-gray-500">
                    {obdData[pair.monitorSymbol]?.midPrice
                      ? `$${obdData[pair.monitorSymbol].midPrice.toLocaleString()}`
                      : '—'}
                  </span>
                </div>
                <div className="flex-1 min-h-[200px]">
                  {showHeatmap ? (
                    <OrderBookHeatmap
                      heatmap={obdData[pair.monitorSymbol]?.heatmap}
                      midPrice={obdData[pair.monitorSymbol]?.midPrice || 0}
                    />
                  ) : (
                    <PairChart
                      symbol={pair.monitorSymbol}
                      klineRef={klinesRef}
                    />
                  )}
                </div>
                <IndicatorPanel obd={obdData[pair.monitorSymbol]} />
              </div>
            ))}
          </div>
        </div>

        {/* Trade Panel (right side) */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-3">
          <TradePanel
            pairs={pairs}
            selectedPair={selectedPair}
            onSelectPair={setSelectedPair}
            obdData={obdData}
          />
          <OpenPositions />
        </div>
      </div>

      {/* Signal Modal — opens automatically on signal */}
      {activeSignal && (
        <SignalModal
          signal={activeSignal}
          pairs={pairs}
          obdData={obdData}
          klinesRef={klinesRef}
          onClose={() => setActiveSignal(null)}
        />
      )}
    </div>
  );
}
