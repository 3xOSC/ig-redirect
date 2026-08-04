// Прогон router.js под набором UA без устройства.
// Фиксирует: скрытые попытки (iframe), полный уход со страницы, видимость кнопки.
// Отдельно пинит регрессию, из-за которой был белый лист в Instagram.
const fs = require("fs");
const vm = require("vm");

const PATH = "/Users/igor/Desktop/code/ig-redirect/router.js";
const SRC = fs.readFileSync(PATH, "utf8");

const UAS = {
  // Реальный UA с устройства пользователя: iOS 26.5.2, Instagram 440, метка IABMV
  "Instagram iOS 26 (реальный)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F84 Instagram 440.0.0.30.81 (iPhone17,1; iOS 26_5_2; en_US; en; scale=3.00; 1206x2622; IABMV/1; 1025609183) NW/3 Safari/604.1",
  "Instagram Android":
    "Mozilla/5.0 (Linux; Android 13; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 334.0.0.36.95 Android",
  "Facebook feed iOS":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.35.108]",
  "TikTok iOS":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_32.5.0 BytedanceWebview/d8a21c6",
  "Safari iOS (настоящий)":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Chrome Android (настоящий)":
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
};

function run(src, ua, search, defaults, opts) {
  opts = opts || {};
  const hidden = [];   // попытки через скрытый iframe
  const navs = [];     // полный уход со страницы
  const timers = [];
  const els = {};
  const mk = () => ({ className: "", textContent: "", href: "", style: {},
                      addEventListener() {} });
  ["fallback", "fallback-link", "tip", "debug", "debug-log"].forEach(id => els[id] = mk());

  const nav = { userAgent: ua, maxTouchPoints: 0 };
  if (opts.realSafari) nav.standalone = false;

  const loc = { search, replace: (v) => navs.push(v) };
  Object.defineProperty(loc, "href", { set: (v) => navs.push(v), get: () => "" });

  const win = {
    LINK_DEFAULTS: defaults,
    location: loc,
    navigator: nav,
    URLSearchParams,
    document: {
      // Суть регрессии: в Instagram WebView страница ВИДИМА, но БЕЗ фокуса.
      hidden: false,
      visibilityState: "visible",
      hasFocus: () => (opts.hasFocus === undefined ? false : opts.hasFocus),
      getElementById: (id) => els[id] || null,
      createElement: () => {
        const el = { style: {}, parentNode: null };
        Object.defineProperty(el, "src", { set: (v) => hidden.push(v), get: () => "" });
        return el;
      },
      body: { appendChild() {} },
    },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    console,
  };
  win.window = win;

  vm.runInContext(src, vm.createContext(win));

  let guard = 0;
  while (timers.length && guard++ < 50) {
    timers.sort((a, b) => a.ms - b.ms);
    timers.shift().fn();
  }

  return { hidden, navs, buttonVisible: els.fallback.className !== "hidden" };
}

const ONELINK = {
  ios: "https://app.appsflyer.com/id6457366208",
  android: "https://app.appsflyer.com/id6457366208",
  deep: null,
};
const DIRECT = {
  ios: "https://apps.apple.com/app/id6457366208",
  android: "https://play.google.com/store/apps/details?id=com.x",
  deep: null,
};

function report(title, ua, cfg, opts) {
  const r = run(SRC, ua, "", cfg, opts);
  console.log(title);
  r.hidden.forEach(h => console.log("   ↝ скрыто: " + h));
  r.navs.forEach(h => console.log("   → уход:   " + h));
  console.log("   кнопка: " + (r.buttonVisible ? "ВИДИМА" : "скрыта (обычный браузер)"));
  console.log();
}

console.log("=== A. Цель = OneLink AppsFlyer, hasFocus() === false ===");
console.log("    (ровно среда Instagram на iOS 26, где был белый лист)\n");
for (const [name, ua] of Object.entries(UAS)) {
  report(name, ua, ONELINK, { realSafari: name.includes("настоящий") });
}

console.log("=== B. Цель = прямая ссылка на App Store ===\n");
for (const name of ["Instagram iOS 26 (реальный)", "Facebook feed iOS", "Instagram Android"]) {
  report(name, UAS[name], DIRECT, {});
}

// ---------------------------------------------------------------------------
// Пин регрессии. Белый лист возникал так: охранник считал отсутствие фокуса
// признаком ухода со страницы и глушил всё, включая показ кнопки.
// ---------------------------------------------------------------------------
console.log("=== C. Пин: белый лист в Instagram не должен вернуться ===\n");

let failed = 0;
function check(name, ok, detail) {
  console.log(`   ${ok ? "OK    " : "ПРОВАЛ"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
}

for (const hasFocus of [false, true]) {
  const r = run(SRC, UAS["Instagram iOS 26 (реальный)"], "", ONELINK, { hasFocus });
  check(`hasFocus()=${hasFocus}: кнопка видима`, r.buttonVisible);
  check(`hasFocus()=${hasFocus}: попытка выхода сделана`, r.hidden.length > 0,
    `${r.hidden.length} шт.`);
  check(`hasFocus()=${hasFocus}: документ не разрушен`, r.navs.length === 0,
    `${r.navs.length} полных уходов`);
}

// Статический пин: сам охранник не должен вернуться в код.
check("в router.js нет обращения к hasFocus", !/hasFocus/.test(SRC));

// Негативный контроль: пин обязан краснеть на коде, где охранник вернули.
{
  const revived = SRC.replace(
    "  function tryHidden(url) {",
    "  function gone() { return document.hasFocus && !document.hasFocus(); }\n" +
    "  function tryHidden(url) {\n    if (gone()) return;"
  );
  const r = run(revived, UAS["Instagram iOS 26 (реальный)"], "", ONELINK, { hasFocus: false });
  const staticCatches = /hasFocus/.test(revived);
  const behaviourCatches = r.hidden.length === 0;
  check("НЕГАТИВНЫЙ КОНТРОЛЬ: статический пин ловит возврат охранника", staticCatches);
  check("НЕГАТИВНЫЙ КОНТРОЛЬ: поведенческий пин ловит возврат охранника", behaviourCatches,
    `попыток стало ${r.hidden.length}`);
}

// ---------------------------------------------------------------------------
// D. Сохранность параметров атрибуции сквозь маршрут.
// Цель заворачивается в instagram://extbrowser/?url=<encodeURIComponent(dest)>;
// проверяем, что обратное декодирование даёт исходную строку без потерь.
// ---------------------------------------------------------------------------
console.log("\n=== D. Параметры атрибуции доезжают без потерь ===\n");

const AF = "https://app.appsflyer.com/id6457366208" +
  "?pid=metaweb_int&c={{campaign.name}}&af_siteid={{placement}}" +
  "&af_ad={{ad.name}}&af_adset={{adset.name}}&af_c_id={{campaign.id}}" +
  "&af_adset_id={{adset.id}}&af_ad_id={{ad.id}}&af_click_lookback=7d" +
  "&af_ios_store_cpp=1131d9d4-ab41-446e-88cb-06bf9d656624";

const EXPECTED_KEYS = ["pid", "c", "af_siteid", "af_ad", "af_adset", "af_c_id",
  "af_adset_id", "af_ad_id", "af_click_lookback", "af_ios_store_cpp"];

{
  const cfg = { ios: AF, android: AF, deep: null };
  const r = run(SRC, UAS["Instagram iOS 26 (реальный)"], "", cfg, {});
  const wrapped = r.hidden[0] || "";

  check("цель прошла allowlist и попытка сделана", r.hidden.length === 1);

  // Разворачиваем ровно так, как это сделает Instagram.
  const inner = decodeURIComponent(wrapped.replace(/^instagram:\/\/extbrowser\/\?url=/, ""));
  check("после разворачивания URL совпадает с исходным побайтно", inner === AF);

  const qs = new URLSearchParams(inner.slice(inner.indexOf("?") + 1));
  const missing = EXPECTED_KEYS.filter(k => !qs.has(k));
  check(`все ${EXPECTED_KEYS.length} параметров на месте`, missing.length === 0,
    missing.length ? "потеряны: " + missing.join(", ") : "");
  check("значение pid не искажено", qs.get("pid") === "metaweb_int");
  check("макрос Meta уцелел как есть", qs.get("c") === "{{campaign.name}}",
    "получено: " + qs.get("c"));
  check("CPP-идентификатор уцелел",
    qs.get("af_ios_store_cpp") === "1131d9d4-ab41-446e-88cb-06bf9d656624");
}

// Ловушка, из-за которой параметры теряются на ровном месте.
console.log("\n   Негативный контроль — почему цель нельзя класть в ?u= сырой:");
{
  const raw = run(SRC, UAS["Instagram iOS 26 (реальный)"], "?u=" + AF, {}, {});
  const rawInner = decodeURIComponent((raw.hidden[0] || "")
    .replace(/^instagram:\/\/extbrowser\/\?url=/, ""));
  const lost = EXPECTED_KEYS.filter(k => !rawInner.includes(k + "="));
  check("сырой ?u= ДОЛЖЕН терять параметры (иначе контроль бесполезен)",
    lost.length > 0, "потеряно " + lost.length + " из " + EXPECTED_KEYS.length);

  const enc = run(SRC, UAS["Instagram iOS 26 (реальный)"],
    "?u=" + encodeURIComponent(AF), {}, {});
  const encInner = decodeURIComponent((enc.hidden[0] || "")
    .replace(/^instagram:\/\/extbrowser\/\?url=/, ""));
  check("закодированный ?u= доносит цель целиком", encInner === AF);
}

console.log(failed ? "\nРЕЗУЛЬТАТ: ПРОВАЛ\n" : "\nРЕЗУЛЬТАТ: всё зелёное\n");
process.exit(failed ? 1 : 0);
