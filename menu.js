// KNOXPAD — меню-приложение Telegram-бота стримера: главная с плитками, записка на карте (app.js), рядом со
// стримером или в городе, босс, подпись, «Как это работает». Записку окно отдаёт боту через Telegram.WebApp.sendData
// (работает, когда окно открыто кнопкой «Открыть KNOXPAD» под полем ввода) — сервер не нужен.
// Параметры адреса подставляет бот: nick, max — длина текста, sx/sy — где стример, next — с какого времени (unix, с)
// можно писать следующую записку, left — сколько осталось на сегодня, why — почему писать нельзя, boss=0/1, price,
// donate — ссылка на донат, screen — сразу открыть экран (map).
"use strict";
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const TG = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
const inTelegram = !!(TG && TG.initData);
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
};

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
const SCREENS = { home: "scrHome", map: "scrMap", note: "scrNote", towns: "scrTowns", boss: "scrBoss", nick: "scrNick", help: "scrHelp" };
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

// ------------------------------------------------------------ отправка записки боту
let afterNick = null;
function sendNote(data) {
  const why = blockReason();
  if (why) return message("Пока нельзя", why);
  if (!ST.nick) {                       // без подписи бот всё равно спросит — спросим здесь
    afterNick = () => sendNote(data);
    return go("nick");
  }
  const payload = Object.assign({ v: 2, nick: ST.nick }, data, { text: String(data.text || "").trim().slice(0, MAXLEN) });
  if (inTelegram) {
    TG.sendData(JSON.stringify(payload));                     // окно закроется, бот ответит в чате
  } else {
    message("Это предпросмотр", "В Telegram сейчас ушло бы:\n" + JSON.stringify(payload, null, 1));
  }
}

// ------------------------------------------------------------ главная
function renderHome() {
  showNick();
  $("hStreamer").innerHTML = me ? "в квадрате <b>" + grid(me.x, me.y) + "</b>" : "не в игре — записка подождёт его";
  const why = blockReason();
  $("hLimit").textContent = why || (ST.left !== null ? "можно писать · сегодня осталось " + ST.left : "можно писать");
  $("hLimit").classList.toggle("bad", !!why);
  $("bossTileSub").textContent = ST.boss ? "Донат от " + ST.price + " ₽ — и начнётся охота" : "Сейчас выключено";
}
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

// ------------------------------------------------------------ босс
onShow.boss = () => {
  $("bossPrice").innerHTML = ST.boss ? "<small>донат от</small> " + ST.price + " ₽" : "<small>сейчас</small> выключено";
  $("bossDonate").textContent = "Задонатить " + ST.price + " ₽";
  $("bossDonate").classList.toggle("hide", !(ST.boss && ST.donate));
  $("bossNote").textContent = !ST.boss ? "Стример пока выключил босса за донат."
    : ST.donate ? "Откроется страница доната стримера." : "Ссылку на донат стример даст на стриме.";
};
$("bossDonate").onclick = () => {
  if (!ST.donate) return;
  try { inTelegram ? TG.openLink(ST.donate) : window.open(ST.donate, "_blank"); } catch (e) { window.open(ST.donate, "_blank"); }
};

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
