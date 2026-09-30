function checkPriceLevel(candles, params) {
  const priceLevel = params?.priceLevel;
  
  if (!priceLevel || priceLevel === 0) {
    return { met: false };
  }
  
  if (!candles || candles.length === 0) {
    return { met: false };
  }
  
  const lastClose = candles[candles.length - 1].close;
  
  if (candles.length === 1) {
    if (lastClose > priceLevel) {
      return { met: true, signal: 'bullish_crossover' };
    }
    if (lastClose < priceLevel) {
      return { met: true, signal: 'bearish_crossover' };
    }
    return { met: false };
  }
  
  const prevClose = candles[candles.length - 2].close;
  
  if (prevClose <= priceLevel && lastClose > priceLevel) {
    return { met: true, signal: 'bullish_crossover' };
  }
  
  if (prevClose >= priceLevel && lastClose < priceLevel) {
    return { met: true, signal: 'bearish_crossover' };
  }
  
  return { met: false };
}

module.exports = { checkPriceLevel };