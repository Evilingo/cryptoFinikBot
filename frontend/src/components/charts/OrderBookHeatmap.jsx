import { useMemo } from 'react';

/**
 * Heatmap стакана — визуализация стен ордеров.
 * Показывает bid/ask объёмы по ценовым уровням с цветовой интенсивностью.
 */
export default function OrderBookHeatmap({ heatmap, midPrice }) {
  const { maxBid, maxAsk, midIdx } = useMemo(() => {
    if (!heatmap || heatmap.length === 0) return { maxBid: 1, maxAsk: 1, midIdx: 0 };
    let maxBid = 0;
    let maxAsk = 0;
    let midIdx = 0;
    let minDist = Infinity;

    heatmap.forEach((b, i) => {
      if (b.bidVol > maxBid) maxBid = b.bidVol;
      if (b.askVol > maxAsk) maxAsk = b.askVol;
      const dist = Math.abs(b.price - midPrice);
      if (dist < minDist) {
        minDist = dist;
        midIdx = i;
      }
    });

    return { maxBid: maxBid || 1, maxAsk: maxAsk || 1, midIdx };
  }, [heatmap, midPrice]);

  if (!heatmap || heatmap.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-gray-600">
        Waiting for order book data...
      </div>
    );
  }

  // Show subset around mid price (±25 buckets)
  const displayRange = 25;
  const start = Math.max(0, midIdx - displayRange);
  const end = Math.min(heatmap.length, midIdx + displayRange + 1);
  const visible = heatmap.slice(start, end);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-dark-600">
        <span className="text-[10px] text-gray-500">Order Book Heatmap</span>
        <div className="flex gap-3 text-[10px]">
          <span className="text-accent-green">Bids</span>
          <span className="text-accent-red">Asks</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-0.5">
        {visible.map((bucket, i) => {
          const isMid = Math.abs(bucket.price - midPrice) < (midPrice * 0.001);
          const bidWidth = (bucket.bidVol / maxBid) * 100;
          const askWidth = (bucket.askVol / maxAsk) * 100;
          const isWall = bucket.intensity > 0.7;

          return (
            <div
              key={i}
              className={`flex items-center h-[14px] group relative ${
                isMid ? 'bg-accent-blue/10 border-y border-accent-blue/30' : ''
              }`}
            >
              {/* Bid bar (right-aligned, green) */}
              <div className="flex-1 flex justify-end h-full">
                <div
                  className={`h-full transition-all duration-300 ${
                    isWall ? 'bg-accent-green/80' : 'bg-accent-green/30'
                  }`}
                  style={{ width: `${bidWidth}%` }}
                />
              </div>

              {/* Price label */}
              <div className={`w-[70px] text-center text-[9px] font-mono flex-shrink-0 ${
                isMid ? 'text-accent-blue font-bold' : 'text-gray-500'
              }`}>
                {bucket.price.toLocaleString(undefined, {
                  minimumFractionDigits: bucket.price > 100 ? 0 : 2,
                  maximumFractionDigits: bucket.price > 100 ? 0 : 2,
                })}
              </div>

              {/* Ask bar (left-aligned, red) */}
              <div className="flex-1 flex justify-start h-full">
                <div
                  className={`h-full transition-all duration-300 ${
                    isWall ? 'bg-accent-red/80' : 'bg-accent-red/30'
                  }`}
                  style={{ width: `${askWidth}%` }}
                />
              </div>

              {/* Wall indicator */}
              {isWall && (
                <div className="absolute right-1 text-[8px] text-yellow-400 font-bold opacity-70">
                  WALL
                </div>
              )}

              {/* Tooltip on hover */}
              <div className="absolute hidden group-hover:block z-10 left-1/2 -translate-x-1/2 -top-7 bg-dark-700 border border-dark-500 rounded px-2 py-1 text-[9px] whitespace-nowrap shadow-lg">
                Bid: {bucket.bidVol.toFixed(3)} | Ask: {bucket.askVol.toFixed(3)} | Total: {bucket.total}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
