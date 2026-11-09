// change-core.js —— 汇率找零核心逻辑（浏览器与 node 通用）
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ChangeCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 币种元信息：frac = 显示小数位
  const CURRENCY_META = {
    USD: { symbol: "$", name: "美元", frac: 2 },
    EUR: { symbol: "€", name: "欧元", frac: 2 },
    GBP: { symbol: "£", name: "英镑", frac: 2 },
    JPY: { symbol: "¥", name: "日元", frac: 0 },
    CNY: { symbol: "¥", name: "人民币", frac: 2 },
    HKD: { symbol: "HK$", name: "港币", frac: 2 },
    SGD: { symbol: "S$", name: "新加坡元", frac: 2 },
    AUD: { symbol: "A$", name: "澳元", frac: 2 },
    CAD: { symbol: "C$", name: "加元", frac: 2 },
    CHF: { symbol: "CHF", name: "瑞士法郎", frac: 2 },
    KRW: { symbol: "₩", name: "韩元", frac: 0 },
    THB: { symbol: "฿", name: "泰铢", frac: 2 },
    MYR: { symbol: "RM", name: "马来西亚令吉", frac: 2 },
    INR: { symbol: "₹", name: "印度卢比", frac: 2 },
    KHR: { symbol: "៛", name: "柬币·瑞尔", frac: 0 },
    VND: { symbol: "₫", name: "越南盾", frac: 0 },
  };

  // 面额（含纸币与硬币，单位=该币种本位）
  const DENOMINATIONS = {
    USD: [100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.01],
    EUR: [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
    GBP: [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
    JPY: [10000, 5000, 2000, 1000, 500, 100, 50, 10, 5, 1],
    CNY: [100, 50, 20, 10, 5, 1, 0.5, 0.1],
    HKD: [1000, 500, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
    SGD: [10000, 1000, 100, 50, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05],
    AUD: [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05],
    CAD: [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05],
    CHF: [1000, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05],
    KRW: [50000, 10000, 5000, 1000, 500, 100, 50, 10],
    THB: [1000, 500, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25],
    MYR: [100, 50, 20, 10, 5, 1, 0.5, 0.2, 0.1, 0.05],
    INR: [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
    KHR: [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 100],
    VND: [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200],
  };

  const EPS = 1e-9;

  function roundTo(n, digits) {
    const f = Math.pow(10, digits);
    return Math.round((n + Number.EPSILON) * f) / f;
  }

  // 汇率：1 单位该币种 = rates[currency] 单位基准币（基准币默认 USD，rates[base]=1）
  function toBase(amount, currency, rates) {
    return amount * rates[currency];
  }
  function fromBase(amount, currency, rates) {
    return amount / rates[currency];
  }

  // 计算找零（基准币数值）。payments: [{currency, amount}]
  function computeChange(price, priceCurrency, payments, rates) {
    const priceBase = toBase(price, priceCurrency, rates);
    let paidBase = 0;
    for (const p of payments) {
      paidBase += toBase(p.amount, p.currency, rates);
    }
    const changeBase = paidBase - priceBase;
    return {
      priceBase: roundTo(priceBase, 2),
      paidBase: roundTo(paidBase, 2),
      changeBase: roundTo(changeBase, 2),
      shortfallBase: roundTo(Math.max(0, -changeBase), 2),
    };
  }

  // 拆分找零：locked = [{currency, amount}] 手动锁定的金额（各币种本位）。
  // enabled = ["USD","KHR",...] 允许用来找零的币种（顺序即优先级）。
  // 返回 { lockedBase, remainingBase }
  function splitChange(changeBase, locked, rates) {
    let lockedBase = 0;
    for (const l of locked) {
      lockedBase += toBase(l.amount, l.currency, rates);
    }
    lockedBase = roundTo(lockedBase, 2);
    const remainingBase = roundTo(changeBase - lockedBase, 2);
    return { lockedBase, remainingBase };
  }

  // 最优找零：跨币种贪心，返回 [{currency, denom, count}]
  // 目标是在 enabled 币种的面额里，用尽量少的张数凑出 changeBase（基准币），并尽可能避开硬币。
  function optimalChange(changeBase, enabled, rates, denominations) {
    let remaining = changeBase;
    // 所有面额转成基准币值，排序降序
    const pool = [];
    for (const c of enabled) {
      const r = rates[c];
      for (const d of denominations[c]) {
        pool.push({ currency: c, denom: d, ref: d * r });
      }
    }
    // 排序：优先纸币（denom>=1）再硬币，同类型里按基准值降序。
    // 这样"消硬币"时，会优先用另一币种能整张覆盖的纸币去替代本币种的小硬币。
    pool.sort((a, b) => {
      const an = a.denom >= 1 ? 1 : 0;
      const bn = b.denom >= 1 ? 1 : 0;
      if (an !== bn) return bn - an;
      return b.ref - a.ref;
    });

    const pieces = [];
    for (const p of pool) {
      if (remaining < p.ref - EPS) continue;
      const count = Math.floor((remaining + EPS) / p.ref);
      if (count > 0) {
        pieces.push({ currency: p.currency, denom: p.denom, count });
        remaining = roundTo(remaining - count * p.ref, 6);
      }
      if (remaining < EPS) break;
    }
    return {
      pieces,
      leftoverBase: roundTo(Math.max(0, remaining), 6),
    };
  }

  return {
    CURRENCY_META,
    DENOMINATIONS,
    roundTo,
    toBase,
    fromBase,
    computeChange,
    splitChange,
    optimalChange,
  };
});
