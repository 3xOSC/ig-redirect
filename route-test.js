// Прогон router.js под набором UA. Сценарий: "ничего не срабатывает"
// (gone() всегда false) — так видна ВСЯ цепочка попыток, а не только первая.
const fs = require("fs");
const vm = require("vm");

const SRC = fs.readFileSync("/Users/igor/Desktop/code/ig-redirect/router.js", "utf8");

const UAS = {
  "Instagram iOS":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.0.36.95 (iPhone14,3; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 123)",
  "Instagram Android":
    "Mozilla/5.0 (Linux; Android 13; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 334.0.0.36.95 Android",
  "Facebook feed iOS":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.35.108]",
  "TikTok iOS":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_32.5.0 JsSdk/2.0 BytedanceWebview/d8a21c6",
  "FB iOS 26 (без метки в UA)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  "Safari iOS (настоящий)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Chrome Android (настоящий)":
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

function run(ua, search, defaults, realSafari) {
  const hops = [];
  const timers = [];
  const els = {};
  const mkEl = () => ({ className: "", textContent: "", href: "", style: {} });
  ["fallback", "fallback-link", "tip", "debug", "debug-log"].forEach(id => els[id] = mkEl());

  const nav = { userAgent: ua, maxTouchPoints: 0 };
  // В настоящем Safari navigator.standalone определён; в WKWebView приложения — нет.
  if (realSafari) nav.standalone = false;

  const win = {
    LINK_DEFAULTS: defaults,
    location: { search, replace: (u) => hops.push(u) },
    navigator: nav,
    URLSearchParams,
    document: {
      hidden: false,
      visibilityState: "visible",
      hasFocus: () => true,
      getElementById: (id) => els[id] || null,
    },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    console,
  };
  win.window = win;

  const ctx = vm.createContext(win);
  vm.runInContext(SRC, ctx);

  // Разворачиваем таймеры по возрастанию задержки (вложенные — тоже).
  let guard = 0;
  while (timers.length && guard++ < 50) {
    timers.sort((a, b) => a.ms - b.ms);
    timers.shift().fn();
  }

  return { hops, fallbackShown: els.fallback.className === "show", tip: els.tip.className === "show" };
}

const DEFAULTS = {
  ios: "https://app.appsflyer.com/id6457366208",
  android: "https://app.appsflyer.com/id6457366208",
  deep: null,
};

console.log("=== A. Цель = OneLink AppsFlyer (текущий конфиг) ===\n");
for (const [name, ua] of Object.entries(UAS)) {
  const realSafari = name.includes("настоящий");
  const r = run(ua, "", DEFAULTS, realSafari);
  console.log(name);
  r.hops.forEach((h, i) => console.log("   " + (i + 1) + ". " + h));
  console.log("   кнопка-фолбэк: " + r.fallbackShown + (r.tip ? " (+ подсказка)" : ""));
  console.log();
}

console.log("=== B. Цель = прямая ссылка на App Store ===\n");
const DIRECT = { ios: "https://apps.apple.com/app/id6457366208", android: "https://play.google.com/store/apps/details?id=com.x", deep: null };
for (const name of ["Instagram iOS", "Facebook feed iOS", "Instagram Android"]) {
  const r = run(UAS[name], "", DIRECT, false);
  console.log(name);
  r.hops.forEach((h, i) => console.log("   " + (i + 1) + ". " + h));
  console.log("   кнопка-фолбэк: " + r.fallbackShown + (r.tip ? " (+ подсказка)" : ""));
  console.log();
}

console.log("=== C. Защита от чужого хоста (?u=злой сайт) ===\n");
const r = run(UAS["Instagram iOS"], "?u=" + encodeURIComponent("https://evil.example.com/phish"), { ios: null, android: null }, false);
console.log("   переходов: " + JSON.stringify(r.hops) + ", заглушка: " + r.fallbackShown);
