// Predicates to identify exit orders returned by Bybit getOpenOrders.
// Mirrors frontend/src/pages/Portfolio.jsx hasSlOrder/hasTpOrder — keep in sync.

export const isSlOrder = (o) =>
  o.stopOrderType === 'StopLoss' ||
  o.stopOrderType === 'Stop' ||
  o.stopOrderType === 'OcoTriggerByStopLoss' ||
  (parseFloat(o.triggerPrice || 0) > 0 && parseFloat(o.price || 0) === 0);

export const isTpOrder = (o) =>
  o.stopOrderType === 'TakeProfit' ||
  o.stopOrderType === 'OcoTriggerByTp' ||
  (o.orderType === 'Limit' && parseFloat(o.price || 0) > 0 && parseFloat(o.triggerPrice || 0) > 0);
