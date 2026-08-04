/*
 * Smart link router — выталкивает пользователя из in-app браузера наружу,
 * чтобы ссылка на App Store / атрибуционный линк дошли до цели.
 *
 * Вся логика клиентская: бэкенда нет, хостится на любой статике.
 * Конфиг — window.LINK_DEFAULTS в index.html, переопределяется query-параметрами.
 *
 * ГЛАВНЫЙ ИНВАРИАНТ: страница никогда не должна оставаться белой.
 * Кнопка нарисована в HTML и видима ДО выполнения скрипта; скрипт её только
 * прячет (в обычном браузере) и подставляет адрес. Если скрипт не выполнится
 * вовсе, пользователь всё равно увидит рабочую кнопку.
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

  // Если цель пришла в query — конфиг по умолчанию игнорируем целиком.
  // Иначе ?u= молча проигрывал бы дефолтному ios, и тест шёл бы не туда.
  var fromQuery = q.has("ios") || q.has("android") || q.has("u");

  function allowed(v) {
    if (!v) return null;
    for (var i = 0; i < ALLOW.length; i++) {
      if (ALLOW[i].test(v)) return v;
    }
    log("отброшено, хост не в allowlist: " + v);
    return null;
  }

  function target(name) {
    return allowed(fromQuery ? q.get(name) : D[name]);
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
  var isThirdPartyBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|DuckDuckGo/i.test(ua);
  var untaggedWebView = isIOS && !taggedInApp && !isThirdPartyBrowser &&
    typeof navigator.standalone === "undefined";

  var inApp = taggedInApp || untaggedWebView;

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

  // ПОЧЕМУ iframe, а не location.replace.
  // В in-app браузере iOS переход на кастомную схему без пользовательского
  // жеста блокируется, но документ при этом уже снят с рендера — экран остаётся
  // белым, и отложенные таймеры вместе с кнопкой-фолбэком умирают.
  // Навигация внутри скрытого iframe дёргает схему, не трогая основной документ:
  // сработало — система уводит в приложение, не сработало — просто ничего,
  // страница жива и кнопка на месте.
  function tryHidden(url) {
    log("↝ пробуем скрыто: " + url);
    if (DEBUG) return;
    try {
      var f = document.createElement("iframe");
      f.style.display = "none";
      f.src = url;
      document.body.appendChild(f);
      setTimeout(function () {
        if (f.parentNode) f.parentNode.removeChild(f);
      }, 1500);
    } catch (e) {
      log("iframe недоступен: " + e);
    }
  }

  // Полноценный уход со страницы. Допустим только там, где он не оставит
  // белого экрана: обычный браузер или ответ на реальный тап пользователя.
  function go(url) {
    log("→ уходим: " + url);
    if (DEBUG) return;
    window.location.href = url;
  }

  var fallbackBox = document.getElementById("fallback");
  var fallbackLink = document.getElementById("fallback-link");

  function armFallback(url, tipText) {
    if (fallbackLink) {
      fallbackLink.href = url;
      fallbackLink.addEventListener("click", function () {
        // Тап — это жест, здесь уход со страницы разрешён системой.
        if (typeof window.onFallbackTap === "function") window.onFallbackTap();
      });
    }
    if (tipText) {
      var tip = document.getElementById("tip");
      if (tip) { tip.textContent = tipText; tip.className = "show"; }
    }
  }

  function hideFallback() {
    if (fallbackBox) fallbackBox.className = "hidden";
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
    log("цель: " + dest);
    log("схема App Store: " + (dest ? appleScheme(dest) : null));
    log("");
  }

  if (!dest) {
    log("цели нет");
    armFallback("#", "Ссылка настроена неверно: цель не задана или её хост не разрешён.");
    return;
  }

  var deep = D.deep || null; // только из конфига: произвольную схему из query не пускаем
  var scheme = appleScheme(dest);

  if (!inApp) {
    // Обычный браузер: уходим сразу, кнопку прячем — она тут лишняя.
    hideFallback();
    if (deep && (isIOS || isAndroid)) {
      tryHidden(deep);
      setTimeout(function () { go(dest); }, 700);
      return;
    }
    go(dest);
    return;
  }

  // --- in-app браузер ---
  // Кнопка уже видима (она в HTML). Ниже — только скрытые попытки:
  // сработает — уйдём сами, нет — пользователь нажмёт кнопку.

  if (isIOS) {
    // По кнопке ведём туда, что переживает WebView лучше всего: схема стора,
    // если цель — Apple; иначе сам адрес (в худшем случае откроется внутри,
    // но это всё равно лучше белого экрана).
    armFallback(scheme || dest, scheme
      ? "Если появится запрос на открытие App Store — выберите «Открыть»"
      : "Если ничего не произошло — нажмите кнопку выше");

    if (deep) tryHidden(deep);

    setTimeout(function () {
      if (scheme) {
        tryHidden(scheme);
      } else if (isInstagram || isThreads) {
        tryHidden("instagram://extbrowser/?url=" + encodeURIComponent(dest));
      }
    }, deep ? 700 : 0);
    return;
  }

  if (isAndroid) {
    armFallback(dest, "Если ничего не произошло — нажмите кнопку выше");
    if (deep) tryHidden(deep);
    // Android WebView исторически пропускает intent:// и корректно
    // отрабатывает browser_fallback_url. НЕ ПРОВЕРЕНО на устройстве.
    setTimeout(function () { tryHidden(androidIntent(dest)); }, deep ? 700 : 0);
    return;
  }

  hideFallback();
  go(dest);
})();
