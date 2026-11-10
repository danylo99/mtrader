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
      symbol = 'unknown',
      timeframe = 'unknown',
      source = 'screener',
      barsPerHour = 4,
      barsPerHour2 = 16,
      macroAtrLen = 10,
      macroMult = 3.0,
      localAtrLen = 10,
      localMult = 3.0,
      zscoreLength = 500,
      zscoreMin = 1.8,
      zscoreMax = 10.0,
      useWickFilter = true,
      maxWickRatio = 0.3,
      maxLegsAllowed = 5,
      useExtFilter = true,
      extMultiplier = 1.27,
      fastBreakMode = 'Continuous Entries',
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

    // ── Step D: Leg Tracking + Fast Break Signal ─────────────────────────
    const legRefs = [];
    let prevExtremePrice = null, curExtremePrice = null;
    let prevLocalDir = 0, localDir = 0, localStLine = null;
    let activeLineX1 = null;
    let activeIsBull = true;

    // ── Fast Break tracking ──
    let targetLevelToBreak = null;
    let targetPeakValleyBar = null;
    let prevLegFormingTime = null;
    let breakDoneInLocalLeg = false;
    let breakDetectedBar = null;
    let breakDetectedTime = null;
    let breakDetectedTimestamp = null;
    let hasSignaledCurrentSynthDir = false;
    let curExtremeBar = null;
    let prevExtremeBar = null;
    let fastBreakBullTrigger = false;
    let fastBreakBearTrigger = false;

    for (let i = 0; i < length; i++) {
      const h = highs[i], l = lows[i], c = closes[i];

      // ── HTF change: reset signaled flag only ──
      if (htfChangedArr[i]) {
        hasSignaledCurrentSynthDir = false;
      }

      // ── Local ST Leg Tracking ──
      if (localDirArr[i] !== null && localDirArr[i] !== 0) {
        const isBull = localDirArr[i] === -1;

        if (curExtremePrice === null) {
          curExtremePrice = isBull ? h : l;
          curExtremeBar = i;
        }

        if (prevLocalDir !== 0 && localDirArr[i] !== prevLocalDir) {
          // ── Fast Break target setup (using OLD extreme values before overwrite) ──
          if (curExtremeBar !== null && prevExtremeBar !== null) {
            targetLevelToBreak = prevExtremePrice;
            targetPeakValleyBar = curExtremeBar;
            prevLegFormingTime = Math.max(1, curExtremeBar - prevExtremeBar);
          }
          breakDoneInLocalLeg = false;  // Reset break tracking for the new local ST leg
          breakDetectedBar = null;
          breakDetectedTime = null;
          breakDetectedTimestamp = null;
          hasSignaledCurrentSynthDir = false;  // Reset signaled flag for new leg — one signal per leg per synth dir

          legRefs.push({
            x1: activeLineX1,
            x2: i,
            y1: prevExtremePrice,
            y2: curExtremePrice,
            isBull: activeIsBull
          });

          prevExtremeBar = curExtremeBar;
          prevExtremePrice = curExtremePrice;
          curExtremePrice = isBull ? h : l;
          curExtremeBar = i;
          activeIsBull = isBull;
          activeLineX1 = i;
        } else {
          if (isBull && (curExtremePrice === null || h >= curExtremePrice)) {
            curExtremePrice = h;
            curExtremeBar = i;
          } else if (!isBull && (curExtremePrice === null || l <= curExtremePrice)) {
            curExtremePrice = l;
            curExtremeBar = i;
          }
        }

        if (i === length - 1) {
          localDir = localDirArr[i];
          localStLine = localSTArr[i];
        }

        // ── Fast Break Check (matches Pine) ──
        const isLocalBullishAtI = localDirArr[i] === -1;
        const isSynthBullishAtI = synthDirArr[i] === -1;
        const fastModeContinuous = fastBreakMode === 'Continuous Entries';
        const allowSynthSignal = fastModeContinuous || !hasSignaledCurrentSynthDir;
        let fastBreakBullBar = false;
        let fastBreakBearBar = false;

        if (allowSynthSignal && !breakDoneInLocalLeg && targetLevelToBreak !== null && prevLegFormingTime !== null && targetPeakValleyBar !== null) {
          const breakTime = i - targetPeakValleyBar;

          if (isLocalBullishAtI) {
            const currentBarBreak = h > targetLevelToBreak && breakTime < prevLegFormingTime;
            if (currentBarBreak) {
              breakDoneInLocalLeg = true;  // Lock leg to prevent future triggers in this local leg section
              if (breakDetectedBar === null) {
                breakDetectedBar = i;
                breakDetectedTime = breakTime;
                breakDetectedTimestamp = candles[i].timestamp ? new Date(candles[i].timestamp).toUTCString() : null;
              }
              if (isSynthBullishAtI) {
                fastBreakBullBar = true;
                hasSignaledCurrentSynthDir = true;
              }
            }
          } else if (!isLocalBullishAtI) {
            const currentBarBreak = l < targetLevelToBreak && breakTime < prevLegFormingTime;
            if (currentBarBreak) {
              breakDoneInLocalLeg = true;
              if (breakDetectedBar === null) {
                breakDetectedBar = i;
                breakDetectedTime = breakTime;
                breakDetectedTimestamp = candles[i].timestamp ? new Date(candles[i].timestamp).toUTCString() : null;
              }
              if (!isSynthBullishAtI) {
                fastBreakBearBar = true;
                hasSignaledCurrentSynthDir = true;
              }
            }
          }
        }

        // Deferred Signal: break occurred earlier in this local leg, synth direction matched later
        if (allowSynthSignal && breakDoneInLocalLeg && !hasSignaledCurrentSynthDir) {
          if (isLocalBullishAtI && isSynthBullishAtI) {
            fastBreakBullBar = true;
            hasSignaledCurrentSynthDir = true;
          } else if (!isLocalBullishAtI && !isSynthBullishAtI) {
            fastBreakBearBar = true;
            hasSignaledCurrentSynthDir = true;
          }
        }

        if (i === length - 1) {
          fastBreakBullTrigger = fastBreakBullBar;
          fastBreakBearTrigger = fastBreakBearBar;
        }

        prevLocalDir = localDirArr[i];
      }
    }

    // ── Post-loop: Signal Generation (last bar only) ──────────────────
    const lastIdx = length - 1;
    const lastSynthStLine = synthStLineArr[lastIdx] !== null ? synthStLineArr[lastIdx] : lastStLine;

    let signal = 'none';
    let met = false;
    let sl_price = null;

    if (fastBreakBullTrigger) {
      met = true;
      signal = 'fast_break_bullish';
      sl_price = prevExtremePrice !== null ? Math.max(prevExtremePrice, lastSynthStLine) : lastSynthStLine;
    } else if (fastBreakBearTrigger) {
      met = true;
      signal = 'fast_break_bearish';
      sl_price = prevExtremePrice !== null ? Math.min(prevExtremePrice, lastSynthStLine) : lastSynthStLine;
    }

    const debugSymbols = ['BNB/USDT:USDT', 'BTC/USDT:USDT'];
    const isDebugSymbol = debugSymbols.includes(symbol);

    const result = {
      met,
      signal,
      price: closes[lastIdx],
      sl_price,
      details: {
        synthDir: synthDirArr[lastIdx],
        localDir,
        prevExtremePrice,
        fastBreakBullTrigger,
        fastBreakBearTrigger,
        targetLevelToBreak,
        lastSynthStLine,
        breakStatus: breakDoneInLocalLeg ? 'broke' : 'not_broke',
        breakDetectedTime,
        formingBars: prevLegFormingTime,
        breakTiming: breakDetectedTime !== null && prevLegFormingTime !== null
          ? (breakDetectedTime < prevLegFormingTime ? 'fast' : 'slow')
          : 'n/a',
        alignStatus: synthDirArr[lastIdx] === localDir ? 'aligned' : 'not_aligned',
        signalStatus: met ? 'triggered' : 'none',
        signalAlreadySignaled: hasSignaledCurrentSynthDir ? 'yes' : 'no',
      }
    };

    if (source === 'entry') {
      const currentPrice = closes[lastIdx];
      const d = result.details;
      const vsTarget = targetLevelToBreak !== null
        ? (currentPrice > targetLevelToBreak ? 'above' : currentPrice < targetLevelToBreak ? 'below' : 'equal')
        : 'n/a';
      const slPriceStr = sl_price !== null ? sl_price : 'null';
      const prevExtStr = prevExtremePrice !== null ? prevExtremePrice : 'null';
      const msg = `symbol=${symbol} tf=${timeframe} currentPrice=${currentPrice} targetLevelToBreak=${targetLevelToBreak} priceVsTarget=${vsTarget} synthDir=${d.synthDir} localDir=${d.localDir} breakStatus=${d.breakStatus} breakTiming=${d.breakTiming} alignStatus=${d.alignStatus} signalStatus=${d.signalStatus} sl_price=${slPriceStr} prevExtremePrice=${prevExtStr}`;
      if (met) {
        logger.info(`EWT FAST BREAK (ENTRY): ${msg}`);
        console.log(`EWT FAST BREAK (ENTRY): ${msg}`);
      } else {
        logger.info(`EWT CHECK (ENTRY): ${msg}`);
        console.log(`EWT CHECK (ENTRY): ${msg}`);
      }
    }

    if (isDebugSymbol) {
      const currentPrice = closes[lastIdx];
      const currentHigh = highs[lastIdx];
      const currentLow = lows[lastIdx];
      const d = result.details;
      const vsTarget = targetLevelToBreak !== null
        ? (currentPrice > targetLevelToBreak ? 'above' : currentPrice < targetLevelToBreak ? 'below' : 'equal')
        : 'n/a';
      const msg = `symbol=${symbol} tf=${timeframe} breakTs=${breakDetectedTimestamp} currentPrice=${currentPrice} currentHigh=${currentHigh} currentLow=${currentLow} targetLevelToBreak=${targetLevelToBreak} priceVsTarget=${vsTarget} synthDir=${d.synthDir} localDir=${d.localDir} breakStatus=${d.breakStatus} breakDetectedTime=${d.breakDetectedTime} formingBars=${d.formingBars} breakTiming=${d.breakTiming} alignStatus=${d.alignStatus} signalStatus=${d.signalStatus} signalAlreadySignaled=${d.signalAlreadySignaled}`;
      console.log(`EWT DEBUG: ${msg}`);
      logger.info(`EWT DEBUG: ${msg}`);
    }

    return result;

  } catch (error) {
    logger.error('Error checking EWT:', error);
    return { met: false, error: error.message };
  }
}

module.exports = { checkEWT };
