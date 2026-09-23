const logger = require('../../logger');
const {
  _calculateSMA,
  _calculateStdDev,
  _calculateSuperTrendAligned,
  calculateRMA,
} = require('./helpers');

function checkEWT(candles, params = {}) {
  try {
    const {
      barsPerHour = 4,
      barsPerHour2 = 16,
      macroAtrLen = 10,
      macroMult = 3.0,
      localAtrLen = 10,
      localMult = 3.0,
      zscoreLength = 500,
      zscoreMin = 1.8,
      zscoreMax = 15.0,
      useWickFilter = true,
      maxWickRatio = 0.3,
      maxLegsAllowed = 5,
      useExtFilter = true,
      extMultiplier = 1.27,
      tradeMode = 'First Change Only',
    } = params;

    const minRequired = Math.max(zscoreLength, barsPerHour + macroAtrLen, localAtrLen + 2);
    if (candles.length < minRequired) {
      return { met: false, error: `Insufficient data for EWT calculation, need ${minRequired} bars` };
    }

    const length = candles.length;
    const opens = candles.map(c => c.open);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    // ── Step A: Z-Score & Wick Filter ────────────────────────────────────
    const absReturns = new Array(length);
    for (let i = 0; i < length; i++) {
      absReturns[i] = Math.abs(closes[i] - opens[i]);
    }

    const meanReturn = _calculateSMA(absReturns, zscoreLength);
    const stdReturn = _calculateStdDev(absReturns, zscoreLength, meanReturn);

    const isHighReturnBars = new Array(length).fill(false);
    for (let i = 0; i < length; i++) {
      let zScore = 0;
      if (meanReturn[i] !== null && stdReturn[i] !== null && stdReturn[i] !== 0) {
        zScore = (absReturns[i] - meanReturn[i]) / stdReturn[i];
      }
      const isZScoreHigh = zScore >= zscoreMin && zScore < zscoreMax;
      const barBody = Math.abs(closes[i] - opens[i]);
      const directionalWick = closes[i] >= opens[i] ? (highs[i] - closes[i]) : (opens[i] - lows[i]);
      const wickRatio = barBody > 0 ? directionalWick / barBody : 0;
      const passWickFilter = !useWickFilter || wickRatio < maxWickRatio;
      isHighReturnBars[i] = isZScoreHigh && passWickFilter;
    }

    // ── Step B: Synthetic Macro SuperTrend (HTF) ─────────────────────────
    const rollingHighs = new Array(length).fill(null);
    const rollingLows = new Array(length).fill(null);
    const prevRollingCloses = new Array(length).fill(null);

    for (let i = barsPerHour - 1; i < length; i++) {
      let maxH = -Infinity, minL = Infinity;
      const start = i - barsPerHour + 1;
      for (let j = start; j <= i; j++) {
        if (highs[j] > maxH) maxH = highs[j];
        if (lows[j] < minL) minL = lows[j];
      }
      rollingHighs[i] = maxH;
      rollingLows[i] = minL;
      if (i >= barsPerHour) {
        prevRollingCloses[i] = closes[i - barsPerHour];
      }
    }

    const syntheticTR = new Array(length).fill(null);
    for (let i = barsPerHour - 1; i < length; i++) {
      if (prevRollingCloses[i] !== null) {
        syntheticTR[i] = Math.max(
          rollingHighs[i] - rollingLows[i],
          Math.abs(rollingHighs[i] - prevRollingCloses[i]),
          Math.abs(rollingLows[i] - prevRollingCloses[i])
        );
      }
    }

    const syntheticATR = calculateRMA(syntheticTR, macroAtrLen);

    const synthDirArr = new Array(length).fill(0);
    const synthStLineArr = new Array(length).fill(null);
    const htfChangedArr = new Array(length).fill(false);
    let lastStLine = null;

    for (let i = 0; i < length; i++) {
      if (syntheticATR[i] === null || rollingHighs[i] === null) continue;

      const hl2 = (rollingHighs[i] + rollingLows[i]) / 2;
      const rawLower = hl2 - macroMult * syntheticATR[i];
      const rawUpper = hl2 + macroMult * syntheticATR[i];

      let finalLower = rawLower;
      let finalUpper = rawUpper;

      const prevStLine = i > 0 ? synthStLineArr[i - 1] : null;
      if (prevStLine !== null) {
        if (i > 0 && closes[i - 1] > prevStLine) {
          finalLower = Math.max(rawLower, prevStLine);
        }
        if (i > 0 && closes[i - 1] < prevStLine) {
          finalUpper = Math.min(rawUpper, prevStLine);
        }
      }

      let dir = 0;
      const prevDir = i > 0 && synthDirArr[i - 1] !== 0 ? synthDirArr[i - 1] : 1;
      if (prevDir === 1 && closes[i] > finalUpper) {
        dir = -1;
      } else if (prevDir === -1 && closes[i] < finalLower) {
        dir = 1;
      } else {
        dir = prevDir;
      }

      const stVal = dir === -1 ? finalLower : finalUpper;

      synthDirArr[i] = dir;
      synthStLineArr[i] = stVal;

      if (i > 0 && synthDirArr[i - 1] !== 0 && dir !== synthDirArr[i - 1]) {
        htfChangedArr[i] = true;
      }

      lastStLine = stVal;
    }

    // ── Step C: Local SuperTrend ─────────────────────────────────────────
    const { superTrend: localSTArr, direction: localDirArr } =
      _calculateSuperTrendAligned(highs, lows, closes, localAtrLen, localMult);

    // ── Step D: Leg Tracking + Signal Generation ─────────────────────────
    const legRefs = [];
    let prevExtremePrice = null, curExtremePrice = null;
    let prevLocalDir = 0, localDir = 0, localStLine = null;
    let activeLineX1 = null;
    let activeIsBull = true;

    let first_leg_ext_target = null;
    let targetHtfStartBar = null;
    let htfLongTaken = false, htfShortTaken = false;

    for (let i = 0; i < length; i++) {
      const h = highs[i], l = lows[i], c = closes[i];

      // ── HTF change: reset flags, compute extension target ──
      if (htfChangedArr[i]) {
        htfLongTaken = false;
        htfShortTaken = false;
        first_leg_ext_target = null;
        targetHtfStartBar = i;

        const extRatio = extMultiplier - 1.0;
        const newSynthBullish = synthDirArr[i] === -1;
        let foundLeg = false;
        for (let li = 0; li < legRefs.length && !foundLeg; li++) {
          const leg = legRefs[li];
          if (leg.x1 >= targetHtfStartBar) {
            const legLen = Math.abs(leg.y2 - leg.y1);
            if (newSynthBullish) {
              first_leg_ext_target = Math.max(leg.y1, leg.y2) + (legLen * extRatio);
            } else {
              first_leg_ext_target = Math.min(leg.y1, leg.y2) - (legLen * extRatio);
            }
            foundLeg = true;
          }
        }
        if (!foundLeg && activeLineX1 !== null && activeLineX1 >= targetHtfStartBar) {
          if (prevExtremePrice !== null && curExtremePrice !== null) {
            const legLen = Math.abs(curExtremePrice - prevExtremePrice);
            if (newSynthBullish) {
              first_leg_ext_target = Math.max(prevExtremePrice, curExtremePrice) + (legLen * extRatio);
            } else {
              first_leg_ext_target = Math.min(prevExtremePrice, curExtremePrice) - (legLen * extRatio);
            }
          }
        }
      }

      // ── Local ST Leg Tracking ──
      if (localDirArr[i] !== null && localDirArr[i] !== 0) {
        const isBull = localDirArr[i] === -1;

        if (curExtremePrice === null) {
          curExtremePrice = isBull ? h : l;
        }

        if (prevLocalDir !== 0 && localDirArr[i] !== prevLocalDir) {
          legRefs.push({
            x1: activeLineX1,
            x2: i,
            y1: prevExtremePrice,
            y2: curExtremePrice,
            isBull: activeIsBull
          });

          prevExtremePrice = curExtremePrice;
          curExtremePrice = isBull ? h : l;
          activeIsBull = isBull;
          activeLineX1 = i;
        } else {
          if (isBull && (curExtremePrice === null || h >= curExtremePrice)) {
            curExtremePrice = h;
          } else if (!isBull && (curExtremePrice === null || l <= curExtremePrice)) {
            curExtremePrice = l;
          }
        }

        if (i === length - 1) {
          localDir = localDirArr[i];
          localStLine = localSTArr[i];
        }

        prevLocalDir = localDirArr[i];
      }
    }

    // ── Post-loop: Signal Generation (last bar only) ──────────────────
    const lastIdx = length - 1;
    const isSynthBullish = synthDirArr[lastIdx] === -1;
    const isSynthBearish = synthDirArr[lastIdx] === 1;
    const isLocalBullish = localDir === -1;
    const isLocalBearish = localDir === 1;
    const lastSynthStLine = synthStLineArr[lastIdx] !== null ? synthStLineArr[lastIdx] : lastStLine;
    const htfChanged = htfChangedArr[lastIdx];

    let localDirChanged = false;
    if (lastIdx >= 1) {
      const lastDir = localDirArr[lastIdx];
      const prevDir = localDirArr[lastIdx - 1];
      if (lastDir !== null && lastDir !== 0 && prevDir !== null && prevDir !== 0) {
        localDirChanged = lastDir !== prevDir;
      }
    }

    const currentHtfLegCount = (() => {
      let count = 1;
      if (targetHtfStartBar !== null) {
        for (let li = legRefs.length - 1; li >= 0; li--) {
          const leg = legRefs[li];
          if (leg.x1 >= targetHtfStartBar) {
            count += 1;
          } else {
            break;
          }
        }
      }
      return count;
    })();

    const passLegCountFilter = currentHtfLegCount <= maxLegsAllowed;

    let passExtFilter = true;
    if (useExtFilter && first_leg_ext_target !== null) {
      if (isSynthBullish) {
        passExtFilter = opens[lastIdx] <= first_leg_ext_target;
      } else {
        passExtFilter = opens[lastIdx] >= first_leg_ext_target;
      }
    }

    const signalsAllowed = passLegCountFilter && passExtFilter;
    const longAllowed = tradeMode === 'Continuous Entries' || !htfLongTaken;
    const shortAllowed = tradeMode === 'Continuous Entries' || !htfShortTaken;
    const isHighReturnBar = isHighReturnBars[lastIdx];

    const m15BullSignal = localDirChanged && isLocalBullish;
    const m15BearSignal = localDirChanged && isLocalBearish;
    const synthBullSignal = htfChanged && isSynthBullish;
    const synthBearSignal = htfChanged && isSynthBearish;
    const usePrimarySignal = false;
    const entryLongPrimary = usePrimarySignal && m15BullSignal && isSynthBullish && isHighReturnBar && longAllowed && signalsAllowed;
    const entryShortPrimary =usePrimarySignal && m15BearSignal && isSynthBearish && isHighReturnBar && shortAllowed && signalsAllowed;

    const entryLongAdditional = synthBullSignal && isHighReturnBar && signalsAllowed;
    const entryShortAdditional = synthBearSignal && isHighReturnBar && signalsAllowed;

    const finalEntryLong = entryLongPrimary || entryLongAdditional;
    const finalEntryShort = entryShortPrimary || entryShortAdditional;

    if (finalEntryLong) htfLongTaken = true;
    if (finalEntryShort) htfShortTaken = true;

    let signal = 'none';
    let met = false;
    let sl_price = null;

    if (finalEntryLong) {
      met = true;
      signal = 'bullish_crossover';
      sl_price = prevExtremePrice !== null ? prevExtremePrice : lastSynthStLine;
    } else if (finalEntryShort) {
      met = true;
      signal = 'bearish_crossover';
      sl_price = prevExtremePrice !== null ? prevExtremePrice : lastSynthStLine;
    }

    const result = {
      met,
      signal,
      price: closes[lastIdx],
      sl_price,
      details: {
        zScore: meanReturn[lastIdx] !== null && stdReturn[lastIdx] !== null
          ? (absReturns[lastIdx] - meanReturn[lastIdx]) / stdReturn[lastIdx] : 0,
        isHighReturnBar,
        synthDir: synthDirArr[lastIdx],
        localDir,
        htfChanged,
        localDirChanged,
        isSynthBullish,
        isLocalBullish,
        primaryLong: entryLongPrimary,
        primaryShort: entryShortPrimary,
        additionalLong: entryLongAdditional,
        additionalShort: entryShortAdditional,
        prevExtremePrice,
        passLegCountFilter,
        passExtFilter,
        currentHtfLegCount,
        first_leg_ext_target,
      }
    };

    return result;

  } catch (error) {
    logger.error('Error checking EWT:', error);
    return { met: false, error: error.message };
  }
}

function getEWTSwingPrice(candles, side, params = {}) {
  try {
    const localAtrLen = params.localAtrLen || 10;
    const localMult = params.localMult || 3.0;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    const { direction } = _calculateSuperTrendAligned(highs, lows, closes, localAtrLen, localMult);

    const length = direction.length;
    const sections = [];
    let currentSection = null;

    for (let i = 0; i < length; i++) {
      if (direction[i] === null || direction[i] === 0) continue;
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
      return { price: null, error: 'Not enough EWT sections for swing detection' };
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
      return { price: null, error: 'Could not determine swing price from EWT sections' };
    }

    logger.info(`EWT swing price for ${side}: $${swingPrice}`);
    return {
      price: swingPrice,
      sections: sections.length,
      sectionType: lastSection.type,
      details: {
        lastSection,
        prevSection,
        targetSection,
      }
    };
  } catch (error) {
    logger.error('Error getting EWT swing price:', error);
    return { price: null, error: error.message };
  }
}

module.exports = { checkEWT, getEWTSwingPrice };