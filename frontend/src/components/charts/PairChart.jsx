import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import api from '../../services/api';

export default function PairChart({ symbol, klineRef }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#12121a' },
        textColor: '#6b7280',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1a25' },
        horzLines: { color: '#1a1a25' },
      },
      crosshair: {
        mode: 0,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#1a1a25',
      },
      rightPriceScale: {
        borderColor: '#1a1a25',
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Load historical candles directly from Binance (public API, no auth)
    fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=200`)
      .then((res) => res.json())
      .then((data) => {
        const candles = data.map((k) => ({
          time: Math.floor(k[0] / 1000),
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }));
        series.setData(candles);
        chart.timeScale().fitContent();
      })
      .catch(() => {});

    // Resize observer
    const node = containerRef.current;
    const observer = new ResizeObserver(() => {
      if (!node) return;
      chart.applyOptions({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [symbol]);

  // Update from WS klines
  useEffect(() => {
    const interval = setInterval(() => {
      const kline = klineRef.current?.[symbol];
      if (kline && seriesRef.current) {
        seriesRef.current.update({
          time: Math.floor(kline.t / 1000),
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
        });
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [symbol, klineRef]);

  return <div ref={containerRef} className="w-full h-full" />;
}
