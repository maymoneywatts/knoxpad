// Окно-карта для Telegram-бота стримера: бумажная карта Knox County (как в игре на M), зритель тыкает точку,
// выбирает «куда положить», пишет записку — и окно отдаёт это боту (Telegram.WebApp.sendData).
// Адрес открывает бот, подставляя параметры: ?sx=&sy= — где стример (клетки игры), &nick= — подпись, &max= — длина текста.
"use strict";
const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const TG = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
const inTelegram = !!(TG && TG.initData);

// цвета бумажной карты игры (ISMapDefinitions.lua, initDefaultStyleV1)
const COLORS = {
  paper: "#dbd7c0", water: "rgb(59,141,149)", trail: "rgb(185,122,87)", tertiary: "rgb(171,158,143)",
  secondary: "rgb(134,125,113)", primary: "rgb(134,125,113)", railway: "rgb(200,191,231)",
  "b-Residential": "rgb(210,158,105)", "b-yes": "rgb(210,158,105)", "b-CommunityServices": "rgb(139,117,235)",
  "b-Hospitality": "rgb(127,206,225)", "b-Industrial": "rgb(56,54,53)", "b-Medical": "rgb(229,128,151)",
  "b-RestaurantsAndEntertainment": "rgb(245,225,60)", "b-RetailAndCommercial": "rgb(184,205,84)",
};
const BUILDING = {
  "b-Residential": "жилой дом", "b-yes": "дом", "b-CommunityServices": "общественное здание", "b-Hospitality": "отель",
  "b-Industrial": "склад или завод", "b-Medical": "больница", "b-RestaurantsAndEntertainment": "кафе или развлечения",
  "b-RetailAndCommercial": "магазин",
};
const PLACES = [["nearest", "Ближайший ящик"], ["trash", "Мусорка"], ["building", "В доме"], ["car", "Машина"],
                ["corpse", "Труп"], ["fake", "Труп, который встанет"]];
const GRID = 1000;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAXLEN = Math.max(20, Math.min(1000, Number(Q.get("max")) || 400));

let MAP = null, forest = null;
const paths = {};                    // "cx,cy" -> {layer: Path2D}
const canvas = $("map"), ctx = canvas.getContext("2d");
let W = 0, H = 0, dpr = 1;
const view = { s: 0.05, x: 10600, y: 9700 };      // s — пикселей экрана на клетку; x,y — центр экрана в клетках игры
let pick = null;                     // {x, y, info}
let place = "nearest";
const me = Q.has("sx") ? { x: Number(Q.get("sx")), y: Number(Q.get("sy")) } : null;

// ------------------------------------------------------------ загрузка
async function load() {
  MAP = await (await fetch("data/map.json")).json();
  forest = new Image();
  forest.src = "data/" + MAP.forest.src;
  await new Promise((r) => { forest.onload = r; forest.onerror = r; });
  for (const [key, layers] of Object.entries(MAP.cells)) {
    const p = (paths[key] = {});
    for (const [layer, polys] of Object.entries(layers)) {
      const path = new Path2D();
      for (const poly of polys) {
        const rings = typeof poly[0] === "number" ? [poly] : poly;
        for (const r of rings) {
          path.moveTo(r[0], r[1]);
          for (let i = 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
          path.closePath();
        }
      }
      p[layer] = path;
    }
  }
  if (me) { view.x = me.x; view.y = me.y; view.s = 0.18; } else fitAll();
  draw();
}

function fitAll() {
  view.x = MAP.w / 2; view.y = MAP.h / 2;
  view.s = Math.min(W / MAP.w, (H * 0.6) / MAP.h);
}

// ------------------------------------------------------------ рисование
function resize() {
  dpr = Math.min(3, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  if (MAP) draw();
}
const toScreen = (x, y) => [(x - view.x) * view.s + W / 2, (y - view.y) * view.s + mapCenterY()];
const toWorld = (sx, sy) => [(sx - W / 2) / view.s + view.x, (sy - mapCenterY()) / view.s + view.y];
function mapCenterY() { return (H - sheetHeight()) / 2 + 30; }
function sheetHeight() { const r = $("sheet").getBoundingClientRect(); return Math.max(0, H - r.top); }

let pending = false;
function draw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, W, H);
  const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H);
  const cy = mapCenterY();
  // мир -> экран одной матрицей
  ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * (W / 2 - view.x * view.s), dpr * (cy - view.y * view.s));
  // лес — картинкой
  if (forest && forest.width) {
    ctx.imageSmoothingEnabled = true;            // края леса мягкие при любом приближении
    ctx.drawImage(forest, 0, 0, forest.width * MAP.forest.scale, forest.height * MAP.forest.scale);
  }
  const c = MAP.cell;
  const cx0 = Math.max(0, Math.floor(x0 / c)), cx1 = Math.floor(x1 / c), cy0 = Math.max(0, Math.floor(y0 / c)), cy1 = Math.floor(y1 / c);
  const showBuildings = view.s > 0.12;
  for (const layer of MAP.layers) {
    const isB = layer.startsWith("b-");
    if (isB && !showBuildings) continue;
    if ((layer === "trail" || layer === "tertiary") && view.s < 0.04) continue;
    ctx.fillStyle = COLORS[layer];
    for (let gx = cx0; gx <= cx1; gx++) for (let gy = cy0; gy <= cy1; gy++) {
      const p = paths[gx + "," + gy];
      if (p && p[layer]) ctx.fill(p[layer], "evenodd");
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawGrid(x0, y0, x1, y1);
  drawLabels();
  if (me) drawStreamer();
  if (pick) drawPick();
}

function drawGrid(x0, y0, x1, y1) {
  const step = GRID * view.s;
  if (step < 18) return;
  ctx.strokeStyle = "rgba(120, 80, 170, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = Math.max(0, Math.floor(x0 / GRID)); gx <= Math.ceil(x1 / GRID); gx++) {
    const [sx] = toScreen(gx * GRID, 0);
    ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, H);
  }
  for (let gy = Math.max(0, Math.floor(y0 / GRID)); gy <= Math.ceil(y1 / GRID); gy++) {
    const [, sy] = toScreen(0, gy * GRID);
    ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(W, Math.round(sy) + 0.5);
  }
  ctx.stroke();
  if (step < 46) return;
  ctx.font = `700 ${step > 140 ? 18 : 13}px "PT Sans Narrow", sans-serif`;
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(95, 60, 140, 0.75)";
  for (let gx = Math.max(0, Math.floor(x0 / GRID)); gx <= Math.ceil(x1 / GRID) && gx < 26; gx++)
    for (let gy = Math.max(0, Math.floor(y0 / GRID)); gy <= Math.ceil(y1 / GRID); gy++) {
      const [sx, sy] = toScreen(gx * GRID, gy * GRID);
      ctx.fillText(LETTERS[gx] + (gy + 1), sx + 4, sy + 3);
    }
}

function drawLabels() {
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const l of MAP.labels) {
    const town = l.s === "town";
    if (!town && view.s < 0.09) continue;
    if (town && view.s > 0.6) continue;
    const [sx, sy] = toScreen(l.x, l.y);
    if (sx < -200 || sy < -60 || sx > W + 200 || sy > H + 60) continue;
    const size = town ? Math.max(13, Math.min(30, l.k * 4.2 * Math.sqrt(view.s / 0.05))) : Math.max(11, Math.min(17, 12 * Math.sqrt(view.s / 0.15)));
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((l.r * Math.PI) / 180);
    ctx.font = `${town ? 700 : 400} ${size}px "PT Sans Narrow", sans-serif`;
    ctx.fillStyle = l.s.startsWith("water") ? "rgba(30, 80, 90, 0.85)" : town ? "rgba(40, 30, 25, 0.88)" : "rgba(60, 50, 40, 0.8)";
    l.t.split("\n").forEach((line, i, all) => ctx.fillText(line, 0, (i - (all.length - 1) / 2) * size * 1.05));
    ctx.restore();
  }
}

function drawStreamer() {
  const [sx, sy] = toScreen(me.x, me.y);
  const t = (performance.now() % 1600) / 1600;
  ctx.beginPath(); ctx.arc(sx, sy, 8 + t * 18, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(200, 40, 30, ${1 - t})`; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#c0392b"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = '700 14px "PT Sans Narrow", sans-serif'; ctx.fillStyle = "#7a1b12"; ctx.textAlign = "center";
  ctx.fillText("СТРИМЕР", sx, sy - 16);
  draw();                                   // пульсация
}

function drawPick() {
  const [sx, sy] = toScreen(pick.x, pick.y);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(0, 2, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
  // листок-записка на булавке
  ctx.rotate(-0.12);
  ctx.fillStyle = pick.info.water ? "#d9a49b" : "#efe4c8"; ctx.strokeStyle = "#2b2236"; ctx.lineWidth = 1.5;
  ctx.fillRect(-11, -38, 22, 28); ctx.strokeRect(-11, -38, 22, 28);
  ctx.strokeStyle = "rgba(43,34,54,0.5)"; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-7, -31 + i * 6); ctx.lineTo(7, -31 + i * 6); ctx.stroke(); }
  ctx.strokeStyle = "#2b2236"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 0); ctx.stroke();
  ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(0, -38, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------ что в точке
function inRing(r, x, y) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function hit(layer, x, y) {
  const cell = MAP.cells[Math.floor(x / MAP.cell) + "," + Math.floor(y / MAP.cell)];
  const polys = cell && cell[layer];
  if (!polys) return false;
  for (const poly of polys) {
    const rings = typeof poly[0] === "number" ? [poly] : poly;
    let inside = false;
    for (const r of rings) if (inRing(r, x, y)) inside = !inside;
    if (inside) return true;
  }
  return false;
}
function grid(x, y) { return LETTERS[Math.floor(x / GRID)] + (Math.floor(y / GRID) + 1); }
function nearestTown(x, y) {
  let best = null, bd = 1e12;
  for (const l of MAP.labels) {
    if (l.s !== "town") continue;
    const d = (l.x - x) ** 2 + (l.y - y) ** 2;
    if (d < bd) { bd = d; best = l; }
  }
  return best && Math.sqrt(bd) < 1800 ? { name: best.t, d: Math.sqrt(bd) } : null;
}
function describe(x, y) {
  const info = { water: hit("water", x, y), building: null, road: false };
  for (const k of Object.keys(BUILDING)) if (hit(k, x, y)) { info.building = BUILDING[k]; break; }
  info.road = ["primary", "secondary", "tertiary", "trail"].some((k) => hit(k, x, y));
  info.town = nearestTown(x, y);
  return info;
}

function setPick(x, y) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= MAP.w || y >= MAP.h) return;
  pick = { x, y, info: describe(x, y) };
  const i = pick.info;
  $("hint").classList.add("hide");
  $("where").classList.remove("hide");
  $("where").classList.toggle("bad", i.water);
  $("whereMain").textContent = i.water ? "Это вода — выбери место на суше" : "Квадрат " + grid(x, y) + (i.town ? " · у " + cap(i.town.name) : "");
  $("whereSub").textContent = i.water ? "" : (i.building ? "в здании: " + i.building : i.road ? "на дороге" : "на улице")
    + " · " + x + ", " + y + (place === "nearest" ? " · ляжет в ближайший ящик" : "");
  try { TG && TG.HapticFeedback && TG.HapticFeedback.selectionChanged(); } catch (e) {}
  update();
  draw();
}
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();

// ------------------------------------------------------------ жесты: тащить, щипок, тап
const pointers = new Map();
let gesture = null;
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = { moved: false, start: { x: e.clientX, y: e.clientY }, view: { ...view }, dist: pinchDist() };
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) {
    const d = pinchDist(), c = pinchCenter();
    if (gesture.dist) zoomAt(c.x, c.y, (gesture.view.s * d) / gesture.dist / view.s);
    gesture.moved = true;
  } else {
    const dx = e.clientX - gesture.start.x, dy = e.clientY - gesture.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
    if (gesture.moved) { view.x = gesture.view.x - dx / view.s; view.y = gesture.view.y - dy / view.s; draw(); }
  }
});
canvas.addEventListener("pointerup", (e) => {
  pointers.delete(e.pointerId);
  if (gesture && !gesture.moved && pointers.size === 0) {
    const [x, y] = toWorld(e.clientX, e.clientY);
    setPick(x, y);
  }
  if (pointers.size === 0) gesture = null;
  else gesture = { moved: true, start: [...pointers.values()][0], view: { ...view }, dist: pinchDist() };
});
canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });
function pinchDist() { const p = [...pointers.values()]; return p.length < 2 ? 0 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
function pinchCenter() { const p = [...pointers.values()]; return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }; }
function zoomAt(sx, sy, k) {
  const [wx, wy] = toWorld(sx, sy);
  view.s = Math.max(0.012, Math.min(6, view.s * k));
  const [nx, ny] = toWorld(sx, sy);
  view.x += wx - nx; view.y += wy - ny;
  draw();
}
$("zin").onclick = () => zoomAt(W / 2, mapCenterY(), 1.6);
$("zout").onclick = () => zoomAt(W / 2, mapCenterY(), 1 / 1.6);
$("toMe").onclick = () => {
  if (!me) return message("Где стример", "Стример сейчас не в игре — его метки нет. Можно выбрать любое место.");
  view.x = me.x; view.y = me.y; view.s = Math.max(view.s, 0.25); draw();
};

// ------------------------------------------------------------ панель: куда, текст, отправить
function renderPlaces() {
  $("places").innerHTML = "";
  for (const [k, title] of PLACES) {
    const b = document.createElement("button");
    b.className = "chip" + (k === place ? " on" : "");
    b.textContent = title;
    b.onclick = () => { place = k; renderPlaces(); if (pick) setPick(pick.x, pick.y); };
    $("places").appendChild(b);
  }
}
function update() {
  const t = $("text").value.trim();
  $("count").textContent = $("text").value.length + "/" + MAXLEN;
  $("send").disabled = !(pick && !pick.info.water && t.length > 0);
}
$("text").maxLength = MAXLEN;
$("text").addEventListener("input", update);
$("nick").textContent = Q.get("nick") ? "— " + Q.get("nick") : "";
if (me) $("streamer").innerHTML = "Стример сейчас в квадрате <b>" + grid(me.x, me.y) + "</b> — нажми ◎, чтобы найти его";
$("grip").onclick = () => { $("sheet").classList.toggle("min"); setTimeout(draw, 220); };

$("send").onclick = () => {
  if ($("send").disabled) return;
  const data = { v: 1, x: pick.x, y: pick.y, place, text: $("text").value.trim().slice(0, MAXLEN) };
  if (inTelegram) {
    TG.sendData(JSON.stringify(data));                         // окно закроется, бот получит записку
  } else {
    message("Это предпросмотр", "В Telegram сейчас ушло бы:\n" + JSON.stringify(data, null, 1));
  }
};

function message(title, text) {
  $("modalTitle").textContent = title; $("modalBody").textContent = text;
  $("modal").classList.remove("hide");
}
$("modalOk").onclick = () => $("modal").classList.add("hide");
$("helpBtn").onclick = () => message("Как это работает",
  "1. Ткни на карте, где спрятать записку. Можно приблизить двумя пальцами.\n" +
  "2. Выбери, куда положить: «Ближайший ящик» — шкаф, мусорка или бардачок рядом с точкой.\n" +
  "3. Напиши текст и нажми «Спрятать записку».\n\n" +
  "Модератор проверит записку, и она появится в игре. Стример найдёт её с телефоном-«Локатором» и прочитает в эфире.");

if (TG) { try { TG.ready(); TG.expand(); TG.setHeaderColor && TG.setHeaderColor("#121212"); } catch (e) {} }
window.addEventListener("resize", resize);
resize();
renderPlaces();
update();
load().then(() => { window.__ready = true; });
