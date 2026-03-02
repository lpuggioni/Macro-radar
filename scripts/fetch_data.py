#!/usr/bin/env python3
import os, json, datetime, math
import requests

OUT_DIR = os.path.join("docs", "data")
os.makedirs(OUT_DIR, exist_ok=True)

def utcnow_iso():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def write_json(name, payload):
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return path

def eurostat_irt_lt_gby10_m(geos=("DE","IT","ES","FR")):
    # Eurostat Statistics API (JSON-stat)
    base = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/IRT_LT_GBY10_M"
    params = [("format","JSON"), ("lang","en")]
    for g in geos:
        params.append(("geo", g))
    r = requests.get(base, params=params, timeout=30)
    r.raise_for_status()
    js = r.json()

    # Parse JSON-stat v2
    dims = js["id"]
    dim_index = {d:i for i,d in enumerate(dims)}
    time_dim = js["dimension"]["time"]["category"]["index"]
    geo_dim = js["dimension"]["geo"]["category"]["index"]
    times = list(time_dim.keys())
    geolist = list(geo_dim.keys())

    # sizes/strides
    sizes = [len(js["dimension"][d]["category"]["index"]) for d in dims]
    strides = []
    for i in range(len(sizes)):
        s=1
        for j in range(i+1, len(sizes)):
            s *= sizes[j]
        strides.append(s)

    def idx_of(dim, cat):
        return js["dimension"][dim]["category"]["index"][cat]

    def lin(coord):
        li=0
        for d in dims:
            li += idx_of(d, coord[d]) * strides[dim_index[d]]
        return li

    series = {g:[] for g in geolist}
    for g in geolist:
        for t in times:
            coord={}
            for d in dims:
                if d=="time": coord[d]=t
                elif d=="geo": coord[d]=g
                else:
                    # choose first category for other dims (unit/indic)
                    coord[d] = next(iter(js["dimension"][d]["category"]["index"].keys()))
            val = js["value"].get(str(lin(coord))) if isinstance(js["value"], dict) else js["value"][lin(coord)]
            series[g].append(val if val is not None else None)

    # last values
    last_time = times[-1] if times else None
    last = {g:(series[g][-1] if series[g] else None) for g in geolist}
    spread_itde = []
    for i in range(len(times)):
        it = series.get("IT",[None]*len(times))[i]
        de = series.get("DE",[None]*len(times))[i]
        spread_itde.append((it - de) if (it is not None and de is not None) else None)

    return {
        "generated_at": utcnow_iso(),
        "asof_data": last_time,
        "times": times,
        "series": series,
        "spread_itde": spread_itde,
        "last": last
    }

def ecb_fx_top_movers():
    # ECB SDMX JSON is complex and sometimes blocked; for Actions we can fetch and parse a minimal set.
    # We'll use ECB data-api endpoint with SDMX-CSV for simplicity:
    # https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=10&format=csvdata
    bases = [
        "https://data-api.ecb.europa.eu/service/data/EXR/",
        "https://sdw-wsrest.ecb.europa.eu/service/data/EXR/",
    ]
    currencies = ["USD","GBP","JPY","BRL","MXN","ZAR","TRY","INR","IDR","PLN","HUF","CZK"]
    rows=[]
    for base in bases:
        ok=True
        rows=[]
        try:
            for ccy in currencies:
                url = f"{base}D.{ccy}.EUR.SP00.A"
                params={"lastNObservations":"10", "format":"csvdata"}
                r = requests.get(url, params=params, timeout=30)
                if r.status_code != 200:
                    ok=False
                    break
                # parse SDMX-CSV (header + rows). We want TIME_PERIOD and OBS_VALUE
                lines = r.text.strip().splitlines()
                if len(lines) < 3:
                    ok=False
                    break
                header = lines[0].split(",")
                try:
                    i_time = header.index("TIME_PERIOD")
                    i_val = header.index("OBS_VALUE")
                except ValueError:
                    ok=False
                    break
                pts=[]
                for ln in lines[1:]:
                    cols = ln.split(",")
                    if len(cols) <= max(i_time,i_val): 
                        continue
                    t = cols[i_time]
                    try:
                        v = float(cols[i_val])
                    except:
                        continue
                    pts.append((t,v))
                pts.sort(key=lambda x:x[0])
                last_t,last_v = pts[-1]
                prev_t,prev_v = pts[-8] if len(pts)>=8 else pts[0]
                chg7d = ((last_v/prev_v)-1.0)*100.0 if prev_v else None
                rows.append({"ccy":ccy,"pair":f"{ccy}/EUR","last":last_v,"asof":last_t,"chg7d":chg7d})
            if ok:
                return {"generated_at": utcnow_iso(), "rows": rows}
        except Exception:
            pass
    return {"generated_at": utcnow_iso(), "rows": [], "note":"ECB FX download failed"}

def fred_credit_optional():
    key = os.environ.get("FRED_API_KEY","").strip()
    if not key:
        return None
    # Example series:
    # BAMLH0A0HYM2 (HY OAS), BAMLC0A0CM (IG OAS) - availability can vary, but often present.
    base="https://api.stlouisfed.org/fred/series/observations"
    def get_last(series_id):
        r = requests.get(base, params={"series_id":series_id,"api_key":key,"file_type":"json","sort_order":"desc","limit":"1"}, timeout=30)
        r.raise_for_status()
        js=r.json()
        obs=js.get("observations",[])
        if not obs: return None,None
        o=obs[0]
        val=None
        try:
            val=float(o["value"])
        except:
            val=None
        return o.get("date"), val
    try:
        d1, ig = get_last("BAMLC0A0CM")
        d2, hy = get_last("BAMLH0A0HYM2")
        asof = d1 or d2
        return {"generated_at": utcnow_iso(), "asof_data": asof, "ig_oas": ig, "hy_oas": hy, "source":"FRED"}
    except Exception:
        return None

def main():
    eu = eurostat_irt_lt_gby10_m()
    write_json("eu_curves.json", eu)

    # snapshot tiles
    last = eu.get("last",{})
    tiles = [
        {"label":"DE 10Y (mensile)", "value": last.get("DE"), "unit":"pct", "source":"Eurostat"},
        {"label":"IT 10Y (mensile)", "value": last.get("IT"), "unit":"pct", "source":"Eurostat"},
        {"label":"Spread IT–DE (mensile)", "value": (last.get("IT") - last.get("DE")) if (last.get("IT") is not None and last.get("DE") is not None) else None, "unit":"pct", "source":"Eurostat"},
    ]
    snap = {"generated_at": utcnow_iso(), "asof_data": eu.get("asof_data"), "tiles": tiles}
    write_json("snapshot.json", snap)

    fx = ecb_fx_top_movers()
    write_json("fx_top_movers.json", fx)

    credit = fred_credit_optional()
    if credit:
        write_json("credit.json", credit)
    else:
        # ensure file absent if not configured
        p = os.path.join(OUT_DIR, "credit.json")
        if os.path.exists(p):
            os.remove(p)

if __name__ == "__main__":
    main()
