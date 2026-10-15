const ccxt = require('ccxt');

async function check() {
  const ex = new ccxt.bybit();
  try {
    console.log('Loading markets...');
    await ex.loadMarkets();
    const symbols = ['EURUSD/USDT:USDT', 'USDJPY/USDT:USDT'];
    for (const s of symbols) {
      if (ex.markets[s]) {
        console.log('OK:', s, 'found in markets');
        try {
          const ticker = await ex.fetchTicker(s);
          console.log('  price:', ticker.last);
        } catch (e) {
          console.log('  ticker fetch failed:', e.message);
        }
      } else {
        console.log('NOT FOUND:', s);
      }
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

check();
