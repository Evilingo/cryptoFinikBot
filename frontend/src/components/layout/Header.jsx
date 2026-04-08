export default function Header({ balances, connected, viewMode, onViewModeChange, showHeatmap, onToggleHeatmap }) {
  const usdt = balances.find((b) => b.asset === 'USDT');
  const usdc = balances.find((b) => b.asset === 'USDC');

  return (
    <div className="flex items-center justify-between bg-dark-800 rounded-xl border border-dark-600 px-4 py-3">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-accent-green' : 'bg-accent-red'}`} />
          <span className="text-xs text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {usdt && (
          <div className="text-sm">
            <span className="text-gray-500">USDT:</span>{' '}
            <span className="font-medium">{parseFloat(usdt.free).toFixed(2)}</span>
          </div>
        )}
        {usdc && (
          <div className="text-sm">
            <span className="text-gray-500">USDC:</span>{' '}
            <span className="font-medium">{parseFloat(usdc.free).toFixed(2)}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Heatmap toggle */}
        <button
          onClick={onToggleHeatmap}
          className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
            showHeatmap
              ? 'bg-accent-yellow/20 text-accent-yellow border border-accent-yellow/30'
              : 'bg-dark-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          Heatmap
        </button>

        {/* View mode */}
        <div className="flex gap-1 bg-dark-700 rounded-lg p-0.5">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'grid' ? 'bg-dark-500 text-white' : 'text-gray-400'
            }`}
          >
            2x2
          </button>
          <button
            onClick={() => onViewModeChange('single')}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              viewMode === 'single' ? 'bg-dark-500 text-white' : 'text-gray-400'
            }`}
          >
            1x1
          </button>
        </div>
      </div>
    </div>
  );
}
