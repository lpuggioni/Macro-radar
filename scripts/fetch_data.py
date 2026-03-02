#!/usr/bin/env python3
import os
import json
import datetime
import requests

OUT_DIR = os.path.join("docs", "data")
os.makedirs(OUT_DIR, exist_ok=True)

def utcnow_iso() -> str:
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

def write_json(name: str, payload: dict) -> None:
    path = os.path.join(OUT_DIR, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

def eurostat_irt_lt_gby10_m(geos=("DE", "IT", "ES", "FR")) -> dict:
    # Eurostat Statistics API (JSON-stat)
    url = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/IRT_LT_GBY10_M"
    params = [("format", "JSON"), ("lang", "en")]
    for g in geos:
        params.append(("geo", g))

    r = requests.get(url, params=params, timeout=60)
    r.raise_for_status()
    js = r.json()

    dims = js["id"]
    dim_index = {d: i for i, d in enumerate(dims)}

    # categories
    time_index = js["dimension"]["time"]["category"]["index"]
    geo_index = js["dimension"]["geo"]["category"]["index"]
    times = list(time_index.keys())
    geolist = list(geo_index.keys())

    # sizes & strides
    sizes = [len(js["dimension"][d]["category"]["index"]) for d in dims]
    strides = []
    for i in range(len(sizes)):
        s = 1
        for j in range(i + 1, len(sizes)):
            s *= sizes[j]
        strides.append(s)

    def idx_of(dim: str, cat: str) -> int:
        return js["dimension"][dim]["category"]["index"][cat]

    def lin(coord: dict) -> int:
        li = 0
        for d in dims:
            li += idx_of(d, coord[d]) * strides[dim_index[d]]
        return li

    # js["value"] can be list or dict keyed by string index
    values = js["value"]

    def get_val(li: int):
        if isinstance(values, dict):
            return values.get(str(li))
        return values[li] if li < len(values) else None

    series = {g: [] for g in geolist}

    # choose first category for non (time, geo) dims
    first_cat = {}
    for d in dims:
        if d in ("time", "geo"):
            continue
        first_cat[d] = next(iter(js["dimension"][d]["category"]["index"].keys()))

    for g in geolist:
        for t in times:
            coord = {}
            for d in dims:
                if d == "time":
                    coord[d] = t
                elif d == "geo":
                    coord[d] = g
                else:
                    coord[d] = first_cat[d]
            v = get_val(lin(coord))
            series[g].append(v if v is not None else None)

    last_time = times[-1] if times else None
    last = {g: (series[g][-1] if series[g] else None) for g in geolist}

    spread_itde = []
    it_series = series.get("IT", [None] * len(times))
    de_series = series.get("DE", [None] * len(times))
    for i in range(len(times)):
        it = it_series[i]
        de = de_series[i]
        spread_itde.append((it - de) if (it is not None and de is not None) else None)

    return {
        "generated_at": utcnow_iso(),
        "asof_data": last_time,
        "times": times,
        "series": series,
        "spread_itde": spread_itde,
        "last": last,
        "source": "Eurostat IRT_LT_GBY10_M"
    }

def ecb_fx_top_movers() -> dict:
    bases = [
        "https://data-api.ecb.europa.eu/service/data/EXR/",
        "https://sdw-wsrest.ecb.europa.eu/service/data/EXR/",
    ]
    currencies = ["USD","GBP","JPY","BRL","MXN","ZAR","TRY","INR","IDR","PLN","HUF","CZK"]

    for base in bases:
        try:
            rows = []
            for ccy in currencies:
                url = f"{base}D.{ccy}.EUR.SP00.A"
                params = {"lastNObservations": "10", "format": "csvdata"}
                r = requests.get(url, params=params, timeout=60)
                if r.status_code != 200:
                    raise RuntimeError(f"ECB {ccy} HTTP {r.status_code}")

                lines = r.text.strip().splitlines()
                header = lines[0].split(",")
                i_time = header.index("TIME_PERIOD")
                i_val = header.index("OBS_VALUE")

                pts = []
                for ln in lines[1:]:
                    cols = ln.split(",")
                    if len(cols) <= max(i_time, i_val):
                        continue
                    t = cols[i_time]
                    try:
                        v = float(cols[i_val])
                    except:
                        continue
                    pts.append((t, v))

                pts.sort(key=lambda x: x[0])
                last_t, last_v = pts[-1]
                prev_t, prev_v = pts[-8] if len(pts) >= 8 else pts[0]
                chg7d = ((last_v / prev_v) - 1.0) * 100.0 if prev_v else None

                rows.append({"ccy": ccy, "pair": f"{ccy}/EUR", "last": last_v, "asof": last_t, "chg7d": chg7d})

            return {"generated_at": utcnow_iso(), "rows": rows, "source": "ECB EXR (SDMX-CSV)"}
        except Exception:
            continue

    return {"generated_at": utcnow_iso(), "rows": [], "note": "ECB FX download failed"}

def fred_credit_optional() -> dict | None:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        return None

    base = "https://api.stlouisfed.org/fred/series/observations"

    def get_last(series_id: str):
        r = requests.get(
            base,
            params={
                "series_id": series_id,
                "api_key": key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": "1",
            },
            timeout=60,
        )
        r.raise_for_status()
        js = r.json()
        obs = js.get("observations", [])
        if not obs:
            return None, None
        o = obs[0]
        try:
            val = float(o["value"])
        except:
            val = None
        return o.get("date"), val

    try:
        d1, ig = get_last("BAMLC0A0CM")
        d2, hy = get_last("BAMLH0A0HYM2")
        asof = d1 or d2
        return {"generated_at": utcnow_iso(), "asof_data": asof, "ig_oas": ig, "hy_oas": hy, "source": "FRED"}
    except Exception:
        return None

def main():
    eu = eurostat_irt_lt_gby10_m()
    write_json("eu_curves.json", eu)

    last = eu.get("last", {})
    de = last.get("DE")
    it = last.get("IT")
    spread = (it - de) if (it is not None and de is not None) else None

    snapshot = {
        "generated_at": utcnow_iso(),
        "asof_data": eu.get("asof_data"),
        "tiles": [
            {"label": "DE 10Y (mensile)", "value": de, "unit": "pct", "source": "Eurostat"},
            {"label": "IT 10Y (mensile)", "value": it, "unit": "pct", "source": "Eurostat"},
            {"label": "Spread IT–DE (mensile)", "value": spread, "unit": "pct", "source": "Eurostat"},
        ],
    }
    write_json("snapshot.json", snapshot)

    fx = ecb_fx_top_movers()
    write_json("fx_top_movers.json", fx)

    credit = fred_credit_optional()
    credit_path = os.path.join(OUT_DIR, "credit.json")
    if credit:
        write_json("credit.json", credit)
    else:
        if os.path.exists(credit_path):
            os.remove(credit_path)

if __name__ == "__main__":
    main()
