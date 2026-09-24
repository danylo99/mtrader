const express = require('express');
const router = express.Router();
const { getDatabaseManager } = require('../../db');
const logger = require('../../logger');

router.get('/supertrend', async (req, res) => {
  try {
    const db = getDatabaseManager();
    const rows = await db.getScreenerSnapshots('rollingsupertrend2');
    res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('Failed to fetch supertrend directions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/ew', async (req, res) => {
  try {
    const db = getDatabaseManager();
    const rows = await db.getScreenerSnapshots('ewt');
    res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('Failed to fetch EW snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/mazscore', async (req, res) => {
  try {
    const db = getDatabaseManager();
    const rows = await db.getScreenerSnapshots('mazscore');
    res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('Failed to fetch MA Z-Score snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/mazscore-extreme', async (req, res) => {
  try {
    const db = getDatabaseManager();
    const rows = await db.getScreenerSnapshots('mazscore_extreme');
    const entries = {};
    for (const row of rows) {
      entries[`${row.symbol}:${row.timeframe}`] = row.signal;
    }
    const avgRows = await db.getScreenerSnapshots('mazscore_avg_extreme');
    const avgExtreme = avgRows.length > 0 ? avgRows[0].signal : null;
    res.json({ success: true, data: entries, avgExtreme });
  } catch (error) {
    logger.error('Failed to fetch MA Z-Score extremes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;