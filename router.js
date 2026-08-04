/*
 * Smart link router — выталкивает пользователя из in-app браузера наружу,
 * чтобы ссылка на App Store / атрибуционный линк дошли до цели.
 *
 * Вся логика клиентская: бэкенд не нужен, хостится на любой статике.
 * Конфиг — window.LINK_DEFAULTS в index.html, переопределяется query-параметрами.
 */
(function () {
  "use strict";

  // Открытый редиректор — приглашение для фишинга: чужие ссылки уедут
  // через наш домен. Пускаем только те хосты, ради которых всё затевалось.
  var ALLOW = [
    /^https:\/\/(www\.)?apps\.apple\.com\//i,
    /^https:\/\/(www\.)?itunes\.apple\.com\//i,
    /^https:\/\/app\.appsflyer\.com\//i,
    /^https:\/\/[a-z0-9-]+\.onelink\.me\//i,
    /^https:\/\/play\.google\.com\//i
  ];

  var q = new URLSearchParams(location.search);
  var D = window.LINK_DEFAULTS || {};
  var DEBUG = q.has("debug");

  function target(name) {
    var v = q.get(name) || D[name] || null;
    if (!v) return null;
    for (var i = 0; i < ALLOW.length; i++) {
      if (ALLOW[i].test(v)) return v;
    }
    log("отброшено, хост не в allowlist: " + v);
    return null;
  }

  // ---- detect ----------------------------------------------------------

  var ua = navigator.userAgent || "";

  var isIOS = /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);

  var isInstagram = /Instagram/i.test(ua);
  var isThreads = /Threads|Barcelona/i.test(ua);
  var isMessenger = /MessengerForiOS|MessengerLite|FB_IAB\/MESSENGER/i.test(ua);
  var isFacebook = !isMessenger && /FBAN|FBAV|FB_IAB/i.test(ua);
  var isTikTok = /musical_ly|BytedanceWebview|Aweme/i.test(ua);
  var isOtherInApp = /Snapchat|Line\/|Twitter|Pinterest|VKAndroidApp/i.test(ua);

  var taggedInApp = isInstagram || isThreads || isMessenger ||
    isFacebook || isTikTok || isOtherInApp;

  // Facebook на свежих iOS больше не помечает свой WebView в User-Agent —
  // он неотличим от Safari по строке. Опознаём по среде: в настоящем Safari
  // navigator.standalone определён (false), внутри WKWebView приложения его нет.
  // Сторонние браузеры исключаем по их собственным меткам.
  var isThirdPartyBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/i.test(ua);
  var untaggedWebView = isIOS && !taggedInApp && !isThirdPartyBrowser &&
    typeof navigator.standalone === "undefined";

  var inApp = taggedInApp || untaggedWebView;

  // Лента Facebook, TikTok и «замаскированный» WebView не пускают переход
  // на кастомную схему без жеста: система показывает запрос подтверждения,
  // а до него экран пустой. Показываем кнопку сразу — тап по ней и есть жест.
  var needsGesture = isFacebook || isTikTok || untaggedWebView;

  // ---- routes ----------------------------------------------------------

  var APPLE = /^https?:\/\/(www\.)?(apps|itunes)\.apple\.com\//i;

  // https://apps.apple.com/... -> itms-appss://apps.apple.com/...
  // Схема самого App Store переживает WebView, где https-редирект умирает.
  // Для атрибуционной ссылки не применима: домен чужой, стор его не откроет.
  function appleScheme(url) {
    return APPLE.test(url) ? url.replace(/^https?:\/\//, "itms-appss://") : null;
  }

  function androidIntent(url) {
    return "intent://" + url.replace(/^https?:\/\//, "") +
      "#Intent;scheme=https;package=com.android.chrome;" +
      "S.browser_fallback_url=" + encodeURIComponent(url) + ";end";
  }

  // ---- helpers ---------------------------------------------------------

  // Страница скрыта или потеряла фокус — значит переход состоялся либо висит
  // системный запрос «открыть приложение?». В обоих случаях дальше не дёргаем.
  function gone() {
    if (document.hidden || document.visibilityState === "hidden") return true;
    try {
      if (document.hasFocus && !document.hasFocus()) return true;
    } catch (e) { /* нет поддержки — считаем, что мы всё ещё здесь */ }
    return false;
  }

  function go(url) {
    log("→ " + url);
    if (DEBUG) return;
    window.location.replace(url);
  }

  var shown = false;
  function showFallback(url, withTip) {
    if (shown) return;
    shown = true;
    var link = document.getElementById("fallback-link");
    if (link) link.href = url;
    var box = document.getElementById("fallback");
    if (box) box.className = "show";
    if (withTip) {
      var tip = document.getElementById("tip");
      if (tip) tip.className = "show";
    }
    // Точка расширения под аналитику: тап по кнопке = автоматика не сработала.
    // Без бэкенда сюда вешается GA/Plausible-событие.
    if (typeof window.onFallbackShown === "function") window.onFallbackShown();
  }

  function log(msg) {
    if (!DEBUG) return;
    var out = document.getElementById("debug-log");
    if (out) out.textContent += msg + "\n";
  }

  // ---- go --------------------------------------------------------------

  var dest = (isIOS && target("ios")) || (isAndroid && target("android")) ||
    target("u") || target("ios") || target("android");

  if (DEBUG) {
    var box = document.getElementById("debug");
    if (box) box.className = "show";
    log("UA: " + ua);
    log("");
    log("iOS: " + isIOS + "   Android: " + isAndroid);
    log("inApp: " + inApp + " (по UA: " + taggedInApp +
      ", безымянный WebView: " + untaggedWebView + ")");
    log("Instagram: " + isInstagram + "   Facebook: " + isFacebook +
      "   TikTok: " + isTikTok);
    log("нужен жест: " + needsGesture);
    log("цель: " + dest);
    log("схема App Store: " + (dest ? appleScheme(dest) : null));
    log("");
    log("маршрут, который был бы выполнен:");
  }

  if (!dest) {
    log("цели нет — показываем заглушку");
    showFallback("#", false);
    return;
  }

  var deep = D.deep || null; // только из конфига: произвольную схему из query не пускаем
  var scheme = appleScheme(dest);

  if (!inApp) {
    // Обычный браузер — тут ничего изобретать не нужно.
    if (deep && (isIOS || isAndroid)) {
      go(deep);
      setTimeout(function () { if (!gone()) go(dest); }, 700);
      return;
    }
    go(dest);
    return;
  }

  if (isIOS) {
    var delay = 0;
    if (deep) {
      go(deep);
      delay = 700;
    }

    setTimeout(function () {
      if (gone()) return;
      if (needsGesture) {
        // Кнопку и подсказку рисуем ДО перехода: система спросит подтверждение,
        // и человек должен понимать, что нажать. Попытка ровно одна —
        // каждая следующая вызвала бы ещё один системный запрос.
        showFallback(scheme || dest, true);
        go(scheme || ("x-safari-" + dest));
        return;
      }
      if (isInstagram || isThreads) {
        // Недокументированный маршрут Instagram во внешний браузер.
        go("instagram://extbrowser/?url=" + encodeURIComponent(dest));
      } else {
        go("x-safari-" + dest);
      }
    }, delay);

    // Второй заход — только там, где переход идёт без системного запроса.
    setTimeout(function () {
      if (gone() || needsGesture) return;
      if (scheme) go(scheme);
      else if (isInstagram || isThreads) go("x-safari-" + dest);
    }, delay + 900);

    setTimeout(function () {
      if (!gone()) showFallback(scheme || dest, false);
    }, delay + (needsGesture ? 7000 : 2200));
    return;
  }

  if (isAndroid) {
    var wait = 0;
    if (deep) {
      go(deep);
      wait = 700;
    }
    setTimeout(function () { if (!gone()) go(androidIntent(dest)); }, wait);
    setTimeout(function () { if (!gone()) showFallback(dest, false); }, wait + 1500);
    return;
  }

  go(dest);
})();
