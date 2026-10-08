const CandleProvider = require('./candleProvider.js');

const testAssets = [
  { id: 'btc', display: 'BTCUSDC.P', symbol_ccxt: 'BTC/USDT:USDT', symbol_hyperliquid: 'BTC-USDT:USDT', provider: 'bybit' },
  { id: 'eth', display: 'ETHUSDC.P', symbol_ccxt: 'ETH/USDT:USDT', symbol_hyperliquid: 'ETH-USDT:USDT', provider: 'bybit' },
];

const testProvider = new CandleProvider({
  assets: testAssets,
  timeframes: ['m5'],
  limit: 100,
  onUpdate: (symbol, timeframe, candle) => {
    console.log(`[CLOSED] ${symbol} ${timeframe} | O:${candle[1]} H:${candle[2]} L:${candle[3]} C:${candle[4]} V:${candle[5]}`);
  },
  onScreenerUpdate: (symbol, timeframe, closedBars) => {
    console.log(`[SCREENER] ${symbol} ${timeframe} | ${closedBars.length} bars`);
  },
  isTestnet: false
});

testProvider.start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

setTimeout(() => {
  console.log('Stopping after 30 seconds...');
  testProvider.stop().then(() => {
    console.log('Stopped');
    process.exit(0);
  }).catch(err => {
    console.error('Error stopping:', err);
    process.exit(1);
  });
}, 30000);