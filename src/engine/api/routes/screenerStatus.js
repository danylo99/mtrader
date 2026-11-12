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

router.get('/ew-fast-break', async (req, res) => {
  try {
    const db = getDatabaseManager();
    const rows = await db.getScreenerSnapshots('ewt');
    res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('Failed to fetch EW Fast Break snapshots:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;