const express = require('express');
const router = express.Router();

// Mount specific route modules
router.use('/auth', require('./routes/auth'));
router.use('/accounts', require('./routes/accounts'));
router.use('/setups', require('./routes/setups'));
router.use('/orders', require('./routes/orders'));
router.use('/users', require('./routes/users'));
router.use('/system', require('./routes/system'));
router.use('/screener-status', require('./routes/screenerStatus'));
router.use('/webhook', require('./routes/webhook'));
router.use('/symbols', require('./routes/symbols'));
router.use('/ew-subscriptions', require('./routes/ewSubscriptions'));
router.use('/mazscore-subscriptions', require('./routes/mazscoreSubscriptions'));
router.use('/supertrend-subscriptions', require('./routes/supertrendSubscriptions'));
router.use('/price-alarms', require('./routes/priceAlarms'));
router.use('/candles', require('./routes/candles'));

module.exports = router;
