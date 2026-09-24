const logger = require('../../logger');
const {
  buildSyntheticCandles,
  detectSuperTrendCrossover,
  _calculateSuperTrendAligned,
} = require('./helpers');

function checkSuperTrend(candles, params = {}) {
  try {
    const period = params.period || 10;
    const multiplier = params.multiplier || 3;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    const { superTrend } = _calculateSuperTrendAligned(highs, lows, closes, period, multiplier);
    const nonNull = superTrend.filter(val => val !== null);
    if (nonNull.length < 2) {
      return { met: false, error: 'Insufficient data for SuperTrend calculation' };
    }

    const result = detectSuperTrendCrossover(nonNull, closes, 'SuperTrend');

    return {
      ...result,
      details: {
        period: period,
        multiplier: multiplier,
        trend: result.isBullish ? 'bullish' : 'bearish'
      }
    };
  } catch (error) {
    logger.error('Error checking SuperTrend:', error);
    return { met: false, error: error.message };
  }
}

function checkRollingSuperTrend(candles, params = {}) {
  try {
    const rollingPeriod = params.rollingPeriod || 4;

    if (candles.length < rollingPeriod + 1) {
      return { met: false, error: 'Insufficient data for Rolling SuperTrend calculation' };
    }

    const syntheticCandles = buildSyntheticCandles(candles, rollingPeriod);
    return checkSuperTrend(syntheticCandles, params);
  } catch (error) {
    logger.error('Error checking Rolling SuperTrend:', error);
    return { met: false, error: error.message };
  }
}

function checkRollingSuperTrend2(candles, params = {}) {
  try {
    const rollingPeriod = params.rollingPeriod || 16;

    if (candles.length < rollingPeriod + 1) {
      return { met: false, error: 'Insufficient data for Rolling SuperTrend2 calculation' };
    }

    const syntheticCandles = buildSyntheticCandles(candles, rollingPeriod);
    return checkSuperTrend(syntheticCandles, params);
  } catch (error) {
    logger.error('Error checking Rolling SuperTrend2:', error);
    return { met: false, error: error.message };
  }
}

function getSuperTrendSwingPrice(candles, side, params = {}) {
  try {
    const period = params.period || 10;
    const multiplier = params.multiplier || 4;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    const { direction } = _calculateSuperTrendAligned(highs, lows, closes, period, multiplier);

    const length = direction.length;
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < length; i++) {
      if (direction[i] === 0) continue;

      const type = direction[i] === -1 ? 'bullish' : 'bearish';

      if (currentSection === null) {
        currentSection = { type, startCandle: i, endCandle: i };
      } else if (type !== currentSection.type) {
        currentSection.duration = currentSection.endCandle - currentSection.startCandle + 1;
        sections.push({ ...currentSection });
        currentSection = { type, startCandle: i, endCandle: i };
      } else {
        currentSection.endCandle = i;
      }
    }

    if (currentSection !== null) {
      currentSection.duration = currentSection.endCandle - currentSection.startCandle + 1;
      sections.push({ ...currentSection });
    }

    if (sections.length < 2) {
      return { price: null, error: 'Not enough SuperTrend sections for swing detection' };
    }

    const lastSection = sections[sections.length - 1];
    const prevSection = sections[sections.length - 2];

    let swingPrice = null;
    let targetSection = null;

    if (side === 'long') {
      targetSection = lastSection.type === 'bearish'
        ? lastSection
        : prevSection.type === 'bearish' ? prevSection : null;

      if (targetSection) {
        const sectionLows = lows.slice(targetSection.startCandle, targetSection.endCandle + 1);
        swingPrice = Math.min(...sectionLows);
      }
    } else if (side === 'short') {
      targetSection = lastSection.type === 'bullish'
        ? lastSection
        : prevSection.type === 'bullish' ? prevSection : null;

      if (targetSection) {
        const sectionHighs = highs.slice(targetSection.startCandle, targetSection.endCandle + 1);
        swingPrice = Math.max(...sectionHighs);
      }
    }

    if (swingPrice === null || swingPrice <= 0) {
      return { price: null, error: 'Could not determine swing price from SuperTrend sections' };
    }

    logger.info(`SuperTrend swing price for ${side}: $${swingPrice}, sections: ${sections.length}, last type: ${lastSection.type}, target section: [${targetSection.startCandle}-${targetSection.endCandle}]`);

    return {
      price: swingPrice,
      sections: sections.length,
      sectionType: lastSection.type,
      details: {
        lastSection: lastSection,
        prevSection: prevSection,
        targetSection: targetSection
      }
    };
  } catch (error) {
    logger.error('Error getting SuperTrend swing price:', error);
    return { price: null, error: error.message };
  }
}

function getRollingSuperTrendSwingPrice(candles, side, params = {}) {
  try {
    const rollingPeriod = params.rollingPeriod || 4;
    const syntheticCandles = buildSyntheticCandles(candles, rollingPeriod);
    return getSuperTrendSwingPrice(syntheticCandles, side, params);
  } catch (error) {
    logger.error('Error getting rolling SuperTrend swing price:', error);
    return { price: null, error: error.message };
  }
}

function getRollingSuperTrend2SwingPrice(candles, side, params = {}) {
  try {
    const rollingPeriod = params.rollingPeriod || 16;
    const syntheticCandles = buildSyntheticCandles(candles, rollingPeriod);
    return getSuperTrendSwingPrice(syntheticCandles, side, params);
  } catch (error) {
    logger.error('Error getting rolling SuperTrend2 swing price:', error);
    return { price: null, error: error.message };
  }
}

function getSuperTrendLineValue(candles, side, entryPrice, params = {}) {
  try {
    const period = params.period || 10;
    const multiplier = params.multiplier || 3;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    const { superTrend } = _calculateSuperTrendAligned(highs, lows, closes, period, multiplier);
    const nonNull = superTrend.filter(val => val !== null);
    if (nonNull.length === 0) {
      return { price: null, error: 'Insufficient data for SuperTrend line calculation' };
    }

    const lineValue = nonNull[nonNull.length - 1];

    if (side === 'long' && lineValue >= entryPrice) {
      return { price: null, error: 'SuperTrend line is not below entry price' };
    }
    if (side === 'short' && lineValue <= entryPrice) {
      return { price: null, error: 'SuperTrend line is not above entry price' };
    }

    logger.info(`SuperTrend line value for ${side}: $${lineValue} (entry: $${entryPrice})`);

    return { price: lineValue, lineValue, lastClose: entryPrice };
  } catch (error) {
    logger.error('Error getting SuperTrend line value:', error);
    return { price: null, error: error.message };
  }
}

function getRollingSuperTrendLineValue(candles, side, entryPrice, params = {}) {
  try {
    const rollingPeriod = params.rollingPeriod || 4;

    if (candles.length < rollingPeriod + 1) {
      return { price: null, error: 'Insufficient data for Rolling SuperTrend line calculation' };
    }

    const syntheticCandles = buildSyntheticCandles(candles, rollingPeriod);
    return getSuperTrendLineValue(syntheticCandles, side, entryPrice, params);
  } catch (error) {
    logger.error('Error getting Rolling SuperTrend line value:', error);
    return { price: null, error: error.message };
  }
}

module.exports = {
  checkSuperTrend,
  checkRollingSuperTrend,
  checkRollingSuperTrend2,
  getSuperTrendSwingPrice,
  getRollingSuperTrendSwingPrice,
  getRollingSuperTrend2SwingPrice,
  getSuperTrendLineValue,
  getRollingSuperTrendLineValue,
};