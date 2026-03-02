// Macro Radar — GitHub Hybrid MVP
// UI hosted on GitHub Pages (https://) -> fetch works.
// Data files updated by GitHub Actions into docs/data/*.json.
// News fetched live from GDELT (browser CORS-friendly).

const DATA_BASE = "./data/";
const GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc";

const state = {
  timeRange: "7d",
  newsCategory: "all",
  marketMovingOnly: false,
  removed: [],
  lastRefreshAt: null,
};

function $(sel){ return document.querySelector(sel); }
function fmtNum(x, digits=2){
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return Number(x).toLocaleString("it-IT", {maximumFractionDigits: digits, minimumFractionDigits: digits});
}
function fmtPct(x, digits=2){
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const s = (x>=0?"+":"") + fmtNum(x, digits) + "%";
  return s;
}
function isoToHuman(iso){
  if (!iso) return "—";
  try{
    const d = new Date(iso);
    return d.toLocaleString("it-IT");
  }catch{ return iso; }
}
function setAsof(el, label, iso){
  el.textContent = `${label}: ${isoToHuman(iso)}`;
}
function addRemoved(id, reason){
  if (!state.removed.find(x => x.id===id)) state.removed.push({id, reason});
}
function renderRemoved(){
  const ul = $("#removedList");
  ul.innerHTML = "";
  state.removed
    .sort((a,b)=>a.id.localeCompare(b.id))
    .forEach(x=>{
      const li = document.createElement("li");
      li.textContent = `${x.id} — ${x.reason}`;
      ul.appendChild(li);
    });
  setAsof($("#removedAsof"), "Aggiornato", new Date().toISOString());
}

// Charts
let chartEU10Y = null;
let chartSpread = null;

function buildChart(ctx, labels, datasets){
  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: "#c9d1d9" } } },
      scales: {
        x: { ticks: { color:"#9aa7b2" }, grid: { color: "rgba(34,48,68,0.35)"} },
        y: { ticks: { color:"#9aa7b2" }, grid: { color: "rgba(34,48,68,0.35)"} },
      }
    }
  });
}

function upsertEUCharts(payload){
  const labels = payload.times.slice(-36);
  const take = (arr)=>arr.slice(-36);

  const ds = [];
  const mapping = {DE:"DE 10Y", IT:"IT 10Y", ES:"ES 10Y", FR:"FR 10Y"};
  Object.keys(mapping).forEach(k=>{
    if (payload.series[k]){
      ds.push({
        label: mapping[k],
        data: take(payload.series[k]),
        tension: 0.25,
        pointRadius: 0,
      });
    }
  });

  const ctx1 = $("#chartEU10Y").getContext("2d");
  if (!chartEU10Y) chartEU10Y = buildChart(ctx1, labels, ds);
  else { chartEU10Y.data.labels = labels; chartEU10Y.data.datasets = ds; chartEU10Y.update(); }

  const ctx2 = $("#chartSpread").getContext("2d");
  const ds2 = [{ label:"IT-DE", data: take(payload.spread_itde), tension:0.25, pointRadius:0 }];
  if (!chartSpread) chartSpread = buildChart(ctx2, labels, ds2);
  else { chartSpread.data.labels = labels; chartSpread.data.datasets = ds2; chartSpread.update(); }
}

function renderTiles(snap){
  const tiles = snap.tiles || [];
  const grid = $("#tilesGrid");
  grid.innerHTML="";
  tiles.forEach(t=>{
    const el = document.createElement("div");
    el.className="tile";
    const v = t.unit === "pct" ? (t.value==null?"—":fmtNum(t.value,2)+"%") : (t.value==null?"—":fmtNum(t.value, t.digits ?? 2));
    const delta = t.deltaPct == null ? "" : fmtPct(t.deltaPct,2);
    const deltaClass = (t.deltaPct||0) >= 0 ? "good" : "bad";
    el.innerHTML = `
      <div class="k">${t.label}</div>
      <div class="v">${v}</div>
      <div class="sub"><span>${t.source || ""}</span><span class="delta ${deltaClass}">${delta}</span></div>
    `;
    grid.appendChild(el);
  });
  setAsof($("#tilesAsof"), "As-of dati", snap.asof_data || snap.generated_at);
}

// News (GDELT) tagging
const TAG_RULES = [
  ["central_banks", /(central bank|federal reserve|fed\b|ecb\b|european central bank|boe\b|bank of england|boj\b|bank of japan|snb\b|rate decision|minutes|speech|powell|lagarde)/i],
  ["macro_data", /(inflation|cpi\b|hicp|pmi\b|payrolls|nfp\b|jobs|unemployment|gdp\b|confidence|retail sales|industrial production)/i],
  ["rates", /(yield|yields|rates\b|bond|bonds|treasury|bund|btp|curve|steepen|flatten|duration)/i],
  ["fx", /(fx\b|forex|eurusd|dollar|usd\b|euro\b|yen\b|gbp\b|currency|currencies|devaluation)/i],
  ["credit", /(credit|spreads|high yield|investment grade|default|cds\b|o?a?s\b)/i],
  ["equity", /(stocks|equities|equity|s&p|nasdaq|stoxx|dax|ibex|earnings)/i],
  ["commodities", /(oil|brent|wti|gas|lng|gold|copper|commodit)/i],
  ["crypto", /(bitcoin|btc\b|ethereum|eth\b|crypto|token|stablecoin)/i],
  ["regulation", /(sanction|regulation|compliance|eltif|ucits|aifmd|esma|sec\b)/i],
];

function tagNews(title, snippet){
  const text = `${title||""} ${snippet||""}`;
  const tags = [];
  for (const [tag, re] of TAG_RULES){
    if (re.test(text)) tags.push(tag);
  }
  const marketMoving = tags.includes("central_banks") || tags.includes("macro_data") || tags.includes("rates") || tags.includes("credit");
  return {tags, marketMoving};
}

async function fetchNews(){
  const q = [
    "central bank", "ECB", "Federal Reserve", "rate decision", "inflation", "CPI", "PMI",
    "bond yields", "credit spreads", "currency", "oil", "gold", "bitcoin",
    "emerging markets"
  ].join(" OR ");

  const url = new URL(GDELT_DOC);
  url.searchParams.set("query", q);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "HybridRel");
  url.searchParams.set("maxrecords", "60");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
  const data = await res.json();
  const items = (data.articles || []).map(a=>{
    const tagged = tagNews(a.title, a.seendate);
    return {
      title: a.title,
      url: a.url,
      seen: a.seendate,
      domain: a.domain,
      ...tagged
    };
  });

  renderNews(items);
  setAsof($("#newsAsof"), "News as-of", new Date().toISOString());
}

function renderNews(items){
  const list = $("#newsList");
  list.innerHTML = "";

  const cat = state.newsCategory;
  const mmOnly = state.marketMovingOnly;

  const filtered = items.filter(x=>{
    if (mmOnly && !x.marketMoving) return false;
    if (cat === "all") return true;
    return x.tags.includes(cat);
  }).slice(0, 40);

  if (!filtered.length){
    list.innerHTML = `<div class="muted">Nessuna news per i filtri selezionati.</div>`;
    return;
  }

  filtered.forEach(x=>{
    const el = document.createElement("div");
    el.className="news-item";
    const tagsHtml = x.tags.map(t=>`<span class="tag">${t}</span>`).join("");
    el.innerHTML = `
      <div class="news-head">
        <div class="news-title"><a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.title}</a></div>
        <div class="news-meta">${x.domain || ""}<br/>${x.seen ? x.seen : ""}</div>
      </div>
      <div class="tags">${tagsHtml}${x.marketMoving ? `<span class="tag">market-moving</span>` : ""}</div>
    `;
    list.appendChild(el);
  });
}

// Data loads
async function loadJSON(path){
  const res = await fetch(path, {cache:"no-store"});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return await res.json();
}

async function refreshDataFiles(){
  // Clear removed list each refresh
  state.removed = [];
  addRemoved("MOVE index", "Proprietario/licenza.");
  addRemoved("Consensus vs actual macro", "Consensus tipicamente licenziato (non open).");
  addRemoved("CB probabilities (OIS/futures)", "Richiede dati derivati/licenze.");

  // snapshot tiles + EU curves
  try{
    const snap = await loadJSON(DATA_BASE + "snapshot.json");
    renderTiles(snap);
    setAsof($("#drawerAsof"), "Drawer as-of", snap.generated_at);
  }catch(err){
    addRemoved("Snapshot/tiles", "Impossibile caricare docs/data/snapshot.json. Verifica che GitHub Pages sia attivo e che i file esistano.");
    $("#tilesGrid").innerHTML = `<div class="muted">Nessun dato (snapshot non disponibile).</div>`;
  }

  try{
    const curves = await loadJSON(DATA_BASE + "eu_curves.json");
    upsertEUCharts(curves);
  }catch(err){
    addRemoved("EU Curves", "Impossibile caricare docs/data/eu_curves.json.");
  }

  // FX movers
  try{
    const fx = await loadJSON(DATA_BASE + "fx_top_movers.json");
    renderFXTable(fx.rows || []);
  }catch(err){
    addRemoved("FX Top Movers", "File non disponibile (pipeline non ha scaricato FX, oppure ECB non raggiungibile dalla Actions).");
    const tbody = document.querySelector("#fxTable tbody");
    tbody.innerHTML = "";
  }

  // Credit
  try{
    const credit = await loadJSON(DATA_BASE + "credit.json");
    $("#creditBlock").innerHTML = `
      <div><b>IG OAS</b>: ${fmtNum(credit.ig_oas,2)} • <b>HY OAS</b>: ${fmtNum(credit.hy_oas,2)}</div>
      <div class="small">As-of: ${credit.asof_data || "—"} • Updated: ${isoToHuman(credit.generated_at)}</div>
    `;
  }catch(err){
    addRemoved("Credit Stress (FRED)", "Non attivo (manca FRED_API_KEY come secret oppure pipeline disabilitata).");
    $("#creditBlock").textContent = "Non disponibile (opzionale).";
  }

  renderRemoved();
}

function renderFXTable(rows){
  const sorted = rows
    .filter(r=>r.last!=null)
    .sort((a,b)=>Math.abs(b.chg7d||0)-Math.abs(a.chg7d||0))
    .slice(0, 12);

  const tbody = document.querySelector("#fxTable tbody");
  tbody.innerHTML="";
  sorted.forEach(r=>{
    const tr = document.createElement("tr");
    const pct = r.chg7d;
    tr.innerHTML = `
      <td>${r.ccy}</td>
      <td>${r.pair}</td>
      <td>${fmtNum(r.last, 4)}</td>
      <td class="${(pct||0)>=0?'delta good':'delta bad'}">${fmtPct(pct,2)}</td>
      <td>${r.asof || "—"}</td>
    `;
    tbody.appendChild(tr);
  });
}

let timers=[];
function clearTimers(){ timers.forEach(t=>clearInterval(t)); timers=[]; }
function startAutoRefresh(){
  clearTimers();
  timers.push(setInterval(refreshDataFiles, 60_000));
  timers.push(setInterval(fetchNews, 180_000));
}

function initTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".tabbody").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector("#tab-"+btn.dataset.tab).classList.add("active");
    });
  });
}
function initControls(){
  $("#timeRange").addEventListener("change", (e)=>{ state.timeRange = e.target.value; });
  $("#newsCategory").addEventListener("change", (e)=>{ state.newsCategory = e.target.value; fetchNews(); });
  $("#marketMovingOnly").addEventListener("change", (e)=>{ state.marketMovingOnly = e.target.checked; fetchNews(); });
  $("#refreshBtn").addEventListener("click", async ()=>{
    state.lastRefreshAt = new Date();
    $("#statusLine").textContent = `Aggiornamento… ${state.lastRefreshAt.toLocaleTimeString("it-IT")}`;
    await refreshDataFiles();
    await fetchNews();
    $("#statusLine").textContent = `Ultimo refresh UI: ${new Date().toLocaleString("it-IT")} • Dati: JSON via Actions • News: live`;
  });
}

window.addEventListener("load", async ()=>{
  initTabs();
  initControls();
  await refreshDataFiles();
  await fetchNews();
  startAutoRefresh();
  $("#statusLine").textContent = `Pronto • Dati: JSON via Actions • News: live • Auto-refresh: 60s/180s`;
});
