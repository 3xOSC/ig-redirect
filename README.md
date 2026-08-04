# ig-redirect

Страница-прослойка, которая выталкивает пользователя из in-app браузера
(Instagram, Threads, Facebook, TikTok) во внешний браузер или сразу в App Store.

Бэкенда нет — вся логика в `router.js`, хостится на любой статике.

## Деплой на GitHub Pages

```bash
cd /Users/igor/Desktop/code/ig-redirect
git init && git add . && git commit -m "init"
gh repo create ig-redirect --public --source=. --push
```

Дальше: репозиторий → **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.

Ссылка получится вида `https://<username>.github.io/ig-redirect/`.

⚠️ Pages кэширует агрессивно — после правки `router.js` изменения видны не мгновенно.
Проверять с `?debug=1&v=2` (любой мусорный параметр сбивает кэш).

## Использование

Цель по умолчанию задаётся в `index.html` → `window.LINK_DEFAULTS`.

Переопределяется query-параметрами:

| Параметр | Смысл |
|---|---|
| `?ios=<url>` | цель для iOS |
| `?android=<url>` | цель для Android |
| `?u=<url>` | одна цель на все платформы |
| `?debug=1` | **не редиректить**, показать вычисленный маршрут на экране |

Хост цели обязан быть в allowlist внутри `router.js` (Apple, AppsFlyer, OneLink,
Google Play). Иначе — открытый редиректор, через который погонят фишинг.

## `?debug=1` — главный инструмент

Открой ссылку с `?debug=1` **изнутри Instagram на реальном телефоне**: страница
не уйдёт никуда, а покажет UA, все флаги детекта и маршрут, который был бы
выполнен. Это единственный честный способ проверить, что происходит на устройстве
пользователя — из симулятора и десктопа это не воспроизводится.

## Маршруты

| Среда | Что делаем |
|---|---|
| iOS, цель = `apps.apple.com` | `itms-appss://apps.apple.com/...` — открывает App Store напрямую, браузер не нужен |
| iOS, Instagram/Threads, цель ≠ Apple | `instagram://extbrowser/?url=...`, через 900 мс фолбэк `x-safari-https://...` |
| iOS, лента Facebook / TikTok / безымянный WebView | кнопка сразу (нужен жест) + **одна** попытка `itms-appss://` или `x-safari-` |
| Android, in-app | `intent://...#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=...;end` |
| Обычный браузер | просто `location.replace(dest)` |

Во всех in-app ветках по таймауту показывается кнопка-фолбэк.

## Что здесь хрупкое

`instagram://extbrowser` и префикс `x-safari-` **не документированы** Meta и Apple
и могут перестать работать без предупреждения. Когда это случится, весь трафик
уедет на кнопку-фолбэк.

Поэтому доля показов кнопки — не косметика, а метрика потерь. Без бэкенда её
снимать нечем: повесь GA/Plausible-событие в `window.onFallbackShown`
(точка расширения уже есть в `router.js`).

## Про атрибуцию

`itms-appss://` работает **только** для `apps.apple.com` — App Store чужой домен
не откроет. Если цель — атрибуционный линк (AppsFlyer/Branch/Adjust), короткого
пути в обход браузера нет by design: клик обязан произойти на домене трекера.

Проверь, что в атрибуционной ссылке есть `pid` (media source) и `c` (campaign) —
без них установка осядет как organic, и это не имеет отношения к браузеру.

## Тест логики

Прогон ветвления под набором UA без устройства:

```bash
node route-test.js
```
