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
  res.json({
    bybit: { symbols: allAssets.filter(a => a.provider === 'bybit'), intervals },
    hyperliquid: { symbols: allAssets, intervals },
  });
});

router.get('/:exchange', (req, res) => {
  const { exchange } = req.params;

  switch (exchange) {
    case 'bybit':
      return res.json({ symbols: allAssets.filter(a => a.provider === 'bybit'), intervals });
    case 'hyperliquid':
      return res.json({ symbols: allAssets, intervals });
    default:
      return res.status(404).json({ error: `Unknown exchange: ${exchange}` });
  }
});

module.exports = router;