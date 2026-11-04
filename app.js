/* Nutrition: Tyler's meal plan as an installable web app. Everything is stored on the phone (localStorage). */
(() => {
  "use strict";

  const LS = "nutrition-app-v1";
  const NUTRIENTS = ["cal", "protein", "fat", "carbs"];
  const MACROS = ["protein", "fat", "carbs"];
  const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 };
  const LABELS = { cal: "Calories", protein: "Protein", fat: "Fat", carbs: "Carbs" };
  const MICROS = [
    ["fiber", "Fiber", "g"], ["sugar", "Sugar", "g"], ["satfat", "Saturated fat", "g"],
    ["sodium", "Sodium", "mg"], ["potassium", "Potassium", "mg"], ["calcium", "Calcium", "mg"],
    ["magnesium", "Magnesium", "mg"], ["iron", "Iron", "mg"], ["zinc", "Zinc", "mg"],
    ["selenium", "Selenium", "µg"], ["vitA", "Vitamin A", "µg"], ["vitC", "Vitamin C", "mg"],
    ["vitD", "Vitamin D", "µg"], ["b12", "Vitamin B12", "µg"],
  ];
  const MICRO_IDS = MICROS.map((m) => m[0]);
  const COLORS = [
    ["sage", "Light green"], ["sky", "Light blue"], ["butter", "Yellow"], ["salmon", "Salmon"],
    ["leaf", "Green"], ["blush", "Pink"], ["lavender", "Lavender"], ["sand", "Sand"], ["mint", "Mint"],
  ];
  const COLOR_SET = new Set(COLORS.map((c) => c[0]));
  const FRACTIONS = { "½": 1 / 2, "¼": 1 / 4, "¾": 3 / 4, "⅓": 1 / 3, "⅔": 2 / 3, "⅕": 1 / 5, "⅛": 1 / 8 };
  const EDIT_ICON = '<svg class="edit-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.6 3.6l2.8 2.8L7 15.8l-3.6.8.8-3.6z"/><path d="M11.8 5.4l2.8 2.8"/></svg>';
  const CHEV = '<svg class="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2.5L9.5 7 5 11.5"/></svg>';
  const CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"/></svg>';
  const BACK = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5L4.5 7 9 11.5"/></svg>';
  const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------------------------------------------------------------- state
  let plan = null;
  let copies = [];
  let settings = { showAll: false };
  let backedUpAt = "";
  let canWrite = true;
  let loading = true;
  let view = "plan";
  let copyId = null;
  let cmpA = null;
  let cmpB = "current";
  let microsOpen = false;
  let editing = null;
  let undo = null;
  let undoTimer = 0;
  let copyUndo = null;
  let copyUndoTimer = 0;
  let copyPanel = null;
  let copyPanelMsg = "";
  let toastTimer = 0;

  // ---------------------------------------------------------------- numbers
  // Servings accept plain numbers or small formulas, the way the sheet did: 4*(1/5), (2/3)/5, 1.25/5.
  function evalExpr(input) {
    const s = String(input == null ? "" : input).trim().replace(/^=/, "").replace(/,/g, "");
    if (!s) return NaN;
    let i = 0;
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function number() {
      ws();
      const m = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(s.slice(i));
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      if (Object.prototype.hasOwnProperty.call(FRACTIONS, s[i])) return FRACTIONS[s[i++]];
      throw new Error("number expected");
    }
    function factor() {
      ws();
      const c = s[i];
      if (c === "+") { i++; return factor(); }
      if (c === "-" || c === "−") { i++; return -factor(); }
      if (c === "(") {
        i++;
        const v = expr();
        ws();
        if (s[i] !== ")") throw new Error(") expected");
        i++;
        return v;
      }
      return number();
    }
    function term() {
      let v = factor();
      for (;;) {
        ws();
        const c = s[i];
        if (c === "*" || c === "×" || c === "x" || c === "X") { i++; v *= factor(); }
        else if (c === "/" || c === "÷") { i++; v /= factor(); }
        else return v;
      }
    }
    function expr() {
      let v = term();
      for (;;) {
        ws();
        const c = s[i];
        if (c === "+") { i++; v += term(); }
        else if (c === "-" || c === "−") { i++; v -= term(); }
        else return v;
      }
    }
    try {
      const v = expr();
      ws();
      return i === s.length && Number.isFinite(v) ? v : NaN;
    } catch (e) {
      return NaN;
    }
  }
  const round4 = (n) => Math.round(n * 1e4) / 1e4;
  function qtyOf(food) {
    const v = evalExpr(food.qty);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  const NF0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const NF1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const NF2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const tidy = (n) => (Math.abs(n) < 1e-9 ? 0 : n);
  const f0 = (n) => NF0.format(tidy(Math.round(n)));
  const f1 = (n) => NF1.format(tidy(Math.round(n * 10) / 10));
  const f2 = (n) => NF2.format(tidy(Math.round(n * 100) / 100));
  const signed = (n, fmt) => { const r = tidy(Math.round(n * 10) / 10); return (r > 0 ? "+" : r < 0 ? "−" : "") + fmt(Math.abs(r)); };
  const fmtMicro = (v, unit) => (unit === "g" ? f1(v) : f0(v));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function fmtTime(t) {
    if (!/^\d{2}:\d{2}$/.test(t || "")) return "";
    const h = parseInt(t.slice(0, 2), 10);
    return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? "AM" : "PM"}`;
  }
  function fmtDate(iso, withTime) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString(undefined, withTime
      ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" });
  }
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  // "1.2 servings of 100 g" reads better as "120 g".
  function amountText(serving, q) {
    const m = /^\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*([^\d\s].*)$/.exec(serving || "");
    if (m) {
      const base = evalExpr(m[1]);
      const unit = m[2].trim();
      if (Number.isFinite(base) && base > 0) {
        const amt = q * base;
        const grams = /^(g|grams?|ml)$/i.test(unit);
        return `${grams || amt >= 10 ? f0(amt) : f2(amt)} ${unit}`;
      }
    }
    if (serving) return `${f2(q)} × ${serving}`;
    return `${f2(q)} ${q === 1 ? "serving" : "servings"}`;
  }
  const macroLine = (v) => `P ${f1(v.protein)} · F ${f1(v.fat)} · C ${f1(v.carbs)}`;
  const macroLine0 = (v) => `P ${f0(v.protein)} · F ${f0(v.fat)} · C ${f0(v.carbs)}`;

  // ---------------------------------------------------------------- plan shape
  function newId(prefix) {
    return prefix + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6);
  }
  function text(v, max) {
    if (typeof v === "string") return v.trim().slice(0, max);
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    return "";
  }
  function num(v, fallback) {
    const n = typeof v === "number" ? v : evalExpr(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function qtyText(v) {
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    const s = typeof v === "string" ? v.trim().replace(/^=/, "").slice(0, 40) : "";
    return s || "0";
  }
  function tidyQty(raw) {
    const s = String(raw).trim().replace(/^=/, "");
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return String(parseFloat(s));
    return s.replace(/\s+/g, "");
  }
  function normalizeMicros(m) {
    const out = {};
    if (m && typeof m === "object") {
      for (const id of MICRO_IDS) {
        if (m[id] === "" || m[id] == null) continue;
        const n = num(m[id], NaN);
        if (Number.isFinite(n) && n >= 0) out[id] = n;
      }
    }
    return out;
  }
  function emptyPlan() {
    return { schema: 1, source: "", updatedAt: "", meals: [] };
  }
  function normalize(raw) {
    const p = raw && typeof raw === "object" ? raw : {};
    const seen = new Set();
    const uid = (prefix, id) => {
      const v = typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id) && !seen.has(id) ? id : newId(prefix);
      seen.add(v);
      return v;
    };
    const meals = Array.isArray(p.meals) ? p.meals : [];
    return {
      schema: 1,
      source: text(p.source, 120),
      updatedAt: text(p.updatedAt, 40),
      meals: meals.filter((m) => m && typeof m === "object").map((m) => ({
        id: uid("m", m.id),
        name: text(m.name, 60) || "Meal",
        time: typeof m.time === "string" && /^\d{2}:\d{2}$/.test(m.time) ? m.time : "",
        multiplier: Math.max(0, num(m.multiplier, 1)),
        color: COLOR_SET.has(m.color) ? m.color : "sand",
        foods: (Array.isArray(m.foods) ? m.foods : []).filter((f) => f && typeof f === "object").map((f) => ({
          id: uid("f", f.id),
          name: text(f.name, 80) || "Food",
          serving: text(f.serving, 40),
          cal: num(f.cal, 0),
          protein: num(f.protein, 0),
          fat: num(f.fat, 0),
          carbs: num(f.carbs, 0),
          qty: qtyText(f.qty),
          micros: normalizeMicros(f.micros),
        })),
      })),
    };
  }
  function normalizeCopy(body, fallbackId) {
    const b = body && typeof body === "object" ? body : {};
    const id = typeof b.id === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(b.id) ? b.id : (fallbackId || newId("v"));
    return {
      id,
      name: text(b.name, 80) || "Saved copy",
      note: text(b.note, 240),
      savedAt: text(b.savedAt, 40),
      plan: normalize(b.plan),
    };
  }
  const byNewest = (p, q) => (q.savedAt || "").localeCompare(p.savedAt || "");
  const getCopy = (id) => copies.find((c) => c.id === id) || null;
  const planFor = (ref) => (ref === "current" ? plan : (getCopy(ref) || {}).plan || null);
  const mealIn = (p, id) => (p ? p.meals.find((m) => m.id === id) : null);
  const allFoods = () => (plan ? plan.meals.flatMap((m) => m.foods) : []);
  const visibleFoods = (m) => m.foods.filter((f) => settings.showAll || qtyOf(f) > 0);
  // Meals show in time order; meals without a time go last, in the order they were added.
  function sortedMeals(p) {
    if (!p) return [];
    return p.meals
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        if (a.m.time && b.m.time && a.m.time !== b.m.time) return a.m.time < b.m.time ? -1 : 1;
        if (!!a.m.time !== !!b.m.time) return a.m.time ? -1 : 1;
        return a.i - b.i;
      })
      .map((x) => x.m);
  }
  const visibleMeals = (p) => sortedMeals(p).filter((m) => settings.showAll || m.multiplier > 0);

  // Same arithmetic as the sheet: each meal is SUMPRODUCT(values, servings); the day is SUMPRODUCT(meal totals, meal multipliers).
  function computeTotals(p) {
    const meals = new Map();
    const day = { cal: 0, protein: 0, fat: 0, carbs: 0 };
    const micro = {};
    const microFoods = {};
    let counted = 0;
    let eaten = 0;
    for (const m of p.meals) {
      const t = { cal: 0, protein: 0, fat: 0, carbs: 0 };
      for (const f of m.foods) {
        const q = qtyOf(f);
        for (const k of NUTRIENTS) t[k] += f[k] * q;
        if (q > 0 && m.multiplier > 0) {
          eaten++;
          for (const id of Object.keys(f.micros)) {
            micro[id] = (micro[id] || 0) + f.micros[id] * q * m.multiplier;
            microFoods[id] = (microFoods[id] || 0) + 1;
          }
        }
      }
      meals.set(m.id, t);
      if (m.multiplier > 0) counted++;
      for (const k of NUTRIENTS) day[k] += t[k] * m.multiplier;
    }
    const kcal = {};
    for (const k of MACROS) kcal[k] = day[k] * KCAL_PER_G[k];
    const kcalSum = kcal.protein + kcal.fat + kcal.carbs;
    return { meals, day, kcal, kcalSum, counted, eaten, micro, microFoods };
  }

  // ---------------------------------------------------------------- storage (this phone only)
  function persist() {
    try {
      localStorage.setItem(LS, JSON.stringify({ v: 1, plan, copies, settings, backedUpAt }));
      return true;
    } catch (e) {
      canWrite = false;
      setNotice("This phone isn't letting the app save. Open it from its Home Screen icon (not a private Safari tab), and check that storage isn't full.");
      return false;
    }
  }
  function readSaved() {
    try {
      const raw = localStorage.getItem(LS);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return undefined;
    }
  }
  function requestPersist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* not supported */ }
  }

  // ---------------------------------------------------------------- view plumbing
  function ensureShell(name, html) {
    const v = $("#view");
    if (v.dataset.shell !== name) {
      v.innerHTML = html;
      v.dataset.shell = name;
    }
  }
  function scrollToTop() {
    window.scrollTo(0, 0);
  }
  function go(next, opts) {
    if (editing) closeEditor(false);
    view = next;
    if (opts && "copyId" in opts) copyId = opts.copyId;
    copyPanel = null;
    copyPanelMsg = "";
    render();
    scrollToTop();
    onScroll();
  }
  function render() {
    $("#tab-plan").setAttribute("aria-pressed", String(view === "plan"));
    $("#tab-copies").setAttribute("aria-pressed", String(view !== "plan"));
    $("#copies-count").textContent = copies.length ? String(copies.length) : "";
    if (view === "copy" && !getCopy(copyId)) view = "copies";
    if (view === "plan") renderPlanView();
    else if (view === "copies") renderCopiesView();
    else if (view === "copy") renderCopyView();
    else renderCompareView();
    renderMeta();
  }

  // ---------------------------------------------------------------- summary + micros
  function summaryHTML(p, t, label) {
    const has = !!t;
    const pct = (k) => (has && t.kcalSum > 0 ? (t.kcal[k] / t.kcalSum) * 100 : 0);
    const any = has && t.kcalSum > 0;
    const seg = (k, cls) => `<span class="${cls}" data-macro="${k}" style="flex-grow:${pct(k)}"${pct(k) > 0 ? "" : " hidden"}></span>`;
    const macro = (k, name) => `<div class="macro" data-macro="${k}">
        <dt><span class="key" style="--c: var(--${k})"></span>${name}</dt>
        <dd><span class="g" id="g-${k}">${has ? f0(t.day[k]) : "—"}</span><span class="u"> g</span></dd>
        <dd class="pct">${any ? `${f0(pct(k))}% of kcal` : ""}</dd>
      </div>`;
    return `<section class="card summary" id="summary" aria-labelledby="sum-title">
      <div class="sum-top">
        <h2 class="sum-label" id="sum-title">${esc(label)}</h2>
        <p class="sum-meta">${has && p.meals.length ? `${t.counted} ${t.counted === 1 ? "meal" : "meals"} · ${t.eaten} ${t.eaten === 1 ? "food" : "foods"}` : ""}</p>
      </div>
      <p class="hero"><span class="hero-num" id="cal-total">${has ? f0(t.day.cal) : "—"}</span><span class="hero-unit">kcal</span></p>
      <div class="split${any ? "" : " is-empty"}" role="img" aria-label="${any ? `Calories by macro: protein ${f0(pct("protein"))}%, fat ${f0(pct("fat"))}%, carbs ${f0(pct("carbs"))}%` : "Calories by macro: nothing counted yet"}">${seg("protein", "seg-p")}${seg("fat", "seg-f")}${seg("carbs", "seg-c")}</div>
      <dl class="macros">${macro("protein", "Protein")}${macro("fat", "Fat")}${macro("carbs", "Carbs")}</dl>
    </section>`;
  }
  function microsHTML(t) {
    if (!t) return "";
    const tracked = MICROS.filter(([id]) => t.microFoods[id]);
    if (!tracked.length) return "";
    const rows = tracked.map(([id, name, unit]) => `<li><span>${name}</span><span class="mr-val">${fmtMicro(t.micro[id], unit)} ${unit}</span>
        <span class="mr-cov">From ${t.microFoods[id]} of ${t.eaten} foods. Foods without a value count as 0.</span></li>`).join("");
    return `<details class="card micros" id="micros"${microsOpen ? " open" : ""}>
      <summary>Micronutrients<span class="sum-hint">${tracked.length} tracked</span></summary>
      <ul class="micro-rows">${rows}</ul>
    </details>`;
  }
  function renderMini() {
    const t = plan ? computeTotals(plan) : null;
    $("#mini").innerHTML = view === "plan" && t ? `<b>${f0(t.day.cal)} kcal</b>P ${f0(t.day.protein)} · F ${f0(t.day.fat)} · C ${f0(t.day.carbs)}` : "";
  }

  // ---------------------------------------------------------------- meal list
  function undoRowHTML(card) {
    const inner = `<span>${esc(undo.message)}</span><button type="button" class="link-btn" data-action="undo">Undo</button>`;
    return card ? `<div class="card undo-card" role="status">${inner}</div>` : `<li class="undo-row" role="status">${inner}</li>`;
  }
  function mealListHTML(p, ref) {
    const t = computeTotals(p);
    const current = ref === "current";
    const editable = current && canWrite;
    let hiddenFoods = 0;
    const hiddenMeals = [];
    const cards = [];
    const u = current ? undo : null;
    if (u && u.where.type === "top") cards.push(undoRowHTML(true));
    let vi = 0;
    for (const m of sortedMeals(p)) {
      const off = m.multiplier === 0;
      if (off && !settings.showAll) { hiddenMeals.push(m.name); continue; }
      if (u && u.where.type === "meal" && u.where.index === vi) cards.push(undoRowHTML(true));
      vi++;
      const mt = t.meals.get(m.id);
      const foods = m.foods.filter((f) => {
        const keep = settings.showAll || qtyOf(f) > 0;
        if (!keep) hiddenFoods++;
        return keep;
      });
      const rows = foods.map((f) => {
        const q = qtyOf(f);
        const v = { cal: f.cal * q, protein: f.protein * q, fat: f.fat * q, carbs: f.carbs * q };
        const inner = q > 0
          ? `<span class="food-name">${esc(f.name)}</span><span class="food-kcal">${f0(v.cal)}<small>kcal</small></span>${CHEV}
            <span class="food-amt">${esc(amountText(f.serving, q))}</span><span class="food-mac">${macroLine(v)}</span>`
          : `<span class="food-name">${esc(f.name)}</span><span class="food-kcal"></span>${CHEV}
            <span class="food-amt">Not eating</span><span class="food-mac">${f0(f.cal)} kcal per serving</span>`;
        return `<li data-meal="${esc(m.id)}" data-food="${esc(f.id)}"><button type="button" class="food${q > 0 ? "" : " is-zero"}" data-action="open-food" aria-expanded="false">${inner}</button></li>`;
      });
      if (u && u.where.type === "food" && u.where.mealId === m.id) rows.splice(Math.max(0, Math.min(u.where.index, rows.length)), 0, undoRowHTML(false));
      const tag = off ? `<span class="tag">Not counted</span>` : (m.multiplier !== 1 ? `<span class="tag">×${f2(m.multiplier)}</span>` : "");
      const head = `<span class="mh-title"><span class="dot" style="--dot: var(--c-${m.color})"></span><span class="mh-name" id="mn-${esc(m.id)}">${esc(m.name)}</span>${m.time ? `<span class="mh-time">${fmtTime(m.time)}</span>` : ""}${tag}</span>
        <span class="mh-right"><span class="mh-kcal">${f0(mt.cal)}<small>kcal</small></span>${current ? EDIT_ICON : ""}</span>
        <span class="mh-sub">${macroLine0(mt)}</span>`;
      const headEl = current
        ? `<button type="button" class="meal-head" data-action="open-meal" aria-label="Edit ${esc(m.name)}">${head}</button>`
        : `<div class="meal-head">${head}</div>`;
      const body = rows.length
        ? `<ul class="foods" aria-labelledby="mn-${esc(m.id)}">${rows.join("")}</ul>`
        : `<p class="empty-foods">${m.foods.length ? "Every food here is at 0 servings." : "No foods yet."}</p>`;
      cards.push(`<section class="card meal${off ? " is-off" : ""}" id="meal-${esc(m.id)}" data-meal="${esc(m.id)}">
        ${headEl}
        ${body}
        ${editable ? `<button type="button" class="add-food" data-action="add-food"><span class="plus" aria-hidden="true">+</span>Add food</button>` : ""}
      </section>`);
    }
    if (u && u.where.type === "meal" && u.where.index >= vi) cards.push(undoRowHTML(true));
    let html = cards.join("");
    if (!vi) html += `<p class="card empty">${p.meals.length ? "Every meal is turned off. Switch on “Show 0-serving foods” to see them." : (editable ? "No meals yet. Add your first meal below." : "No meals in this plan.")}</p>`;
    let note = "";
    if (!settings.showAll && (hiddenFoods || hiddenMeals.length)) {
      const parts = [];
      if (hiddenFoods) parts.push(`${hiddenFoods} ${hiddenFoods === 1 ? "food" : "foods"} at 0 servings`);
      if (hiddenMeals.length) parts.push(`${hiddenMeals.map(esc).join(", ")} (not counted)`);
      note = `<span>Hidden: ${parts.join(" and ")}</span><button type="button" class="link-btn" data-action="toggle-all">Show</button>`;
    }
    return { html, note };
  }
  function renderList() {
    const host = $("#meal-list");
    if (!host) return;
    const ref = view === "copy" ? copyId : "current";
    const p = planFor(ref);
    const noteEl = $("#hidden-note");
    const addHost = $("#add-meal-host");
    if (!p) {
      host.innerHTML = `<p class="card empty">${loading ? "Loading your plan…" : "Nothing to show yet."}</p>`;
      if (noteEl) noteEl.hidden = true;
      if (addHost) addHost.innerHTML = "";
      return;
    }
    const out = mealListHTML(p, ref);
    host.innerHTML = out.html;
    if (noteEl) { noteEl.innerHTML = out.note; noteEl.hidden = !out.note; }
    if (addHost) addHost.innerHTML = ref === "current" && canWrite ? `<button type="button" class="add-meal" data-action="add-meal"><span class="plus" aria-hidden="true">+</span>Add meal</button>` : "";
    const sw = $("#show-all");
    if (sw) sw.setAttribute("aria-checked", String(settings.showAll));
  }

  const MEALS_BLOCK = `<div class="section-head"><h2>Meals</h2>
      <button type="button" class="switch" id="show-all" role="switch" aria-checked="false" data-action="toggle-all">Show 0-serving foods<span class="track" aria-hidden="true"></span></button>
    </div>
    <div class="meal-list" id="meal-list"></div>
    <p class="hidden-note" id="hidden-note" hidden></p>`;

  function renderPlanView() {
    ensureShell("plan", `<div id="summary-host"></div><div id="micros-host"></div>${MEALS_BLOCK}<div id="add-meal-host"></div>`);
    const t = plan ? computeTotals(plan) : null;
    $("#summary-host").innerHTML = summaryHTML(plan, t, "Daily total");
    $("#micros-host").innerHTML = microsHTML(t);
    $("#show-all").setAttribute("aria-checked", String(settings.showAll));
    if (!editing) renderList();
    renderMini();
  }

  // ---------------------------------------------------------------- editors (open in place)
  function readNote(ref) {
    if (ref !== "current") return "This is a saved copy, so it can't be changed. To edit it, make it your current plan.";
    return "This phone isn't letting the app save right now, so editing is off.";
  }
  function foodEditorHTML(food, meal, ref, isNew) {
    const ro = ref !== "current" || !canWrite;
    const dis = ro ? " disabled" : "";
    const v = (k) => (food ? esc(String(food[k])) : "");
    const mv = (id) => (food && food.micros[id] != null ? esc(String(food.micros[id])) : "");
    const microCount = food ? Object.keys(food.micros).length : 0;
    const p = planFor(ref);
    const mealOpts = sortedMeals(p).map((m) => `<option value="${esc(m.id)}"${m.id === meal.id ? " selected" : ""}>${esc(m.name)}${m.time ? ` · ${fmtTime(m.time)}` : ""}</option>`).join("");
    const macroHint = food ? `${f1(food.cal)} kcal · ${macroLine(food)}` : "";
    return `<form class="editor" id="editor" data-kind="food" novalidate>
      ${isNew ? `<div class="ed-head"><p class="ed-title">Add food to ${esc(meal.name)}</p><button type="button" class="icon-btn" data-ed="close" aria-label="Close">${CLOSE}</button></div>` : ""}
      ${ro ? `<p class="ro-note">${esc(readNote(ref))}</p>` : ""}
      <div class="servings">
        <label class="field-label" for="ed-qty">Servings</label>
        <div class="qty-row">
          <button type="button" class="step" data-ed="step" data-step="-1" aria-label="One serving less"${dis}>−</button>
          <input id="ed-qty" class="qty-input" inputmode="decimal" autocomplete="off" maxlength="40" enterkeyhint="done" value="${food ? esc(food.qty) : "1"}"${dis}>
          <button type="button" class="step" data-ed="step" data-step="1" aria-label="One serving more"${dis}>+</button>
        </div>
        <p class="result" id="ed-result" aria-live="polite"></p>
        ${ro ? "" : `<div class="chips" role="group" aria-label="Quick amounts">
          <button type="button" data-ed="set" data-set="0">0</button>
          <button type="button" data-ed="set" data-set="0.5" aria-label="Half">½</button>
          <button type="button" data-ed="set" data-set="1">1</button>
          <button type="button" data-ed="set" data-set="2">2</button>
          <button type="button" data-ed="div" data-div="5" aria-label="Divide by 5 for batch prep">÷5</button>
        </div>`}
      </div>
      <details class="group"${isNew ? " open" : ""}>
        <summary><span>Name, serving size, meal</span><span class="g-hint">${food ? esc(food.serving || "No serving size") : ""}</span></summary>
        <div class="group-body">
          <div class="field"><label class="field-label" for="ed-name">Name</label>
            <input id="ed-name" list="food-names" autocomplete="off" autocapitalize="sentences" maxlength="80" enterkeyhint="next" value="${v("name")}"${dis}></div>
          <div class="field"><label class="field-label" for="ed-serving">Serving size</label>
            <input id="ed-serving" autocomplete="off" maxlength="40" placeholder="e.g. 100 g or 1 cup" value="${v("serving")}"${dis}></div>
          <div class="field"><label class="field-label" for="ed-meal">Meal (sets the time)</label>
            <select id="ed-meal"${dis}>${mealOpts}</select></div>
        </div>
      </details>
      <details class="group"${isNew ? " open" : ""}>
        <summary><span>Macros per serving</span><span class="g-hint" id="ed-macro-hint">${esc(macroHint)}</span></summary>
        <div class="group-body pair-grid">
          <label>Calories<input id="ed-cal" inputmode="decimal" autocomplete="off" maxlength="12" value="${v("cal")}"${dis}></label>
          <label><span><span class="key" style="--c: var(--protein)"></span>Protein (g)</span><input id="ed-protein" inputmode="decimal" autocomplete="off" maxlength="12" value="${v("protein")}"${dis}></label>
          <label><span><span class="key" style="--c: var(--fat)"></span>Fat (g)</span><input id="ed-fat" inputmode="decimal" autocomplete="off" maxlength="12" value="${v("fat")}"${dis}></label>
          <label><span><span class="key" style="--c: var(--carbs)"></span>Carbs (g)</span><input id="ed-carbs" inputmode="decimal" autocomplete="off" maxlength="12" value="${v("carbs")}"${dis}></label>
        </div>
      </details>
      <details class="group">
        <summary><span>Micronutrients per serving</span><span class="g-hint" id="ed-micro-hint">${microCount ? `${microCount} entered` : "None entered"}</span></summary>
        <div class="group-body">
          <p class="hint">Leave a field blank if you don't know it.</p>
          <div class="pair-grid">${MICROS.map(([id, name, unit]) => `<label>${name} (${unit})<input id="ed-m-${id}" data-micro="${id}" inputmode="decimal" autocomplete="off" maxlength="12" value="${mv(id)}"${dis}></label>`).join("")}</div>
        </div>
      </details>
      <p class="form-error" id="ed-error" role="alert" hidden></p>
      <div class="ed-foot">
        ${ro ? `<span class="spacer"></span><button type="button" class="btn" data-ed="close">Close</button>`
          : `${isNew ? "" : `<button type="button" class="text-btn danger" data-ed="delete">Delete</button>`}<span class="spacer"></span><button type="button" class="btn" data-ed="close">Cancel</button><button type="submit" class="btn primary">Save</button>`}
      </div>
    </form>`;
  }
  function mealEditorHTML(meal) {
    const ro = !canWrite;
    const dis = ro ? " disabled" : "";
    const color = meal ? meal.color : nextColor();
    const counted = meal ? meal.multiplier > 0 : true;
    return `<form class="editor" id="editor" data-kind="meal" novalidate>
      <div class="ed-head"><p class="ed-title">${meal ? "Edit meal" : "New meal"}</p><button type="button" class="icon-btn" data-ed="close" aria-label="Close">${CLOSE}</button></div>
      ${ro ? `<p class="ro-note">${esc(readNote("current"))}</p>` : ""}
      <div class="field"><label class="field-label" for="ed-mname">Name</label>
        <input id="ed-mname" autocomplete="off" autocapitalize="words" maxlength="60" enterkeyhint="next" value="${meal ? esc(meal.name) : ""}"${dis}></div>
      <div class="field"><label class="field-label" for="ed-mtime">Time</label>
        <div class="time-row"><input id="ed-mtime" type="time" value="${meal ? esc(meal.time) : ""}"${dis}><button type="button" class="text-btn" data-ed="notime"${dis}>No time</button></div></div>
      <div class="field">
        <button type="button" class="switch wide" id="ed-mcount" role="switch" aria-checked="${counted}" data-ed="count" aria-describedby="ed-count-hint"${dis}>Count in daily total<span class="track" aria-hidden="true"></span></button>
        <p class="hint" id="ed-count-hint">Turn off for a meal you're skipping. It stays saved, just left out of the totals.</p>
      </div>
      <fieldset class="field"><legend>Colour</legend>
        <div class="swatches">${COLORS.map(([key, label]) => `<label class="swatch" style="--dot: var(--c-${key})"><input type="radio" name="ed-mcolor" value="${key}" aria-label="${label}"${key === color ? " checked" : ""}${dis}><span></span></label>`).join("")}</div>
      </fieldset>
      <p class="form-error" id="ed-error" role="alert" hidden></p>
      <div class="ed-foot">
        ${ro ? `<span class="spacer"></span><button type="button" class="btn" data-ed="close">Close</button>`
          : `${meal ? `<button type="button" class="text-btn danger" data-ed="delete-meal">Delete meal</button>` : ""}<span class="spacer"></span><button type="button" class="btn" data-ed="close">Cancel</button><button type="submit" class="btn primary">Save</button>`}
      </div>
    </form>`;
  }
  function nextColor() {
    const used = new Set(plan ? plan.meals.map((m) => m.color) : []);
    const free = COLORS.find(([key]) => !used.has(key));
    return free ? free[0] : "sand";
  }

  function openEditor(next) {
    if (editing) closeEditor(false);
    editing = next;
    renderList();
    mountEditor();
  }
  function mountEditor() {
    const e = editing;
    const p = planFor(e.ref);
    const host = $("#meal-list");
    if (!p || !host) { editing = null; return; }
    if (e.kind === "food" || e.kind === "newfood") {
      const meal = mealIn(p, e.mealId);
      if (!meal) { editing = null; renderList(); return; }
      if (e.kind === "food") {
        const food = meal.foods.find((f) => f.id === e.foodId);
        const li = host.querySelector(`li[data-food="${e.foodId}"]`);
        if (!food || !li) { editing = null; renderList(); return; }
        li.classList.add("is-open");
        li.querySelector(".food").setAttribute("aria-expanded", "true");
        li.insertAdjacentHTML("beforeend", foodEditorHTML(food, meal, e.ref, false));
      } else {
        const btn = host.querySelector(`.meal[data-meal="${e.mealId}"] .add-food`);
        if (!btn) { editing = null; return; }
        btn.hidden = true;
        btn.insertAdjacentHTML("afterend", `<div class="editor-wrap">${foodEditorHTML(null, meal, "current", true)}</div>`);
      }
      const names = Array.from(new Set(allFoods().map((f) => f.name))).sort((a, b) => a.localeCompare(b));
      $("#food-names").innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");
      updateResult();
    } else if (e.kind === "meal") {
      const meal = mealIn(plan, e.mealId);
      const head = host.querySelector(`.meal[data-meal="${e.mealId}"] .meal-head`);
      if (!meal || !head) { editing = null; return; }
      head.insertAdjacentHTML("afterend", `<div class="editor-wrap">${mealEditorHTML(meal)}</div>`);
    } else if (e.kind === "newmeal") {
      const addHost = $("#add-meal-host");
      if (!addHost) { editing = null; return; }
      addHost.innerHTML = `<div class="card">${mealEditorHTML(null)}</div>`;
    }
    const form = $("#editor");
    if (!form) return;
    form.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    if (e.kind === "newfood") setTimeout(() => { const n = $("#ed-name"); if (n) n.focus(); }, 60);
    if (e.kind === "newmeal") setTimeout(() => { const n = $("#ed-mname"); if (n) n.focus(); }, 60);
  }
  function closeEditor(rerender = true) {
    editing = null;
    if (rerender && (view === "plan" || view === "copy")) renderList();
  }
  function showEdError(message, focusSel) {
    const el = $("#ed-error");
    if (!el) return false;
    el.textContent = message || "";
    el.hidden = !message;
    if (message && focusSel) {
      const f = $(focusSel);
      if (f) {
        const d = f.closest("details");
        if (d) d.open = true;
        f.focus();
      }
    }
    return false;
  }
  function updateResult() {
    const out = $("#ed-result");
    if (!out) return;
    const raw = $("#ed-qty").value.trim();
    const q = raw ? evalExpr(raw) : 0;
    if (!Number.isFinite(q) || q < 0) {
      out.textContent = "Use a number like 1.5, or a formula like 4/5.";
      out.classList.add("is-bad");
      return;
    }
    out.classList.remove("is-bad");
    const per = {};
    for (const k of NUTRIENTS) {
      const n = evalExpr($(`#ed-${k}`).value);
      per[k] = Number.isFinite(n) ? n : 0;
    }
    const v = {};
    for (const k of NUTRIENTS) v[k] = per[k] * q;
    const amt = q > 0 ? amountText($("#ed-serving").value.trim(), q) : "Not eating";
    out.innerHTML = `${esc(amt)} · <b>${f0(v.cal)} kcal</b> · ${macroLine(v)}`;
    const mh = $("#ed-macro-hint");
    if (mh) mh.textContent = `${f1(per.cal)} kcal · ${macroLine(per)}`;
    const microHint = $("#ed-micro-hint");
    if (microHint) {
      const n = $$("#editor [data-micro]").filter((i) => i.value.trim()).length;
      microHint.textContent = n ? `${n} entered` : "None entered";
    }
  }
  function autofillFromName(input) {
    if (!editing || editing.kind !== "newfood") return;
    const name = input.value.trim().toLowerCase();
    if (!name) return;
    const matches = allFoods().filter((f) => f.name.toLowerCase() === name);
    if (!matches.length) return;
    const best = matches.find((f) => f.serving) || matches[0];
    if (input.value !== best.name) input.value = best.name;
    if (NUTRIENTS.every((k) => !$(`#ed-${k}`).value.trim())) {
      for (const k of NUTRIENTS) $(`#ed-${k}`).value = String(best[k]);
    }
    if (MICRO_IDS.every((id) => !$(`#ed-m-${id}`).value.trim())) {
      for (const id of MICRO_IDS) if (best.micros[id] != null) $(`#ed-m-${id}`).value = String(best.micros[id]);
    }
    if (!$("#ed-serving").value.trim() && best.serving) $("#ed-serving").value = best.serving;
    updateResult();
  }

  function saveFood() {
    const e = editing;
    const name = $("#ed-name").value.trim();
    const qtyRaw = $("#ed-qty").value.trim() || "0";
    const q = evalExpr(qtyRaw);
    const vals = {};
    for (const k of NUTRIENTS) {
      const raw = $(`#ed-${k}`).value.trim();
      vals[k] = raw ? evalExpr(raw) : 0;
    }
    if (!name) return showEdError("Give the food a name.", "#ed-name");
    if (!Number.isFinite(q) || q < 0) return showEdError("Servings needs a number like 1.5, or a formula like 4/5.", "#ed-qty");
    const bad = NUTRIENTS.find((k) => !Number.isFinite(vals[k]) || vals[k] < 0);
    if (bad) return showEdError(`${LABELS[bad]} needs a number of 0 or more.`, `#ed-${bad}`);
    const micros = {};
    for (const [id, label] of MICROS) {
      const raw = $(`#ed-m-${id}`).value.trim();
      if (!raw) continue;
      const n = evalExpr(raw);
      if (!Number.isFinite(n) || n < 0) return showEdError(`${label} needs a number of 0 or more, or leave it blank.`, `#ed-m-${id}`);
      micros[id] = round4(n);
    }
    const serving = $("#ed-serving").value.trim().slice(0, 40);
    const targetId = $("#ed-meal").value;
    const { mealId, foodId } = e;
    if (!mealIn(plan, targetId) && !mealIn(plan, mealId)) return showEdError("That meal was removed. Cancel and pick another meal.");
    const fromMeal = mealIn(plan, mealId);
    const existing = foodId && fromMeal ? fromMeal.foods.find((f) => f.id === foodId) : null;
    const hiding = q === 0 && !settings.showAll && (!existing || qtyOf(existing) > 0);
    let where = null;
    if (hiding) {
      const target = mealIn(plan, targetId) || fromMeal;
      const vis = visibleFoods(target);
      const idx = existing ? vis.findIndex((f) => f.id === existing.id) : -1;
      where = { type: "food", mealId: target.id, index: idx >= 0 ? idx : vis.length };
    }
    closeEditor(false);
    commit((p) => {
      const from = p.meals.find((m) => m.id === mealId);
      const to = p.meals.find((m) => m.id === targetId) || from;
      let food = null;
      if (foodId && from) {
        const idx = from.foods.findIndex((f) => f.id === foodId);
        if (idx >= 0) {
          food = from.foods[idx];
          if (to !== from) { from.foods.splice(idx, 1); to.foods.push(food); }
        }
      }
      // Adding a food that's already in this meal at 0 servings brings that one back instead of duplicating it.
      if (!food) food = to.foods.find((f) => f.name.toLowerCase() === name.toLowerCase() && qtyOf(f) === 0) || null;
      if (!food) { food = { id: newId("f") }; to.foods.push(food); }
      food.name = name.slice(0, 80);
      food.serving = serving;
      for (const k of NUTRIENTS) food[k] = round4(vals[k]);
      food.qty = tidyQty(qtyRaw);
      food.micros = micros;
    }, hiding ? { undo: `${name} is at 0 servings, so it's hidden.`, where } : null);
  }
  function deleteFood() {
    const { mealId, foodId } = editing;
    const meal = mealIn(plan, mealId);
    const food = meal && meal.foods.find((f) => f.id === foodId);
    if (!food) return;
    const idx = visibleFoods(meal).findIndex((f) => f.id === foodId);
    closeEditor(false);
    commit((p) => {
      const m = p.meals.find((x) => x.id === mealId);
      if (m) m.foods = m.foods.filter((f) => f.id !== foodId);
    }, { undo: `Deleted ${food.name} from ${meal.name}.`, where: { type: "food", mealId, index: Math.max(0, idx) } });
  }
  function saveMeal() {
    const e = editing;
    const name = $("#ed-mname").value.trim();
    const time = $("#ed-mtime").value;
    const counted = $("#ed-mcount").getAttribute("aria-checked") === "true";
    const checked = $('input[name="ed-mcolor"]:checked');
    const color = checked && COLOR_SET.has(checked.value) ? checked.value : "sand";
    if (!name) return showEdError("Give the meal a name.", "#ed-mname");
    const id = e.kind === "meal" ? e.mealId : null;
    const before = id ? mealIn(plan, id) : null;
    const hiding = !!before && before.multiplier > 0 && !counted && !settings.showAll;
    const where = hiding ? { type: "meal", index: Math.max(0, visibleMeals(plan).findIndex((m) => m.id === id)) } : null;
    let createdId = null;
    closeEditor(false);
    commit((p) => {
      let m = id ? p.meals.find((x) => x.id === id) : null;
      if (!m) {
        m = { id: newId("m"), name: "", time: "", multiplier: 1, color: "sand", foods: [] };
        p.meals.push(m);
        createdId = m.id;
      }
      m.name = name.slice(0, 60);
      m.time = /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : "";
      m.multiplier = counted ? (m.multiplier > 0 ? m.multiplier : 1) : 0;
      m.color = color;
    }, hiding ? { undo: `${name} isn't counted now, so it's hidden.`, where } : null);
    if (createdId) requestAnimationFrame(() => gotoMeal(createdId));
  }
  function deleteMeal() {
    const id = editing.mealId;
    const meal = mealIn(plan, id);
    if (!meal) return;
    const n = meal.foods.length;
    const index = Math.max(0, visibleMeals(plan).findIndex((m) => m.id === id));
    closeEditor(false);
    commit((p) => { p.meals = p.meals.filter((m) => m.id !== id); },
      { undo: `Deleted ${meal.name}${n ? ` and its ${n} ${n === 1 ? "food" : "foods"}` : ""}.`, where: { type: "meal", index } });
  }

  // ---------------------------------------------------------------- changing the plan
  function setUndo(message, before, where) {
    clearTimeout(undoTimer);
    undo = { message, before, where: where || { type: "top" } };
    undoTimer = setTimeout(() => {
      undo = null;
      if (!editing && view === "plan") renderList();
    }, 9000);
  }
  function commit(mutate, opts) {
    if (!canWrite || !plan) return false;
    const before = JSON.stringify(plan);
    mutate(plan);
    plan.updatedAt = new Date().toISOString();
    if (opts && opts.undo) setUndo(opts.undo, before, opts.where);
    else if (undo) { undo = null; clearTimeout(undoTimer); }
    persist();
    render();
    return true;
  }
  function doUndo() {
    if (!undo || !canWrite) return;
    plan = normalize(JSON.parse(undo.before));
    plan.updatedAt = new Date().toISOString();
    undo = null;
    clearTimeout(undoTimer);
    if (editing) closeEditor(false);
    persist();
    render();
  }

  // ---------------------------------------------------------------- saved copies
  function saveCopy(name, note) {
    if (!canWrite || !plan) return null;
    const snapshot = normalize(JSON.parse(JSON.stringify(plan)));
    const t = computeTotals(snapshot);
    const r1 = (n) => Math.round(n * 10) / 10;
    const c = {
      id: "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.slice(0, 80),
      note: note.slice(0, 240),
      savedAt: new Date().toISOString(),
      plan: snapshot,
      totals: { cal: r1(t.day.cal), protein: r1(t.day.protein), fat: r1(t.day.fat), carbs: r1(t.day.carbs) },
    };
    copies.unshift(c);
    copies.sort(byNewest);
    return persist() ? c.id : null;
  }
  const defaultCopyName = () => `Copy · ${fmtDate(new Date().toISOString(), false)}`;
  function copyItemHTML(c) {
    const t = computeTotals(c.plan);
    return `<button type="button" class="card copy-item" data-action="open-copy" data-id="${esc(c.id)}">
      <span class="ci-top"><span class="ci-name">${esc(c.name)}</span><span class="ci-date">${esc(fmtDate(c.savedAt, false))}</span></span>
      <span class="ci-tot">${f0(t.day.cal)} kcal · P ${f0(t.day.protein)} · F ${f0(t.day.fat)} · C ${f0(t.day.carbs)}</span>
      ${c.note ? `<span class="ci-note">${esc(c.note)}</span>` : ""}
    </button>`;
  }
  function renderCopiesView() {
    ensureShell("copies", `<section class="card pad">
        <h2 class="card-title">Save a copy of your current plan</h2>
        <p class="hint">Keeps every food and amount as it is right now, so you can look back at it and compare.</p>
        <form class="save-form" id="save-form" novalidate>
          <label class="field-label" for="copy-name">Name</label>
          <input id="copy-name" maxlength="80" autocomplete="off" enterkeyhint="next">
          <label class="field-label" for="copy-note">Note (optional)</label>
          <input id="copy-note" maxlength="240" autocomplete="off" placeholder="e.g. Week 1 of the lean bulk" enterkeyhint="done">
          <p class="form-msg" id="save-msg" role="status"></p>
          <button type="submit" class="btn primary" id="save-copy-btn">Save copy</button>
        </form>
      </section>
      <div class="section-head"><h2>Saved copies</h2></div>
      <div class="copy-list" id="copies-list"></div>
      <section class="card pad backup" aria-labelledby="backup-title">
        <h2 class="card-title" id="backup-title">Backup</h2>
        <p class="hint" id="backup-hint"></p>
        <div class="backup-row"><div><div class="k">Back up everything</div><div class="d">Your current plan and every saved copy, as one file you can keep in Files or send to yourself.</div></div><button type="button" class="btn small" data-action="backup">Back up</button></div>
        <div class="backup-row"><div><div class="k">Restore a backup</div><div class="d">Your current plan is saved as a copy first, then replaced. Saved copies from the backup are added.</div></div><label class="btn small" for="restore-file">Restore<input type="file" id="restore-file" accept=".json,application/json" class="sr"></label></div>
        <div class="backup-row"><div><div class="k">Export for Excel</div><div class="d">The current plan as a spreadsheet file: one row per food with servings, calories and macros.</div></div><button type="button" class="btn small" data-action="csv">CSV</button></div>
        <p class="form-msg" id="restore-msg" role="status"></p>
      </section>`);
    $("#copy-name").placeholder = defaultCopyName();
    $("#save-copy-btn").disabled = !(canWrite && plan);
    $("#backup-hint").textContent = backedUpAt
      ? `Everything lives on this phone. Last backup: ${fmtDate(backedUpAt, true)}.`
      : "Everything lives on this phone, and deleting the app's icon deletes it. Back up now and then.";
    const host = $("#copies-list");
    let html = "";
    if (copyUndo) html += `<div class="card undo-card" role="status"><span>Deleted “${esc(copyUndo.copy.name)}”.</span><button type="button" class="link-btn" data-action="copy-undo">Undo</button></div>`;
    if (!copies.length) html += `<p class="card empty">No saved copies yet. Save one above to start a history.</p>`;
    else html += copies.map(copyItemHTML).join("");
    host.innerHTML = html;
  }

  function copyPanelHTML(c) {
    const msg = copyPanelMsg ? `<p class="form-msg is-bad">${esc(copyPanelMsg)}</p>` : "";
    if (copyPanel === "restore") {
      return `<div class="panel"><p>Make “${esc(c.name)}” your current plan? Your current plan is saved as a copy first, so nothing is lost.</p>${msg}
        <div class="panel-actions"><button type="button" class="btn primary" data-action="confirm-restore">Make it current</button><button type="button" class="btn" data-action="cancel-panel">Cancel</button></div></div>`;
    }
    if (copyPanel === "delete") {
      return `<div class="panel"><p>Delete this saved copy? You can undo right after.</p>${msg}
        <div class="panel-actions"><button type="button" class="btn primary" data-action="confirm-delete">Delete copy</button><button type="button" class="btn" data-action="cancel-panel">Cancel</button></div></div>`;
    }
    if (copyPanel === "rename") {
      return `<form class="panel" id="rename-form" novalidate><label class="field-label" for="rename-input">Name</label>
        <input id="rename-input" maxlength="80" autocomplete="off" value="${esc(c.name)}" enterkeyhint="done">${msg}
        <div class="panel-actions"><button type="submit" class="btn primary">Save name</button><button type="button" class="btn" data-action="cancel-panel">Cancel</button></div></form>`;
    }
    return "";
  }
  function setCopyPanel(next, msg) {
    copyPanel = next;
    copyPanelMsg = msg || "";
    const c = getCopy(copyId);
    const host = $("#copy-panel");
    if (host && c) host.innerHTML = copyPanelHTML(c);
    const input = $("#rename-input");
    if (input) { input.focus(); input.select(); }
  }
  function renderCopyView() {
    const c = getCopy(copyId);
    if (!c) return renderCopiesView();
    ensureShell("copy", `<div class="card pad">
        <button type="button" class="back" data-action="back-copies">${BACK}Saved copies</button>
        <div id="copy-head-host"></div>
        <div id="copy-panel"></div>
      </div>
      <div id="summary-host"></div><div id="micros-host"></div>${MEALS_BLOCK}`);
    $("#copy-head-host").innerHTML = `<h2 class="copy-title">${esc(c.name)}</h2>
      <p class="copy-meta">Saved ${esc(fmtDate(c.savedAt, true))}${c.note ? ` · ${esc(c.note)}` : ""}</p>
      <div class="copy-actions">
        <button type="button" class="btn primary" data-action="compare-copy">Compare with current</button>
        <button type="button" class="btn" data-action="restore-copy"${canWrite ? "" : " disabled"}>Make current</button>
        <div class="copy-links">
          <button type="button" class="text-btn" data-action="rename-copy"${canWrite ? "" : " disabled"}>Rename</button>
          <button type="button" class="text-btn danger" data-action="delete-copy"${canWrite ? "" : " disabled"}>Delete</button>
        </div>
      </div>`;
    if (!$("#rename-input")) $("#copy-panel").innerHTML = copyPanelHTML(c);
    const t = computeTotals(c.plan);
    $("#summary-host").innerHTML = summaryHTML(c.plan, t, "Daily total in this copy");
    $("#micros-host").innerHTML = microsHTML(t);
    if (!editing) renderList();
  }

  // ---------------------------------------------------------------- compare
  function foodEntries(p) {
    const map = new Map();
    for (const m of p.meals) {
      for (const f of m.foods) {
        const eff = qtyOf(f) * m.multiplier;
        const key = `${m.name.toLowerCase()}|${f.name.toLowerCase()}`;
        const e = map.get(key) || { meal: m.name, name: f.name, serving: f.serving, eff: 0, kcal: 0, per: f };
        e.eff += eff;
        e.kcal += f.cal * eff;
        map.set(key, e);
      }
    }
    return map;
  }
  function compareHTML(a, b, nameA, nameB) {
    const ta = computeTotals(a);
    const tb = computeTotals(b);
    const row = (label, unit, va, vb, fmt) => {
      const d = vb - va;
      const zero = Math.abs(d) < 0.05;
      return `<tr><th scope="row">${label}${unit ? ` <span class="unit">${unit}</span>` : ""}</th><td>${fmt(va)}</td><td>${fmt(vb)}</td><td class="delta${zero ? " zero" : ""}">${zero ? "0" : signed(d, fmt)}</td></tr>`;
    };
    let rows = row("Calories", "kcal", ta.day.cal, tb.day.cal, f0)
      + row("Protein", "g", ta.day.protein, tb.day.protein, f0)
      + row("Fat", "g", ta.day.fat, tb.day.fat, f0)
      + row("Carbs", "g", ta.day.carbs, tb.day.carbs, f0);
    for (const [id, name, unit] of MICROS) {
      if (!ta.microFoods[id] && !tb.microFoods[id]) continue;
      const fmt = unit === "g" ? f1 : f0;
      rows += row(name, unit, ta.micro[id] || 0, tb.micro[id] || 0, fmt);
    }
    const mealRows = [];
    const seen = new Set();
    for (const m of [...sortedMeals(b), ...sortedMeals(a)]) {
      const key = m.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const ma = a.meals.find((x) => x.name.toLowerCase() === key);
      const mb = b.meals.find((x) => x.name.toLowerCase() === key);
      const ka = ma ? ta.meals.get(ma.id).cal * ma.multiplier : 0;
      const kb = mb ? tb.meals.get(mb.id).cal * mb.multiplier : 0;
      if (!ka && !kb) continue;
      mealRows.push(row(esc(m.name), "", ka, kb, f0));
    }
    const ea = foodEntries(a);
    const eb = foodEntries(b);
    const changes = [];
    for (const key of new Set([...ea.keys(), ...eb.keys()])) {
      const x = ea.get(key);
      const y = eb.get(key);
      const qa = x ? x.eff : 0;
      const qb = y ? y.eff : 0;
      if (!qa && !qb) continue;
      const dk = (y ? y.kcal : 0) - (x ? x.kcal : 0);
      const ref = y || x;
      let tag = "";
      let what = "";
      if (!qa) { tag = "Added"; what = `${amountText(y.serving, qb)} in ${ref.meal}`; }
      else if (!qb) { tag = "Removed"; what = `Was ${amountText(x.serving, qa)} in ${ref.meal}`; }
      else if (Math.abs(qa - qb) > 1e-6) { tag = qb > qa ? "More" : "Less"; what = `${amountText(x.serving, qa)} → ${amountText(y.serving, qb)} in ${ref.meal}`; }
      else if (NUTRIENTS.some((k) => Math.abs(x.per[k] - y.per[k]) > 1e-6)) { tag = "Updated"; what = `Nutrition per serving changed, in ${ref.meal}`; }
      else continue;
      changes.push({ name: ref.name, tag, what, dk });
    }
    changes.sort((p, q) => Math.abs(q.dk) - Math.abs(p.dk));
    const changeList = changes.length
      ? `<ul class="change-list">${changes.map((c) => `<li><span class="ch-name"><span class="ch-tag">${c.tag}</span>${esc(c.name)}</span><span class="ch-kcal">${Math.abs(c.dk) < 0.5 ? "0" : signed(c.dk, f0)} kcal</span><span class="ch-what">${esc(c.what)}</span></li>`).join("")}</ul>`
      : `<p class="empty">No differences in what you eat.</p>`;
    return `<section class="card pad">
        <p class="cmp-legend"><span><b>A</b> ${esc(nameA)}</span><span><b>B</b> ${esc(nameB)}</span></p>
      </section>
      <section class="card pad">
        <h2 class="card-title">Daily totals</h2>
        <table class="cmp-table"><thead><tr><th scope="col"><span class="vh">Nutrient</span></th><th scope="col">A</th><th scope="col">B</th><th scope="col">B − A</th></tr></thead><tbody>${rows}</tbody></table>
      </section>
      <section class="card pad">
        <h2 class="card-title">Calories by meal</h2>
        <table class="cmp-table"><thead><tr><th scope="col"><span class="vh">Meal</span></th><th scope="col">A</th><th scope="col">B</th><th scope="col">B − A</th></tr></thead><tbody>${mealRows.join("") || `<tr><td colspan="4">No counted meals.</td></tr>`}</tbody></table>
      </section>
      <section class="card">
        <div class="pad" style="padding-bottom:6px"><h2 class="card-title">What changed</h2><p class="hint">From A to B, counting only foods you eat in counted meals.</p></div>
        ${changeList}
      </section>`;
  }
  function refLabel(ref) {
    if (ref === "current") return "Current plan";
    const c = getCopy(ref);
    return c ? `${c.name} (${fmtDate(c.savedAt, false)})` : "Missing copy";
  }
  function renderCompareView() {
    ensureShell("compare", `<div class="card pad">
        <button type="button" class="back" data-action="back-from-compare">${BACK}Back</button>
        <h2 class="copy-title">Compare</h2>
        <div class="cmp-pick" style="margin-top:12px">
          <label>A<select id="cmp-a"></select></label>
          <label>B<select id="cmp-b"></select></label>
        </div>
      </div>
      <div class="view" id="compare-host"></div>`);
    if (cmpA !== "current" && !getCopy(cmpA)) cmpA = copies[0] ? copies[0].id : "current";
    if (cmpB !== "current" && !getCopy(cmpB)) cmpB = "current";
    const opts = (sel) => [`<option value="current"${sel === "current" ? " selected" : ""}>Current plan</option>`]
      .concat(copies.map((c) => `<option value="${esc(c.id)}"${sel === c.id ? " selected" : ""}>${esc(c.name)} · ${esc(fmtDate(c.savedAt, false))}</option>`)).join("");
    $("#cmp-a").innerHTML = opts(cmpA);
    $("#cmp-b").innerHTML = opts(cmpB);
    const a = planFor(cmpA);
    const b = planFor(cmpB);
    $("#compare-host").innerHTML = a && b ? compareHTML(a, b, refLabel(cmpA), refLabel(cmpB)) : `<p class="card empty">Nothing to compare yet.</p>`;
  }

  // ---------------------------------------------------------------- backup, restore, export
  function downloadBlob(filename, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }
  // On iPhone the share sheet is the natural way to put a file in Files or send it; fall back to a download.
  function saveFile(filename, data, type, onDone) {
    let file = null;
    try { file = new File([data], filename, { type }); } catch (e) { file = null; }
    let canShareFile = false;
    try { canShareFile = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canShareFile = false; }
    if (canShareFile && navigator.share) {
      navigator.share({ files: [file], title: filename })
        .then(() => onDone && onDone(true))
        .catch((e) => { if (e && e.name === "AbortError") return; downloadBlob(filename, data, type); if (onDone) onDone(true); });
      return;
    }
    downloadBlob(filename, data, type);
    if (onDone) onDone(true);
  }
  function backupAll() {
    const data = JSON.stringify({ app: "nutrition", v: 1, exportedAt: new Date().toISOString(), plan, copies }, null, 1);
    saveFile(`nutrition-backup-${todayStr()}.json`, data, "application/json", () => {
      backedUpAt = new Date().toISOString();
      persist();
      if (view === "copies") renderCopiesView();
      toast("Backup ready");
    });
  }
  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function exportCsv() {
    if (!plan) return;
    const lines = [["Meal", "Time", "Counted", "Food", "Serving size", "Servings", "Calories per serving", "Protein per serving (g)", "Fat per serving (g)", "Carbs per serving (g)", "Calories eaten", "Protein eaten (g)", "Fat eaten (g)", "Carbs eaten (g)"]];
    for (const m of sortedMeals(plan)) {
      for (const f of m.foods) {
        const q = qtyOf(f);
        lines.push([m.name, fmtTime(m.time), m.multiplier > 0 ? "yes" : "no", f.name, f.serving, round4(q), f.cal, f.protein, f.fat, f.carbs,
          round4(f.cal * q), round4(f.protein * q), round4(f.fat * q), round4(f.carbs * q)]);
      }
    }
    const t = computeTotals(plan);
    lines.push([]);
    lines.push(["Daily total", "", "", "", "", "", "", "", "", "", round4(t.day.cal), round4(t.day.protein), round4(t.day.fat), round4(t.day.carbs)]);
    saveFile(`nutrition-${todayStr()}.csv`, lines.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv", () => toast("Spreadsheet ready"));
  }
  function restoreFromFile(file) {
    const msg = $("#restore-msg");
    const reader = new FileReader();
    reader.onload = () => {
      let o = null;
      try { o = JSON.parse(String(reader.result)); } catch (e) { o = null; }
      if (!o || typeof o !== "object" || !o.plan || !Array.isArray(o.plan.meals)) {
        if (msg) { msg.classList.add("is-bad"); msg.textContent = "That file isn't a Nutrition backup."; }
        return;
      }
      if (plan && plan.meals.length) saveCopy("Before restoring a backup", "Saved automatically before a restore.");
      plan = normalize(o.plan);
      plan.updatedAt = new Date().toISOString();
      const have = new Set(copies.map((c) => c.id));
      for (const c of Array.isArray(o.copies) ? o.copies : []) {
        const n = normalizeCopy(c);
        if (!have.has(n.id)) { copies.push(n); have.add(n.id); }
      }
      copies.sort(byNewest);
      persist();
      toast("Backup restored");
      go("plan");
    };
    reader.onerror = () => { if (msg) { msg.classList.add("is-bad"); msg.textContent = "That file couldn't be read."; } };
    reader.readAsText(file);
  }

  // ---------------------------------------------------------------- meta, notices, toast
  function renderMeta() {
    const parts = [];
    if (plan && plan.updatedAt) {
      const d = new Date(plan.updatedAt);
      if (!isNaN(d)) parts.push(`Current plan last changed ${d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`);
    }
    parts.push("Saved on this phone");
    $("#meta").textContent = parts.join(" · ");
  }
  function setNotice(message) {
    const el = $("#notice");
    el.textContent = message || "";
    el.hidden = !message;
  }
  function toast(message, buttonLabel, onButton) {
    const el = $("#toast");
    $("#toast-text").textContent = message;
    const btn = $("#toast-btn");
    btn.textContent = buttonLabel || "";
    btn.onclick = onButton || null;
    el.hidden = false;
    clearTimeout(toastTimer);
    if (!buttonLabel) toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- events
  function gotoMeal(id) {
    const el = document.getElementById(`meal-${id}`);
    if (el) el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  }
  function toggleShowAll() {
    if (editing) closeEditor(false);
    settings.showAll = !settings.showAll;
    persist();
    render();
    onScroll();
  }

  document.addEventListener("click", (e) => {
    const target = e.target;
    const form = target.closest("#editor");
    if (form) {
      const b = target.closest("button");
      if (!b || b.disabled) return;
      const act = b.dataset.ed;
      if (act === "close") { closeEditor(); return; }
      if (act === "set") { $("#ed-qty").value = b.dataset.set; updateResult(); return; }
      if (act === "step") {
        const v = evalExpr($("#ed-qty").value);
        $("#ed-qty").value = String(round4(Math.max(0, (Number.isFinite(v) ? v : 0) + Number(b.dataset.step))));
        updateResult();
        return;
      }
      if (act === "div") {
        const cur = tidyQty($("#ed-qty").value || "1");
        $("#ed-qty").value = /^[\d.]+$/.test(cur) ? `${cur}/${b.dataset.div}` : `(${cur})/${b.dataset.div}`;
        updateResult();
        return;
      }
      if (act === "delete") { deleteFood(); return; }
      if (act === "delete-meal") { deleteMeal(); return; }
      if (act === "notime") { $("#ed-mtime").value = ""; return; }
      if (act === "count") { b.setAttribute("aria-checked", String(b.getAttribute("aria-checked") !== "true")); return; }
      return;
    }
    const el = target.closest("[data-action]");
    if (!el || el.disabled) return;
    const action = el.dataset.action;
    if (action === "tab") { const next = el.dataset.tab === "plan" ? "plan" : "copies"; if (next !== view) go(next); return; }
    if (action === "toggle-all") { toggleShowAll(); return; }
    if (action === "undo") { doUndo(); return; }
    if (action === "open-food") {
      const li = el.closest("li[data-food]");
      const ref = view === "copy" ? copyId : "current";
      if (editing && editing.kind === "food" && editing.foodId === li.dataset.food) { closeEditor(); return; }
      openEditor({ kind: "food", ref, mealId: li.dataset.meal, foodId: li.dataset.food });
      return;
    }
    if (action === "open-meal") {
      const card = el.closest(".meal");
      if (editing && editing.kind === "meal" && editing.mealId === card.dataset.meal) { closeEditor(); return; }
      openEditor({ kind: "meal", ref: "current", mealId: card.dataset.meal });
      return;
    }
    if (action === "add-food") { openEditor({ kind: "newfood", ref: "current", mealId: el.closest(".meal").dataset.meal }); return; }
    if (action === "add-meal") { openEditor({ kind: "newmeal", ref: "current" }); return; }
    if (action === "open-copy") { go("copy", { copyId: el.dataset.id }); return; }
    if (action === "back-copies") { go("copies"); return; }
    if (action === "back-from-compare") { if (cmpA !== "current" && getCopy(cmpA)) go("copy", { copyId: cmpA }); else go("copies"); return; }
    if (action === "compare-copy") { cmpA = copyId; cmpB = "current"; go("compare"); return; }
    if (action === "restore-copy") { setCopyPanel("restore"); return; }
    if (action === "delete-copy") { setCopyPanel("delete"); return; }
    if (action === "rename-copy") { setCopyPanel("rename"); return; }
    if (action === "cancel-panel") { setCopyPanel(null); return; }
    if (action === "confirm-restore") { restoreCopy(); return; }
    if (action === "confirm-delete") { deleteCopy(); return; }
    if (action === "copy-undo") { undoDeleteCopy(); return; }
    if (action === "backup") { backupAll(); return; }
    if (action === "csv") { exportCsv(); return; }
  });
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === "editor" && editing) {
      if (editing.ref !== "current" || !canWrite) return;
      if (editing.kind === "food" || editing.kind === "newfood") saveFood();
      else saveMeal();
    } else if (f.id === "save-form") {
      submitCopy();
    } else if (f.id === "rename-form") {
      renameCopy();
    }
  });
  document.addEventListener("input", (e) => {
    if (!e.target.closest("#editor")) return;
    if (e.target.id === "ed-name") autofillFromName(e.target);
    updateResult();
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "cmp-a") { cmpA = e.target.value; renderCompareView(); }
    else if (e.target.id === "cmp-b") { cmpB = e.target.value; renderCompareView(); }
    else if (e.target.id === "restore-file" && e.target.files && e.target.files[0]) { restoreFromFile(e.target.files[0]); e.target.value = ""; }
  });
  document.addEventListener("toggle", (e) => { if (e.target && e.target.id === "micros") microsOpen = e.target.open; }, true);

  function submitCopy() {
    const msg = $("#save-msg");
    const name = $("#copy-name").value.trim() || defaultCopyName();
    const note = $("#copy-note").value.trim();
    const id = saveCopy(name, note);
    if (!id) {
      msg.classList.add("is-bad");
      msg.textContent = "The copy couldn't be saved on this phone.";
      return;
    }
    $("#copy-name").value = "";
    $("#copy-note").value = "";
    msg.classList.remove("is-bad");
    msg.textContent = `Saved “${name}”.`;
    render();
  }
  function renameCopy() {
    const c = getCopy(copyId);
    const name = $("#rename-input").value.trim();
    if (!c) return;
    if (!name) { setCopyPanel("rename", "Give the copy a name."); return; }
    c.name = name.slice(0, 80);
    persist();
    copyPanel = null;
    copyPanelMsg = "";
    $("#copy-panel").innerHTML = "";
    render();
  }
  function deleteCopy() {
    const c = getCopy(copyId);
    if (!c) return;
    const index = copies.indexOf(c);
    copies = copies.filter((x) => x.id !== c.id);
    persist();
    clearTimeout(copyUndoTimer);
    copyUndo = { copy: c, index };
    copyUndoTimer = setTimeout(() => { copyUndo = null; if (view === "copies") renderCopiesView(); }, 9000);
    go("copies");
  }
  function undoDeleteCopy() {
    if (!copyUndo) return;
    const { copy } = copyUndo;
    copyUndo = null;
    clearTimeout(copyUndoTimer);
    if (!getCopy(copy.id)) copies.push(copy);
    copies.sort(byNewest);
    persist();
    render();
  }
  function restoreCopy() {
    const c = getCopy(copyId);
    if (!c || !canWrite || !plan) return;
    if (!saveCopy(`Before switching to “${c.name}”`, "Saved automatically before switching plans.")) {
      setCopyPanel("restore", "Your current plan couldn't be saved as a copy first, so nothing changed.");
      return;
    }
    const meals = JSON.parse(JSON.stringify(c.plan.meals));
    const source = c.plan.source;
    go("plan");
    commit((p) => { p.meals = meals; if (source) p.source = source; }, { undo: `Switched to “${c.name}”. Your previous plan is under Saved copies.`, where: { type: "top" } });
  }

  // Hovering a macro (bar segment or legend) highlights it in both places.
  document.addEventListener("pointerover", (e) => {
    const s = e.target.closest ? e.target.closest("#summary") : null;
    const k = s ? (e.target.closest("[data-macro]") || {}).dataset : null;
    for (const el of $$("#summary .split > span, #summary .macro")) el.classList.toggle("is-dim", !!(k && k.macro) && el.dataset.macro !== k.macro);
  });

  // Sticky bar: border once scrolled, compact totals once the summary scrolls away.
  const topbar = $("#topbar");
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = window.scrollY || document.documentElement.scrollTop || 0;
      topbar.classList.toggle("is-stuck", y > 4);
      const s = view === "plan" ? $("#summary") : null;
      topbar.classList.toggle("show-mini", !!(plan && s && s.getBoundingClientRect().bottom < topbar.getBoundingClientRect().bottom + 4));
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });

  // ---------------------------------------------------------------- offline + updates
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) toast("A new version is ready.", "Reload", () => location.reload());
    });
    navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is a bonus */ });
  }

  // ---------------------------------------------------------------- start
  async function start() {
    render();
    const saved = readSaved();
    if (saved === undefined) {
      canWrite = false;
      setNotice("This browser is blocking storage, so nothing can be saved. Open the app from its Home Screen icon.");
    }
    if (saved && saved.plan) {
      plan = normalize(saved.plan);
      copies = (Array.isArray(saved.copies) ? saved.copies : []).map((c) => normalizeCopy(c)).sort(byNewest);
      settings = Object.assign({ showAll: false }, saved.settings || {});
      backedUpAt = typeof saved.backedUpAt === "string" ? saved.backedUpAt : "";
    } else {
      // First launch: start from the plan carried over from the spreadsheet and the Claude version.
      try {
        const res = await fetch("seed.json", { cache: "no-cache" });
        const seed = await res.json();
        plan = normalize(seed.plan);
        copies = (Array.isArray(seed.copies) ? seed.copies : []).map((c) => normalizeCopy(c)).sort(byNewest);
      } catch (e) {
        plan = emptyPlan();
        setNotice("Your starting plan couldn't be loaded. Connect to the internet and reopen the app once.");
      }
      if (canWrite && plan.meals.length) persist();
    }
    loading = false;
    requestPersist();
    render();
    onScroll();
    registerServiceWorker();
  }

  start();
})();
