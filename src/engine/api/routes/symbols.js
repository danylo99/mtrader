const express = require('express');
const router = express.Router();
const path = require('path');

function loadAssetsConfig() {
  const dir = __dirname;
  try {
    return require(path.resolve(dir, '../../../config/symbols/assets.json'));
  } catch {
    return require(path.resolve(dir, '../../../../config/symbols/assets.json'));
  }
}

const assetsConfig = loadAssetsConfig();
const allAssets = assetsConfig.assets;
const intervals = assetsConfig.intervals;

router.get('/', (req, res) => {
  const toOption = (a) => ({ symbol: a.symbol_ccxt, display: a.display });
  res.json({
    bybit: { symbols: allAssets.map(toOption), assets: allAssets, intervals },
    hyperliquid: { symbols: allAssets.map(toOption), assets: allAssets, intervals },
  });
});

router.get('/:exchange', (req, res) => {
  const { exchange } = req.params;
  const toOption = (a) => ({ symbol: a.symbol_ccxt, display: a.display });

  if (exchange === 'bybit' || exchange === 'hyperliquid') {
    return res.json({ symbols: allAssets.map(toOption), assets: allAssets, intervals });
  }
  return res.status(404).json({ error: `Unknown exchange: ${exchange}` });
});

module.exports = router;