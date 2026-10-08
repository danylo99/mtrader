const https = require('https');
const fs = require('fs');
const path = require('path');

const BYBIT_BASE_URL = 'https://api.bybit.com';
const SYMBOLS_CONFIG_PATH = path.join(__dirname, '..', 'src', 'config', 'symbols', 'assets.json');
const PRICES_DIR = path.join(__dirname, '..', 'prices');

const INTERVAL_MAP = {
  'm5':  { bybit: '5',  ms: 5 * 60 * 1000 },
  'm15': { bybit: '15', ms: 15 * 60 * 1000 },
  'm30': { bybit: '30', ms: 30 * 60 * 1000 },
  'h1':  { bybit: '60', ms: 60 * 60 * 1000 },
  'h2':  { bybit: '120', ms: 2 * 60 * 60 * 1000 },
  'h4':  { bybit: '240', ms: 4 * 60 * 60 * 1000 },
  'd1':  { bybit: 'D',  ms: 24 * 60 * 60 * 1000 },
};

const CHUNK_LIMIT = 1000;
const REQUEST_DELAY_MS = 200;
const RETRY_DELAY_MS = 3000;
const MAX_RETRIES = 5;

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { interval: 'm15', years: 5 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--interval' || args[i] === '-i') {
      options.interval = args[++i];
    } else if (args[i] === '--years' || args[i] === '-y') {
      options.years = parseFloat(args[++i]);
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!INTERVAL_MAP[options.interval]) {
    console.error(`Invalid interval: ${options.interval}. Supported: ${Object.keys(INTERVAL_MAP).join(', ')}`);
    process.exit(1);
  }
  return options;
}

function printHelp() {
  console.log(`
Download OHLC candle data from Bybit.

Usage: node cli/download-bybit-data.js [options]

Options:
  -i, --interval <interval>  Candle interval. Default: m15
                             Supported: m5, m15, m30, h1, h2, h4, d1
  -y, --years <years>        Years of historical data to download. Default: 5
  -h, --help                 Show this help
`);
}

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function bybitSymbol(symbol) {
  return symbol.split('/')[0] + 'USDT';
}

async function fetchKlines(apiSymbol, interval, endTime) {
  const iv = INTERVAL_MAP[interval];
  let url = `${BYBIT_BASE_URL}/v5/market/kline?category=linear&symbol=${apiSymbol}&interval=${iv.bybit}&limit=${CHUNK_LIMIT}`;
  if (endTime) url += `&end=${Math.floor(endTime)}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await delay(REQUEST_DELAY_MS);
    const res = await getJSON(url);
    if (res.retCode === 0) {
      return res.result.list || [];
    }
    if (res.retCode === 10006) {
      const wait = RETRY_DELAY_MS * attempt;
      process.stdout.write(`  rate limited, retrying in ${wait / 1000}s (attempt ${attempt}/${MAX_RETRIES})   \r`);
      await delay(wait);
      continue;
    }
    throw new Error(`Bybit API error (${res.retCode}): ${res.retMsg}`);
  }
  throw new Error(`Failed after ${MAX_RETRIES} retries (rate limited)`);
}

async function downloadSymbol(symbol, display, interval, years) {
  const apiSymbol = bybitSymbol(symbol);
  const now = Date.now();
  const fromTime = now - years * 365.25 * 24 * 60 * 60 * 1000;

  console.log(`\n[${display}] Fetching ${apiSymbol} ${interval} from ${new Date(fromTime).toISOString().slice(0, 10)}`);

  const chunks = [];
  let endTime = null;
  let chunkCount = 0;

  while (true) {
    const candles = await fetchKlines(apiSymbol, interval, endTime);
    chunkCount++;

    if (!candles || candles.length === 0) break;

    const oldestInBatch = parseInt(candles[candles.length - 1][0]);

    const filtered = candles.filter(c => parseInt(c[0]) >= fromTime);
    chunks.push(filtered);

    const total = chunks.reduce((s, c) => s + c.length, 0);
    process.stdout.write(`  chunk ${chunkCount}: got ${filtered.length} candles (total ${total})\r`);

    if (filtered.length < CHUNK_LIMIT || oldestInBatch <= fromTime) break;

    endTime = oldestInBatch - 1;
  }

  if (chunks.length === 0) {
    console.log(`  No data received`);
    return;
  }

  const allCandles = chunks.flat().reverse();

  const filePath = path.join(PRICES_DIR, `${display}.csv`);
  const header = 'timestamp,open,high,low,close,volume,volume2\n';
  const rows = allCandles.map(c => c.join(',')).join('\n');
  fs.writeFileSync(filePath, header + rows);

  const from = new Date(parseInt(allCandles[0][0])).toISOString().slice(0, 10);
  const to = new Date(parseInt(allCandles[allCandles.length - 1][0])).toISOString().slice(0, 10);
  console.log(`  Done: ${allCandles.length} candles, ${from} -> ${to}, saved to prices/${display}.csv`);
}

async function main() {
  const options = parseArgs();

  if (!fs.existsSync(PRICES_DIR)) {
    fs.mkdirSync(PRICES_DIR, { recursive: true });
  }

  const config = JSON.parse(fs.readFileSync(SYMBOLS_CONFIG_PATH, 'utf8'));

  const bybitAssets = config.assets.filter(a => a.provider === 'bybit');

  console.log(`Downloading ${bybitAssets.length} symbols, interval=${options.interval}, years=${options.years}\n`);

  for (const asset of bybitAssets) {
    try {
      await downloadSymbol(asset.symbol_ccxt, asset.display.replace("USDT.P","_"+options.interval), options.interval, options.years);
      await delay(1000);
    } catch (err) {
      console.error(`  FAILED [${asset.display}]: ${err.message}`);
    }
  }

  console.log(`\nAll downloads complete.`);
}

main().catch(console.error);