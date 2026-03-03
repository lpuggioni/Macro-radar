// Macro Radar — Direct Web Data (no Actions / no local JSON)
// Sources (public + CORS):
// - Eurostat Statistics API (JSON-stat 2.0, CORS supported)
// - GDELT DOC API (CORS wildcard "*")

const EUROSTAT_BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/";
const GDELT_DOC = "https://api.gdeltproject.org/api/v2/doc/doc";

const state = { newsCategory: "all", marketMovingOnly: false };

function $(s){ return document.querySelector(s); }
function fmtNum(x, d=2){ return (x==null || Number.isNaN(x)) ? "—" : Number(x).toLocaleString("it-IT",{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtPct(x, d=2){ return (x==null || Number.isNaN(x)) ? "—" : ((x>=0?"+":"")+fmtNum(x,d)+"%"); }
function isoToHuman(iso){ try{ return new Date(iso).toLocaleString("it-IT"); }catch{ return iso || "—"; } }
function setAsof(id, label, iso){ $(id).textContent = `${label}: ${isoToHuman(iso)}`; }

async function eurostat(dataset, params){
  const url = new URL(EUROSTAT_BASE + dataset);
  url.searchParams.set("format","JSON");
  url.searchParams.set("lang","en");
  for (const [k,v] of Object.entries(params||{})){
    if (Array.isArray(v)) v.forEach(x=>url.searchParams.append(k,x));
    else url.searchParams.set(k,v);
  }
  const r = await fetch(url.toString(), { cache:"no-store" });
  if (!r.ok) throw new Error(`Eurostat ${dataset} HTTP ${r.status}`);
  return await r.json();
}

// Minimal JSON-stat parser for geo/time
function jsonstatGeoTime(js, dimTime="time", dimGeo="geo"){
  const dims = js.id;
  const dimIndex = Object.fromEntries(dims.map((d,i)=>[d,i]));
  const sizes = dims.map(d=>Object.keys(js.dimension[d].category.index).length);
  const stride = sizes.map((_,i)=>sizes.slice(i+1).reduce((a,b)=>a*b,1));

  const timeCats = Object.keys(js.dimension[dimTime].category.index);
  const geoCats  = Object.keys(js.dimension[dimGeo].category.index);

  const firstCat = {};
  for (const d of dims){
    if (d===dimTime || d===dimGeo) continue;
    firstCat[d] = Object.keys(js.dimension[d].category.index)[0];
  }

  const values = js.value;
  const getVal = (li)=> (Array.isArray(values) ? values[li] : values[String(li)]);

  const idxOf = (dim,cat)=> js.dimension[dim].category.index[cat];
  const lin = (coord)=>{
    let li=0;
    for (const d of dims){
      li += idxOf(d, coord[d]) * stride[dimIndex[d]];
    }
    return li;
  };

  const series = {};
  for (const g of geoCats){
    series[g]=[];
    for (const t of timeCats){
      const coord={};
      for (const d of dims){
        if (d===dimTime) coord[d]=t;
        else if (d===dimGeo) coord[d]=g;
        else coord[d]=firstCat[d];
      }
      series[g].push(getVal(lin(coord)) ?? null);
    }
  }
  return { times: timeCats, series };
}

// Charts
let chartEU10Y=null, chartSpread=null;

function buildChart(ctx, labels, datasets){
  return new Chart(ctx,{
    type:"line",
    data:{labels,datasets},
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{ display:true, labels:{ color:"#c9d1d9" } } },
      scales:{
        x:{ ticks:{ color:"#9aa7b2" }, grid:{ color:"rgba(34,48,68,0.35)"} },
        y:{ ticks:{ color:"#9aa7b2" }, grid:{ color:"rgba(34,48,68,0.35)"} },
      }
    }
  });
}

function renderTiles(de, it, spread, asof){
  const tiles = [
    {label:"DE 10Y (mensile)", value:de, unit:"pct", source:"Eurostat"},
    {label:"IT 10Y (mensile)", value:it, unit:"pct", source:"Eurostat"},
    {label:"Spread IT–DE (mensile)", value:spread, unit:"pct", source:"Eurostat"},
  ];
  const grid = $("#tilesGrid");
  grid.innerHTML="";
  tiles.forEach(t=>{
    const el=document.createElement("div");
    el.className="tile";
    const v = (t.value==null) ? "—" : (fmtNum(t.value,2)+"%");
    el.innerHTML = `
      <div class="k">${t.label}</div>
      <div class="v">${v}</div>
      <div class="sub"><span>${t.source}</span><span class="delta"></span></div>`;
    grid.appendChild(el);
  });
  setAsof("#tilesAsof","As-of dati", asof);
}

async function refreshCurves(){
  const js = await eurostat("IRT_LT_GBY10_M", { geo:["DE","IT","ES","FR"] });
  const {times, series} = jsonstatGeoTime(js);

  const lastIdx = times.length-1;
  const asof = times[lastIdx];
  const de = series.DE?.[lastIdx] ?? null;
  const it = series.IT?.[lastIdx] ?? null;
  const spread = (de!=null && it!=null) ? (it-de) : null;

  renderTiles(de,it,spread,asof);
  setAsof("#drawerAsof","Drawer updated", new Date().toISOString());

  const labels = times.slice(-36);
  const take = (arr)=>arr.slice(-36);

  const ds = [
    {label:"DE 10Y", data:take(series.DE||[]), tension:.25, pointRadius:0},
    {label:"IT 10Y", data:take(series.IT||[]), tension:.25, pointRadius:0},
    {label:"ES 10Y", data:take(series.ES||[]), tension:.25, pointRadius:0},
    {label:"FR 10Y", data:take(series.FR||[]), tension:.25, pointRadius:0},
  ];

  const itArr = take(series.IT||[]);
  const deArr = take(series.DE||[]);
  const spr = itArr.map((v,i)=>(v!=null && deArr[i]!=null)?(v-deArr[i]):null);

  const ctx1=$("#chartEU10Y").getContext("2d");
  chartEU10Y ? (chartEU10Y.data.labels=labels, chartEU10Y.data.datasets=ds, chartEU10Y.update())
             : (chartEU10Y=buildChart(ctx1,labels,ds));

  const ctx2=$("#chartSpread").getContext("2d");
  const ds2=[{label:"IT-DE", data:spr, tension:.25, pointRadius:0}];
  chartSpread ? (chartSpread.data.labels=labels, chartSpread.data.datasets=ds2, chartSpread.update())
              : (chartSpread=buildChart(ctx2,labels,ds2));
}

// News tagging
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

function tagNews(title){
  const tags=[];
  for (const [tag,re] of TAG_RULES) if (re.test(title||"")) tags.push(tag);
  const marketMoving = tags.includes("central_banks") || tags.includes("macro_data") || tags.includes("rates") || tags.includes("credit");
  return {tags, marketMoving};
}

async function refreshNews(){
  const q = ["ECB","Federal Reserve","rate decision","inflation","CPI","PMI","bond yields","credit spreads","currency","oil","gold","bitcoin","emerging markets"].join(" OR ");
  const url = new URL(GDELT_DOC);
  url.searchParams.set("query", q);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "HybridRel");
  url.searchParams.set("maxrecords", "60");

  const r = await fetch(url.toString(), { cache:"no-store" });
  if (!r.ok) throw new Error(`GDELT HTTP ${r.status}`);
  const data = await r.json();

  const items = (data.articles||[]).map(a=>{
    const t = tagNews(a.title);
    return { title:a.title, url:a.url, seen:a.seendate, domain:a.domain, ...t };
  });

  const list=$("#newsList");
  list.innerHTML="";
  const filtered = items.filter(x=>{
    if (state.marketMovingOnly && !x.marketMoving) return false;
    if (state.newsCategory==="all") return true;
    return x.tags.includes(state.newsCategory);
  }).slice(0,40);

  if (!filtered.length){
    list.innerHTML = `<div class="muted">Nessuna news per i filtri selezionati.</div>`;
  } else {
    filtered.forEach(x=>{
      const el=document.createElement("div");
      el.className="news-item";
      const tagsHtml = x.tags.map(t=>`<span class="tag">${t}</span>`).join("") + (x.marketMoving?`<span class="tag">market-moving</span>`:"");
      el.innerHTML = `
        <div class="news-head">
          <div class="news-title"><a href="${x.url}" target="_blank" rel="noopener noreferrer">${x.title}</a></div>
          <div class="news-meta">${x.domain||""}<br/>${x.seen||""}</div>
        </div>
        <div class="tags">${tagsHtml}</div>`;
      list.appendChild(el);
    });
  }
  setAsof("#newsAsof","News updated", new Date().toISOString());
}

function initTabs(){
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
      document.querySelectorAll(".tabbody").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      $("#tab-"+btn.dataset.tab).classList.add("active");
    });
  });
}

function initControls(){
  $("#newsCategory").addEventListener("change", e=>{ state.newsCategory=e.target.value; refreshNews(); });
  $("#marketMovingOnly").addEventListener("change", e=>{ state.marketMovingOnly=e.target.checked; refreshNews(); });
  $("#refreshBtn").addEventListener("click", async ()=>{
    $("#statusLine").textContent = "Aggiornamento…";
    await Promise.allSettled([refreshCurves(), refreshNews()]);
    $("#statusLine").textContent = `Ultimo refresh UI: ${new Date().toLocaleString("it-IT")}`;
  });
}

window.addEventListener("load", async ()=>{
  initTabs();
  initControls();
  $("#statusLine").textContent = "Caricamento…";
  await Promise.allSettled([refreshCurves(), refreshNews()]);
  $("#statusLine").textContent = `Pronto • Auto-refresh: Curves 5m • News 3m`;
  setInterval(refreshCurves, 300_000);
  setInterval(refreshNews, 180_000);
});
