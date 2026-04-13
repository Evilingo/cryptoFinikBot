import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';

const OBD_CONFIG = [
  { key: 'obd1', label: 'OBD-1 (2.5%/5%)', color: '#3b82f6' },
  { key: 'obd2', label: 'OBD-2 (5%/10%)', color: '#8b5cf6' },
  { key: 'obd3', label: 'OBD-3 (5%/25%)', color: '#f59e0b' },
  { key: 'obd4', label: 'OBD-4 (10%/25%)', color: '#10b981' },
];

function ObdLineChart({ label, color, dataRef, dataKey, symbol }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0a0a0f' },
        textColor: '#4b5563',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#1a1a2500' },
        horzLines: { color: '#1a1a25' },
      },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      rightPriceScale: {
        borderColor: '#1a1a25',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      crosshair: { mode: 0 },
      handleScale: false,
      handleScroll: false,
    });

    const series = chart.addLineSeries({
      color,
      lineWidth: 1.5,
      priceLineVisible: true,
      priceLineColor: color + '60',
      lastValueVisible: true,
      crosshairMarkerVisible: false,
    });

    // Add 50-line (neutral zone)
    const baseline = chart.addLineSeries({
      color: '#374151',
      lineWidth: 1,
      lineStyle: 2, // dashed
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chartRef.current = chart;
    seriesRef.current = { series, baseline };

    const node = containerRef.current;
    const observer = new ResizeObserver(() => {
      if (!node) return;
      chart.applyOptions({ width: node.clientWidth, height: node.clientHeight });
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [color]);

  // Update data from history buffer
  useEffect(() => {
    const interval = setInterval(() => {
      const history = dataRef.current?.[symbol];
      if (!history?.length || !seriesRef.current) return;

      const lineData = history.map((h) => ({
        time: Math.floor(h.timestamp / 1000),
        value: h[dataKey],
      }));

      // Deduplicate by time
      const seen = new Set();
      const unique = lineData.filter((d) => {
        if (seen.has(d.time)) return false;
        seen.add(d.time);
        return true;
      });

      seriesRef.current.series.setData(unique);

      // 50-line baseline
      if (unique.length >= 2) {
        seriesRef.current.baseline.setData([
          { time: unique[0].time, value: 50 },
          { time: unique[unique.length - 1].time, value: 50 },
        ]);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [dataRef, dataKey, symbol]);

  return (
    <div className="flex-1 min-h-0 relative">
      <div className="absolute top-0 left-1 text-[9px] text-gray-500 z-10">{label}</div>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

export default function ObdCharts({ symbol, obdHistoryRef }) {
  return (
    <div className="flex flex-col h-full border-t border-dark-600 bg-dark-900/50">
      {OBD_CONFIG.map((cfg) => (
        <ObdLineChart
          key={cfg.key}
          label={cfg.label}
          color={cfg.color}
          dataRef={obdHistoryRef}
          dataKey={cfg.key}
          symbol={symbol}
        />
      ))}
    </div>
  );
}
