const axios = require('axios');
const express = require('express');
const Config = require('../../config');

const router = express.Router();

const CANDLE_API_URL = process.env.CANDLE_API_URL || `http://localhost:3004`;
const client = axios.create({ baseURL: CANDLE_API_URL, timeout: 5000 });

router.get('/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const timeframe = req.query.timeframe || 'm15';
    const response = await client.get(`/quote/${encodeURIComponent(symbol)}`, { params: { timeframe } });
    res.json(response.data);
  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    res.status(502).json({ error: 'Candle API unreachable', message: error.message });
  }
});

module.exports = router;