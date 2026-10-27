// KNOXPAD — меню-приложение Telegram-бота стримера: главная с плитками, записка на карте (app.js), рядом со
// стримером или в городе, босс, подпись, «Как это работает». Записку окно отдаёт боту через Telegram.WebApp.sendData
// (работает, когда окно открыто кнопкой «Открыть KNOXPAD» под полем ввода) — сервер не нужен.
// Параметры адреса подставляет бот: nick, max — длина текста, sx/sy — где стример, next — с какого времени (unix, с)
// можно писать следующую записку, left — сколько осталось на сегодня, why — почему писать нельзя, boss=0/1, price,
// donate — ссылка на донат, screen — сразу открыть экран (map).
// KnoxCoin (если стример включил): coins — баланс, cn / cb — цена записки / босса, cur — название монет, rate — монет
// за 1 ₽ доната, num — личный номер для сообщения к донату, tw — привязанный Twitch, wh — монет за час просмотра
// (нет — стример не подключил Twitch), sp — наборы звёзд через запятую, ss — монет за звезду, free=1 — бесплатная записка.
"use strict";
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const Q = new URLSearchParams(location.search);
const TG = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
// открыто кнопкой под полем ввода — initData пустой (так задумано в Telegram), поэтому узнаём Telegram по платформе
const inTelegram = !!(TG && (TG.initData || (TG.platform && TG.platform !== "unknown")));
const MAXLEN = Math.max(20, Math.min(1000, Number(Q.get("max")) || 400));
const GRID = 1000;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const grid = (x, y) => LETTERS[Math.floor(x / GRID)] + (Math.floor(y / GRID) + 1);
const me = Q.has("sx") ? { x: Number(Q.get("sx")), y: Number(Q.get("sy")) } : null;

// города — как в боте (hub_parse.TOWNS): имя уходит боту как есть
const TOWNS = [["Малдро", 10593, 9738], ["Вест-Пойнт", 11920, 6900], ["Риверсайд", 6435, 5282], ["Роузвуд", 8105, 11578],
  ["Марч-Ридж", 10088, 12696], ["Луисвилль", 12500, 1800], ["Вэлли-Стейшн", 12672, 5718], ["Дикси", 11533, 8777],
  ["Фоллас-Лейк", 7276, 8332], ["Доу-Вэлли", 6734, 10020], ["Эхо-Крик", 3600, 10925], ["Экрон", 546, 9891],
  ["Бранденбург", 2114, 6000], ["Ирвингтон", 2498, 14253]];
const PLACES2 = [["random", "Как повезёт"], ["trash", "Мусорка"], ["building", "В доме"], ["corpse", "Труп"],
  ["car", "Бардачок машины"], ["fake", "Труп, который встанет"]];

const ST = {
  nick: Q.get("nick") || "",
  next: Number(Q.get("next")) || 0,
  left: Q.has("left") ? Number(Q.get("left")) : null,
  why: Q.get("why") || "",
  boss: Q.get("boss") !== "0",
  price: Number(Q.get("price")) || 500,
  donate: Q.get("donate") || "",
  coins: Q.has("coins") ? Number(Q.get("coins")) || 0 : null,     // null — KnoxCoin выключен
  cn: Number(Q.get("cn")) || 0,
  cb: Number(Q.get("cb")) || 0,
  cur: Q.get("cur") || "KnoxCoin",
  rate: Q.get("rate") || "1",
  num: /^\d{6}$/.test(Q.get("num") || "") ? Q.get("num") : "",
  tw: Q.get("tw") || "",
  wh: Number(Q.get("wh")) || 0,
  sp: (Q.get("sp") || "").split(",").map(Number).filter((n) => n > 0).slice(0, 4),
  ss: Number(Q.get("ss")) || 1,
  free: Q.get("free") === "1",                      // бесплатная записка недели ещё не потрачена
};
const COINS = ST.coins !== null;
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// ------------------------------------------------------------ подпись: из бота, иначе из памяти Telegram / браузера
const NICK_KEY = "knoxpad_nick";
function cleanNick(s) {
  s = String(s || "").replace(/[\u0000-\u001f]/g, "").trim().replace(/^@/, "");
  if (!s || s.length > 25 || /https?:|www\.|\.(ru|com|tv|gg|me)\b|t\.me/i.test(s)) return "";
  return s;
}
function showNick() {
  document.querySelectorAll(".nickText").forEach((e) => (e.textContent = ST.nick || "не задана"));
  document.querySelectorAll(".nickSign").forEach((e) => (e.textContent = ST.nick ? "— " + ST.nick : ""));
}
function saveNick(n) {
  ST.nick = n;
  try { localStorage.setItem(NICK_KEY, n); } catch (e) {}
  try { TG && TG.CloudStorage && TG.CloudStorage.setItem(NICK_KEY, n); } catch (e) {}
  showNick();
}
if (!ST.nick) {
  try { ST.nick = cleanNick(localStorage.getItem(NICK_KEY)); } catch (e) {}
  try {
    TG && TG.CloudStorage && TG.CloudStorage.getItem(NICK_KEY, (err, v) => { if (!err && !ST.nick && cleanNick(v)) { ST.nick = cleanNick(v); showNick(); } });
  } catch (e) {}
}

// ------------------------------------------------------------ можно ли писать
function blockReason() {
  if (ST.why) return ST.why;
  const wait = ST.next * 1000 - Date.now();
  if (wait > 0) return "Следующую записку можно написать через " + Math.ceil(wait / 60000) + " мин.";
  return "";
}

// ------------------------------------------------------------ экраны
const SCREENS = { home: "scrHome", map: "scrMap", note: "scrNote", towns: "scrTowns", boss: "scrBoss", nick: "scrNick", help: "scrHelp", coins: "scrCoins" };
const stack = ["home"];
const onShow = {};                       // экран -> что сделать при показе
function show(name) {
  for (const [k, id] of Object.entries(SCREENS)) $(id).classList.toggle("on", k === name);
  document.body.dataset.screen = name;
  try { stack.length > 1 ? TG.BackButton.show() : TG.BackButton.hide(); } catch (e) {}
  if (onShow[name]) onShow[name]();
  const s = $(SCREENS[name]);
  if (s.classList.contains("page")) s.scrollTop = 0;
}
function go(name) { stack.push(name); show(name); haptic(); }
function back() {
  if (stack.length > 1) stack.pop();
  show(stack[stack.length - 1]);
}
function haptic() { try { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred("light"); } catch (e) {} }
document.querySelectorAll(".back").forEach((b) => (b.onclick = back));
try { TG && TG.BackButton.onClick(back); } catch (e) {}

function message(title, text) {
  $("modalTitle").textContent = title; $("modalBody").textContent = text;
  $("modal").classList.remove("hide");
}
$("modalOk").onclick = () => $("modal").classList.add("hide");

// ------------------------------------------------------------ отправка боту (записка, код, босс)
let afterNick = null;
function toBot(payload) {
  if (inTelegram) {
    try {
      TG.sendData(JSON.stringify(payload));                   // окно закроется, бот ответит в чате
    } catch (e) {                                             // открыто не кнопкой под полем ввода — отправить нельзя
      message("Не получилось отправить", "Открой меню кнопкой «📱 Открыть KNOXPAD» под полем ввода в чате с ботом (если её нет — напиши боту /start) и отправь ещё раз.");
    }
  } else {
    message("Это предпросмотр", "В Telegram сейчас ушло бы:\n" + JSON.stringify(payload, null, 1));
  }
}
const noteCost = () => (COINS && !ST.free ? ST.cn : 0);
// хватает ли монет; нет — объясняем и ведём на экран счёта
function canPay(cost) {
  if (!COINS || !cost || ST.coins >= cost) return true;
  message("Не хватает " + ST.cur, "Нужно " + fmt(cost) + ", у тебя " + fmt(ST.coins) + ". Монеты дают за просмотр стрима, за донаты с твоим ником Twitch и за звёзды — всё на экране «" + ST.cur + "».");
  go("coins");
  return false;
}
function sendNote(data) {
  const why = blockReason();
  if (why) return message("Пока нельзя", why);
  if (!canPay(noteCost())) return;
  if (!ST.nick) {                       // без подписи бот всё равно спросит — спросим здесь
    afterNick = () => sendNote(data);
    return go("nick");
  }
  toBot(Object.assign({ v: 2, nick: ST.nick }, data, { text: String(data.text || "").trim().slice(0, MAXLEN) }));
}

// ------------------------------------------------------------ главная
function renderHome() {
  showNick();
  // положение приходит в ссылке от бота — оно устаревает: старше 3 минут (или стримера не было в игре) — «обновить»
  const stale = !Q.has("pt") || Date.now() / 1000 - Number(Q.get("pt")) > 180;
  $("hStreamer").innerHTML = (me ? "в квадрате <b>" + grid(me.x, me.y) + "</b>" + (stale ? " <small>(было)</small>" : "")
    : stale ? "где он сейчас — нажми «обновить»" : "не в игре — записка подождёт его")
    + (stale && inTelegram ? ' <button class="link" id="posRefresh">обновить</button>' : "");
  if ($("posRefresh")) $("posRefresh").onclick = () => toBot({ v: 2, act: "pos" });
  const why = blockReason();
  $("hLimit").textContent = why || (ST.left !== null ? "можно писать · сегодня осталось " + ST.left : "можно писать");
  $("hLimit").classList.toggle("bad", !!why);
  $("bossTileSub").textContent = !ST.boss ? "Сейчас выключено" : COINS ? fmt(ST.cb) + " " + ST.cur + " — и начнётся охота"
    : "Донат от " + ST.price + " ₽ — и начнётся охота";
  $("hCoinsRow").classList.toggle("hide", !COINS);
  $("coinsTile").classList.toggle("hide", !COINS);
  if (COINS) {
    $("hCoinsName").textContent = ST.cur;
    $("hCoins").textContent = "💰 " + fmt(ST.coins);
    $("coinsTileTitle").textContent = ST.cur;
    $("coinsTileSub").textContent = "На счёте " + fmt(ST.coins) + " · " + (ST.wh && !ST.tw ? "войди через Twitch — монеты за просмотр" : "как пополнить");
    $("homeFoot").textContent = (ST.cn ? "Записка — " + fmt(ST.cn) + " " + ST.cur + (ST.free ? ", но одна в неделю бесплатно — твоя ещё не потрачена. " : ". ") : "Записки бесплатные. ")
      + "Отклонят — монеты вернутся. Мат, оскорбления и ссылки модератор не пропустит.";
  }
  const label = "Спрятать записку" + (COINS && ST.cn ? " · " + (ST.free ? "бесплатно" : fmt(ST.cn)) : "");
  $("send2").textContent = label;
  if ($("send")) $("send").textContent = label;
}
$("coinsEdit").onclick = () => go("coins");
onShow.home = renderHome;
document.querySelectorAll(".tile[data-go]").forEach((t) => {
  t.onclick = () => {
    const to = t.dataset.go;
    if (to === "near") return openNote({ where: "near" }, "Рядом со стримером", me ? "сейчас он в квадрате " + grid(me.x, me.y) : "появится рядом, когда он зайдёт в игру");
    go(to);
  };
});
$("nickEdit").onclick = () => go("nick");

// ------------------------------------------------------------ записка рядом / в городе
let noteTarget = null, place2 = "random";
function openNote(target, title, sub) {
  noteTarget = target;
  $("noteTitle").firstChild.textContent = title;
  $("noteSub").textContent = sub;
  go("note");
}
function renderPlaces2() {
  $("places2").innerHTML = "";
  for (const [k, title] of PLACES2) {
    const b = document.createElement("button");
    b.className = "chip" + (k === place2 ? " on" : "");
    b.textContent = title;
    b.onclick = () => { place2 = k; renderPlaces2(); };
    $("places2").appendChild(b);
  }
}
function update2() {
  $("count2").textContent = $("text2").value.length + "/" + MAXLEN;
  $("send2").disabled = !$("text2").value.trim();
}
$("text2").maxLength = MAXLEN;
$("text2").addEventListener("input", update2);
$("send2").onclick = () => { if (!$("send2").disabled) sendNote(Object.assign({}, noteTarget, { place: place2, text: $("text2").value })); };
onShow.note = () => { renderPlaces2(); update2(); showNick(); };

// ------------------------------------------------------------ города
function renderTowns() {
  const list = TOWNS.map(([name, x, y]) => ({ name, x, y, d: me ? Math.hypot(me.x - x, me.y - y) : null }));
  if (me) list.sort((a, b) => a.d - b.d);
  $("towns").innerHTML = "";
  for (const t of list) {
    const b = document.createElement("button");
    b.className = "town";
    b.innerHTML = "<b></b><small></small>";
    b.firstChild.textContent = t.name;
    b.lastChild.textContent = "квадрат " + grid(t.x, t.y) + (t.d !== null ? " · " + (t.d < 1000 ? "стример рядом" : "~" + (t.d / 1000).toFixed(1).replace(".", ",") + " км от стримера") : "");
    b.onclick = () => openNote({ where: "town", town: t.name }, "В городе " + t.name, "квадрат " + grid(t.x, t.y) + " · появится, когда стример туда доберётся");
    $("towns").appendChild(b);
  }
}
onShow.towns = renderTowns;

// ------------------------------------------------------------ счёт KnoxCoin
onShow.coins = () => {
  $("coinsTitle").textContent = ST.cur;
  $("coinsBal").innerHTML = "<small>на счёте</small> " + fmt(ST.coins) + " " + ST.cur;
  $("coinsPrices").innerHTML = "";
  for (const [t, c] of [["записка", ST.cn], ["босс", ST.cb]]) {
    const li = document.createElement("li");
    li.textContent = t + " — " + (c ? fmt(c) + " " + ST.cur : "бесплатно") + (t === "записка" && c && ST.free ? " (на этой неделе одна — бесплатно)" : "");
    $("coinsPrices").appendChild(li);
  }
  // Twitch: монеты за просмотр (если стример подключил Twitch)
  $("twLabel").classList.toggle("hide", !ST.wh);
  $("twCard").classList.toggle("hide", !ST.wh);
  $("twText").textContent = ST.tw ? "Twitch «" + ST.tw + "» привязан. Пока идёт стрим, за каждый час просмотра — " + fmt(ST.wh) + " " + ST.cur + "."
    : "Смотри стрим на Twitch — за каждый час " + fmt(ST.wh) + " " + ST.cur + ". Войди один раз своим Twitch, чтобы я знал, что аккаунт твой.";
  $("twLogin").classList.toggle("hide", !!ST.tw);
  // донат: в имя доната — свой ник Twitch (вход подтвердил Twitch)
  $("numBox").classList.toggle("hide", !ST.tw);
  $("numVal").textContent = ST.tw;
  $("numText").innerHTML = ST.tw
    ? "<ol class=\"steps\"><li>Нажми «Задонатить» — откроется страница доната.</li><li>В поле «Имя» впиши этот ник: <b>" + esc(ST.tw) + "</b>.</li>"
      + "<li>Сумма — сколько хочешь: 1 ₽ = " + ST.rate.replace(".", ",") + " " + esc(ST.cur) + ".</li><li>Отправь — через минуту бот напишет «+…».</li></ol>"
    : ST.wh ? "Сначала войди через Twitch (выше): потом впишешь свой ник Twitch в имя доната — и монеты за донат придут тебе. Без Twitch — пополняй звёздами."
      : "Монеты за донат приходят по нику Twitch — стример его ещё не подключил. Пока пополняй звёздами.";
  $("coinsDonate").classList.toggle("hide", !ST.donate);
  // звёзды Telegram
  $("starsLabel").classList.toggle("hide", !ST.sp.length);
  $("starsPacks").classList.toggle("hide", !ST.sp.length);
  $("starsPacks").innerHTML = "";
  for (const n of ST.sp) {
    const b = document.createElement("button");
    b.className = "chip star";
    b.textContent = "⭐ " + n + " → " + fmt(Math.floor(n * ST.ss)) + " " + ST.cur;
    b.onclick = () => toBot({ v: 2, act: "stars", pack: n });
    $("starsPacks").appendChild(b);
  }
};
// вход одной кнопкой: открываем Twitch прямо отсюда (адрес дал бот), вернёмся в бота уже привязанными
$("twLogin").onclick = () => {
  const u = Q.get("twu");
  if (!u || !/^https:\/\/id\.twitch\.tv\//.test(u)) return toBot({ v: 2, act: "twitch" });
  try { inTelegram ? TG.openLink(u) : window.open(u, "_blank"); } catch (e) { window.open(u, "_blank"); }
  if (inTelegram) setTimeout(() => { try { TG.close(); } catch (e) {} }, 400);
};
$("numCopy").onclick = () => {
  const done = () => { $("numCopy").textContent = "скопировано"; setTimeout(() => ($("numCopy").textContent = "скопировать"), 1500); };
  try { navigator.clipboard.writeText(ST.tw).then(done, () => message("Твой ник для доната", ST.tw)); } catch (e) { message("Твой ник для доната", ST.tw); }
};
$("coinsDonate").onclick = () => openDonate();
function openDonate() {
  if (!ST.donate) return;
  try { inTelegram ? TG.openLink(ST.donate) : window.open(ST.donate, "_blank"); } catch (e) { window.open(ST.donate, "_blank"); }
}

// ------------------------------------------------------------ босс
onShow.boss = () => {
  if (COINS) {
    $("bossPrice").innerHTML = ST.boss ? "<small>стоит</small> " + fmt(ST.cb) + " " + ST.cur : "<small>сейчас</small> выключено";
    $("bossHow").textContent = "Напиши боевой клич — его увидят на стриме. Босса выпускает стример кнопкой; не выпустит — монеты вернутся.";
    const enough = ST.coins >= ST.cb;
    $("bossCryBox").classList.toggle("hide", !ST.boss);
    $("bossBuy").classList.toggle("hide", !ST.boss);
    $("bossBuy").textContent = enough ? "Выпустить босса · " + fmt(ST.cb) : "Не хватает " + fmt(ST.cb - ST.coins) + " " + ST.cur;
    $("bossDonate").classList.add("hide");
    $("bossNote").textContent = "На счёте " + fmt(ST.coins) + " " + ST.cur + ".";
    return;
  }
  $("bossPrice").innerHTML = ST.boss ? "<small>донат от</small> " + ST.price + " ₽" : "<small>сейчас</small> выключено";
  $("bossDonate").textContent = "Задонатить " + ST.price + " ₽";
  $("bossDonate").classList.toggle("hide", !(ST.boss && ST.donate));
  $("bossNote").textContent = !ST.boss ? "Стример пока выключил босса за донат."
    : ST.donate ? "Откроется страница доната стримера." : "Ссылку на донат стример даст на стриме.";
};
$("bossDonate").onclick = () => openDonate();
function buyBoss() {
  if (!canPay(ST.cb)) return;
  if (!ST.nick) { afterNick = buyBoss; return go("nick"); }    // ник станет именем босса
  toBot({ v: 2, act: "boss", nick: ST.nick, text: $("bossCry").value.trim().slice(0, 120) });
}
$("bossBuy").onclick = buyBoss;

// ------------------------------------------------------------ подпись
onShow.nick = () => {
  $("nickInput").value = ST.nick;
  const hints = [];
  const u = TG && TG.initDataUnsafe && TG.initDataUnsafe.user;
  if (u && u.username) hints.push(u.username);
  if (u && u.first_name) hints.push(u.first_name);
  $("nickHints").innerHTML = "";
  for (const h of [...new Set(hints.map(cleanNick).filter(Boolean))]) {
    const b = document.createElement("button");
    b.className = "chip"; b.textContent = h;
    b.onclick = () => ($("nickInput").value = h);
    $("nickHints").appendChild(b);
  }
};
$("nickSave").onclick = () => {
  const n = cleanNick($("nickInput").value);
  if (!n) return message("Подпись", "Ник — до 25 букв и цифр, без ссылок. Попробуй ещё раз.");
  saveNick(n);
  back();
  if (afterNick) { const f = afterNick; afterNick = null; f(); }
};

// ------------------------------------------------------------ старт
if (TG) {
  try {
    TG.ready(); TG.expand();
    TG.setHeaderColor && TG.setHeaderColor("#121212");
    TG.setBackgroundColor && TG.setBackgroundColor("#121212");
  } catch (e) {}
}
showNick();
renderHome();
