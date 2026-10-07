import csv
import json
import math
import sys
import time
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from simulate_forecast_accuracy import (
    BERLIN_TZ,
    mean,
    median,
    detect_ramp_start,
    infer_opening_hours,
    within_opening_hours,
    ewma
)

print("Loading data for pipeline validation...", flush=True)
gym_rows = defaultdict(list)
with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for r in reader:
        ts_str = r['timestamp'].replace(' ', 'T')
        if not ts_str.endswith('Z'): ts_str += 'Z'
        dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
        dt_berlin = dt.astimezone(BERLIN_TZ)
        js_wd = (dt_berlin.weekday() + 1) % 7
        gym_rows[r['gymId']].append({
            'time_ms': dt.timestamp() * 1000,
            'count': int(r['count']),
            'max_count': int(r['maxCount']),
            'local_day': dt_berlin.strftime('%Y-%m-%d'),
            'weekday': js_wd,
            'hour': dt_berlin.hour,
        })

for g in gym_rows:
    gym_rows[g].sort(key=lambda x: x['time_ms'])

actual_hourly_means = {}
gym_max_caps = {}
for g, rows in gym_rows.items():
    hourly = defaultdict(lambda: defaultdict(list))
    for r in rows:
        hourly[r['local_day']][r['hour']].append(r['count'])
        gym_max_caps[g] = max(gym_max_caps.get(g, 0), r['max_count'])
    for day in hourly:
        for h, vals in hourly[day].items():
            m = mean(vals)
            if m is not None:
                actual_hourly_means[(g, day, h)] = round(m)

end_date = datetime(2026, 10, 6, tzinfo=BERLIN_TZ)
eval_days = [(end_date - timedelta(days=i)).strftime('%Y-%m-%d') for i in reversed(range(84))]
sim_hours = [7, 9, 11, 13, 15, 17, 19, 21]

print("Simulating Baseline vs Fully Optimized Pipeline...", flush=True)

models = ['Baseline (Produktiv)', 'Optimiert (Ramp-Fix + Delta-Decay + Damped Slope)']
results = {m: [] for m in models}
results_horizon = {m: defaultdict(list) for m in models}
results_gym = {m: defaultdict(list) for m in models}
results_slot = {m: defaultdict(list) for m in models}

t0 = time.time()
sim_count = 0

for day_str in eval_days:
    day_dt = datetime.strptime(day_str, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
    js_wd = (day_dt.weekday() + 1) % 7

    for sim_h in sim_hours:
        sim_dt_berlin = day_dt.replace(hour=sim_h, minute=20, second=0)
        sim_dt_utc = sim_dt_berlin.astimezone(timezone.utc)
        now_ms = sim_dt_utc.timestamp() * 1000
        lookback_ms = (sim_dt_utc - timedelta(days=56)).timestamp() * 1000

        for gym_id, rows in gym_rows.items():
            cap = gym_max_caps[gym_id]
            history = [r for r in rows if lookback_ms <= r['time_ms'] <= now_ms]

            day_buckets = {}
            for r in history:
                dk = r['local_day']
                if dk not in day_buckets:
                    day_buckets[dk] = {
                        'weekday': r['weekday'],
                        'maxCapacity': r['max_count'],
                        'hourlyValues': defaultdict(list)
                    }
                day_buckets[dk]['maxCapacity'] = max(day_buckets[dk]['maxCapacity'], r['max_count'])
                day_buckets[dk]['hourlyValues'][r['hour']].append(r['count'])

            # Baseline Profile (with ramp filter)
            wh_base = [[[] for _ in range(24)] for _ in range(7)]
            h_base = [[] for _ in range(24)]
            o_base = []

            # Optimized Profile (unfiltered ramp - keeps actual morning historical counts)
            wh_opt = [[[] for _ in range(24)] for _ in range(7)]
            h_opt = [[] for _ in range(24)]
            o_opt = []

            for dk, bucket in day_buckets.items():
                hourly_averages = [mean(bucket['hourlyValues'].get(h, [])) for h in range(24)]
                low_th = max(3, round(bucket['maxCapacity'] * 0.05))
                ramp_start = detect_ramp_start(hourly_averages, low_th, bucket['maxCapacity'])

                for h in range(24):
                    val = hourly_averages[h]
                    if val is None or val <= low_th: continue

                    # Always add to opt
                    wh_opt[bucket['weekday']][h].append(val)
                    h_opt[h].append(val)
                    o_opt.append(val)

                    # Baseline skips ramp
                    if ramp_start is not None and (h >= ramp_start and h <= ramp_start + 1):
                        continue
                    wh_base[bucket['weekday']][h].append(val)
                    h_base[h].append(val)
                    o_base.append(val)

            opening = infer_opening_hours(day_buckets)

            def get_val_base(h):
                if not within_opening_hours(opening, js_wd, h): return 0
                wm = median(wh_base[js_wd][h])
                if wm is not None: return wm
                hm = median(h_base[h])
                if hm is not None: return hm
                om = median(o_base)
                return om if om is not None else 0

            def get_val_opt(h):
                if not within_opening_hours(opening, js_wd, h): return 0
                wm = median(wh_opt[js_wd][h])
                if wm is not None: return wm
                hm = median(h_opt[h])
                if hm is not None: return hm
                om = median(o_opt)
                return om if om is not None else 0

            today_b = day_buckets.get(day_str)
            win30_ms = (sim_dt_utc - timedelta(minutes=30)).timestamp() * 1000
            recent = [r for r in rows if win30_ms <= r['time_ms'] <= now_ms]

            slope_per_10m = 0.0
            if len(recent) >= 3:
                times = [r['time_ms'] / 60000.0 for r in recent]
                vals = [r['count'] for r in recent]
                n = len(vals)
                mt = sum(times) / n
                mv = sum(vals) / n
                num = sum((times[i] - mt) * (vals[i] - mv) for i in range(n))
                den = sum((times[i] - mt) ** 2 for i in range(n))
                slope_per_min = 0.0 if den == 0 else num / den
                slope_per_10m = slope_per_min * 10.0

            cur_samples = (today_b['hourlyValues'].get(sim_h, [])[-12:]) if today_b else []
            nowcast_cur = ewma(cur_samples, 0.45) if cur_samples else None

            base_cur_opt = get_val_opt(sim_h)
            cur_delta = (nowcast_cur - base_cur_opt) if (nowcast_cur is not None and len(cur_samples) >= 2) else 0.0

            for target_h in range(sim_h, 24):
                act = actual_hourly_means.get((gym_id, day_str, target_h))
                if act is None: continue
                horizon = target_h - sim_h

                # Baseline forecast
                base_val = get_val_base(target_h)
                if horizon == 0:
                    fc_base = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(base_val)
                elif horizon == 1:
                    if nowcast_cur is not None and len(cur_samples) >= 3:
                        blended = round(0.7 * nowcast_cur + 0.3 * base_val)
                        fc_base = max(0, min(blended + round(slope_per_10m * 6), cap))
                    else:
                        fc_base = max(0, min(round(base_val) + round(slope_per_10m * 6), cap))
                elif horizon == 2:
                    fc_base = max(0, min(round(base_val) + round(slope_per_10m * 12 * 0.5), cap))
                else:
                    fc_base = round(base_val)

                # Optimized forecast
                opt_val = get_val_opt(target_h)
                if horizon == 0:
                    fc_opt = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(opt_val)
                elif horizon == 1:
                    max_adj = round(cap * 0.05)
                    raw_adj = round(slope_per_10m * 6 * 0.20)
                    adj = max(-max_adj, min(raw_adj, max_adj))
                    fc_opt = max(0, min(round(opt_val + 0.5 * cur_delta) + adj, cap))
                elif horizon == 2:
                    fc_opt = max(0, min(round(opt_val + 0.2 * cur_delta), cap))
                else:
                    fc_opt = round(opt_val)

                for m_name, fc in zip(models, [fc_base, fc_opt]):
                    err = fc - act
                    abs_err = abs(err)
                    record = (err, abs_err, act, cap, horizon, target_h, gym_id)
                    results[m_name].append(record)
                    results_horizon[m_name][horizon].append(record)
                    results_gym[m_name][gym_id].append(record)

            sim_count += 1
            if sim_count % 1000 == 0:
                print(f"Progress: {sim_count}/4032 ({time.time()-t0:.1f}s)...", flush=True)

print(f"\nCompleted in {time.time()-t0:.1f}s!\n", flush=True)

def stats(recs):
    n = len(recs)
    mae = sum(x[1] for x in recs) / n
    rmse = math.sqrt(sum(x[0]**2 for x in recs) / n)
    bias = sum(x[0] for x in recs) / n
    cap_err = sum((x[1] / x[3]) * 100 for x in recs) / n
    wape = sum(x[1] for x in recs) / sum(x[2] for x in recs) * 100
    within_5 = sum(1 for x in recs if x[1] <= 5) / n * 100
    within_10_cap = sum(1 for x in recs if (x[1] / x[3]) <= 0.10) / n * 100
    return {
        'count': n,
        'mae': round(mae, 2),
        'rmse': round(rmse, 2),
        'cap_err': round(cap_err, 2),
        'wape': round(wape, 2),
        'bias': round(bias, 2),
        'within_5_pers': round(within_5, 1),
        'within_10_cap': round(within_10_cap, 1)
    }

print("="*80, flush=True)
print("VORHER-NACHHER VERGLEICH (12 WOCHEN, 40.104 PUNKTE)", flush=True)
print("="*80, flush=True)

base_st = stats(results[models[0]])
opt_st = stats(results[models[1]])

print(f"{'Metrik':35s} | {'Baseline (Bisher)':18s} | {'Optimiert':18s} | {'Verbesserung':15s}", flush=True)
print("-"*95, flush=True)
print(f"{'MAE (Personen)':35s} | {base_st['mae']:18.2f} | {opt_st['mae']:18.2f} | {opt_st['mae'] - base_st['mae']:+14.2f} ({(opt_st['mae'] - base_st['mae'])/base_st['mae']*100:+.1f}%)", flush=True)
print(f"{'RMSE (Personen)':35s} | {base_st['rmse']:18.2f} | {opt_st['rmse']:18.2f} | {opt_st['rmse'] - base_st['rmse']:+14.2f} ({(opt_st['rmse'] - base_st['rmse'])/base_st['rmse']*100:+.1f}%)", flush=True)
print(f"{'Kapazitätsfehler (%)':35s} | {base_st['cap_err']:17.1f}% | {opt_st['cap_err']:17.1f}% | {opt_st['cap_err'] - base_st['cap_err']:+13.1f}%", flush=True)
print(f"{'WAPE (%)':35s} | {base_st['wape']:17.1f}% | {opt_st['wape']:17.1f}% | {opt_st['wape'] - base_st['wape']:+13.1f}%", flush=True)
print(f"{'Bias (Personen)':35s} | {base_st['bias']:+18.2f} | {opt_st['bias']:+18.2f} | {opt_st['bias'] - base_st['bias']:+14.2f}", flush=True)
print(f"{'Treffer <= 10% Kapazität':35s} | {base_st['within_10_cap']:17.1f}% | {opt_st['within_10_cap']:17.1f}% | {opt_st['within_10_cap'] - base_st['within_10_cap']:+13.1f}%", flush=True)

print("\n" + "-"*80, flush=True)
print("VERGLEICH NACH HORIZONT", flush=True)
print("-"*80, flush=True)
for h in range(7):
    bh = stats(results_horizon[models[0]][h])
    oh = stats(results_horizon[models[1]][h])
    delta_mae = oh['mae'] - bh['mae']
    pct_imp = (delta_mae / bh['mae']) * 100
    print(f"  Horizont +{h}h: Baseline MAE={bh['mae']:5.2f} -> Opt MAE={oh['mae']:5.2f} ({delta_mae:+5.2f} / {pct_imp:+.1f}%) | <=10% Cap: {bh['within_10_cap']}% -> {oh['within_10_cap']}%", flush=True)

print("\n" + "-"*80, flush=True)
print("VERGLEICH NACH STUDIO", flush=True)
print("-"*80, flush=True)
for g in sorted(gym_rows.keys()):
    bg = stats(results_gym[models[0]][g])
    og = stats(results_gym[models[1]][g])
    delta_mae = og['mae'] - bg['mae']
    print(f"  {g:26s}: Baseline MAE={bg['mae']:5.2f} -> Opt MAE={og['mae']:5.2f} ({delta_mae:+5.2f}) | <=10% Cap: {bg['within_10_cap']}% -> {og['within_10_cap']}%", flush=True)

with open('scripts/validation_optimized_results.json', 'w', encoding='utf-8') as f:
    json.dump({
        'baseline': base_st,
        'optimized': opt_st,
        'by_horizon': {h: {'base': stats(results_horizon[models[0]][h]), 'opt': stats(results_horizon[models[1]][h])} for h in range(13)},
        'by_gym': {g: {'base': stats(results_gym[models[0]][g]), 'opt': stats(results_gym[models[1]][g])} for g in sorted(gym_rows.keys())}
    }, f, indent=2, ensure_ascii=False)
