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

print("Loading data...", flush=True)
t_start = time.time()
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

# Precompute true actuals
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

print(f"Data loaded in {time.time()-t_start:.1f}s. Running single-pass multi-strategy evaluation...", flush=True)

# Define strategies to compare
strategies = [
    'Baseline (Original)',
    'Strategy 1: No Slope (Pure Blend 0.6)',
    'Strategy 2: Delta Decay (0.5x, 0.2x)',
    'Strategy 3: Delta Decay + Damped Slope (0.2x slope, max +/-5% cap)',
    'Strategy 4: Pure Baseline for +1h & +2h',
    'Strategy 5: Recency Weighted (Lookback 42d) + Delta Decay'
]

strategy_errors = {s: [] for s in strategies}
strategy_horizon_errors = {s: defaultdict(list) for s in strategies}

t0_sim = time.time()
processed = 0
total_sims = len(eval_days) * len(sim_hours) * len(gym_rows)

for day_str in eval_days:
    day_dt = datetime.strptime(day_str, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
    js_wd = (day_dt.weekday() + 1) % 7

    for sim_h in sim_hours:
        sim_dt_berlin = day_dt.replace(hour=sim_h, minute=20, second=0)
        sim_dt_utc = sim_dt_berlin.astimezone(timezone.utc)
        now_ms = sim_dt_utc.timestamp() * 1000
        lookback_56_ms = (sim_dt_utc - timedelta(days=56)).timestamp() * 1000
        lookback_42_ms = (sim_dt_utc - timedelta(days=42)).timestamp() * 1000

        for gym_id, rows in gym_rows.items():
            cap = gym_max_caps[gym_id]
            history_56 = [r for r in rows if lookback_56_ms <= r['time_ms'] <= now_ms]

            # Build 56-day profiles
            day_buckets_56 = {}
            for r in history_56:
                dk = r['local_day']
                if dk not in day_buckets_56:
                    day_buckets_56[dk] = {
                        'weekday': r['weekday'],
                        'maxCapacity': r['max_count'],
                        'hourlyValues': defaultdict(list)
                    }
                day_buckets_56[dk]['maxCapacity'] = max(day_buckets_56[dk]['maxCapacity'], r['max_count'])
                day_buckets_56[dk]['hourlyValues'][r['hour']].append(r['count'])

            wh_56 = [[[] for _ in range(24)] for _ in range(7)]
            h_56 = [[] for _ in range(24)]
            o_56 = []

            for dk, bucket in day_buckets_56.items():
                hourly_averages = [mean(bucket['hourlyValues'].get(h, [])) for h in range(24)]
                low_th = max(3, round(bucket['maxCapacity'] * 0.05))
                ramp_start = detect_ramp_start(hourly_averages, low_th, bucket['maxCapacity'])

                for h in range(24):
                    val = hourly_averages[h]
                    if val is None or val <= low_th: continue
                    if ramp_start is not None and (h >= ramp_start and h <= ramp_start + 1): continue
                    wh_56[bucket['weekday']][h].append(val)
                    h_56[h].append(val)
                    o_56.append(val)

            opening_56 = infer_opening_hours(day_buckets_56)

            def get_base_56(h):
                if not within_opening_hours(opening_56, js_wd, h): return 0
                wm = median(wh_56[js_wd][h])
                if wm is not None: return wm
                hm = median(h_56[h])
                if hm is not None: return hm
                om = median(o_56)
                return om if om is not None else 0

            # 42-day profile for Strategy 5
            day_buckets_42 = {dk: b for dk, b in day_buckets_56.items() if (sim_dt_berlin - datetime.strptime(dk, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)).days <= 42}
            wh_42 = [[[] for _ in range(24)] for _ in range(7)]
            h_42 = [[] for _ in range(24)]
            o_42 = []
            for dk, bucket in day_buckets_42.items():
                hourly_averages = [mean(bucket['hourlyValues'].get(h, [])) for h in range(24)]
                low_th = max(3, round(bucket['maxCapacity'] * 0.05))
                ramp_start = detect_ramp_start(hourly_averages, low_th, bucket['maxCapacity'])
                for h in range(24):
                    val = hourly_averages[h]
                    if val is None or val <= low_th: continue
                    if ramp_start is not None and (h >= ramp_start and h <= ramp_start + 1): continue
                    wh_42[bucket['weekday']][h].append(val)
                    h_42[h].append(val)
                    o_42.append(val)
            opening_42 = infer_opening_hours(day_buckets_42)
            def get_base_42(h):
                if not within_opening_hours(opening_42, js_wd, h): return 0
                wm = median(wh_42[js_wd][h])
                if wm is not None: return wm
                hm = median(h_42[h])
                if hm is not None: return hm
                om = median(o_42)
                return om if om is not None else 0

            today_b = day_buckets_56.get(day_str)
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

            base_cur_56 = get_base_56(sim_h)
            cur_delta_56 = (nowcast_cur - base_cur_56) if (nowcast_cur is not None and len(cur_samples) >= 2) else 0.0

            base_cur_42 = get_base_42(sim_h)
            cur_delta_42 = (nowcast_cur - base_cur_42) if (nowcast_cur is not None and len(cur_samples) >= 2) else 0.0

            # Forecast for all target hours >= sim_h
            for target_h in range(sim_h, 24):
                act = actual_hourly_means.get((gym_id, day_str, target_h))
                if act is None: continue
                horizon = target_h - sim_h

                base_val_56 = get_base_56(target_h)
                base_val_42 = get_base_42(target_h)

                # Now calculate forecast for each strategy
                # Strategy: Baseline
                if horizon == 0:
                    fc_base = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(base_val_56)
                elif horizon == 1:
                    if nowcast_cur is not None and len(cur_samples) >= 3:
                        blended = round(0.7 * nowcast_cur + 0.3 * base_val_56)
                        fc_base = max(0, min(blended + round(slope_per_10m * 6), cap))
                    else:
                        fc_base = max(0, min(round(base_val_56) + round(slope_per_10m * 6), cap))
                elif horizon == 2:
                    fc_base = max(0, min(round(base_val_56) + round(slope_per_10m * 12 * 0.5), cap))
                else:
                    fc_base = round(base_val_56)

                # Strategy 1: No Slope (Pure Blend 0.6)
                if horizon == 0:
                    fc_s1 = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(base_val_56)
                elif horizon == 1:
                    fc_s1 = round(0.6 * nowcast_cur + 0.4 * base_val_56) if (nowcast_cur is not None and len(cur_samples) >= 3) else round(base_val_56)
                else:
                    fc_s1 = round(base_val_56)

                # Strategy 2: Delta Decay (0.5x at +1h, 0.2x at +2h, then baseline)
                if horizon == 0:
                    fc_s2 = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(base_val_56)
                elif horizon == 1:
                    fc_s2 = max(0, min(round(base_val_56 + 0.5 * cur_delta_56), cap))
                elif horizon == 2:
                    fc_s2 = max(0, min(round(base_val_56 + 0.2 * cur_delta_56), cap))
                else:
                    fc_s2 = round(base_val_56)

                # Strategy 3: Delta Decay + Damped Slope
                if horizon == 0:
                    fc_s3 = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(base_val_56)
                elif horizon == 1:
                    max_adj = round(cap * 0.05)
                    raw_adj = round(slope_per_10m * 6 * 0.2)
                    adj = max(-max_adj, min(raw_adj, max_adj))
                    fc_s3 = max(0, min(round(base_val_56 + 0.5 * cur_delta_56) + adj, cap))
                elif horizon == 2:
                    fc_s3 = max(0, min(round(base_val_56 + 0.2 * cur_delta_56), cap))
                else:
                    fc_s3 = round(base_val_56)

                # Strategy 4: Pure Baseline for +1h & +2h
                if horizon == 0:
                    fc_s4 = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(base_val_56)
                else:
                    fc_s4 = round(base_val_56)

                # Strategy 5: Lookback 42d + Delta Decay
                if horizon == 0:
                    fc_s5 = round(nowcast_cur) if (nowcast_cur is not None and len(cur_samples) >= 2) else round(base_val_42)
                elif horizon == 1:
                    fc_s5 = max(0, min(round(base_val_42 + 0.5 * cur_delta_42), cap))
                elif horizon == 2:
                    fc_s5 = max(0, min(round(base_val_42 + 0.2 * cur_delta_42), cap))
                else:
                    fc_s5 = round(base_val_42)

                fcs = [fc_base, fc_s1, fc_s2, fc_s3, fc_s4, fc_s5]
                for strat, fc in zip(strategies, fcs):
                    err = fc - act
                    abs_err = abs(err)
                    strategy_errors[strat].append((err, abs_err, act, cap))
                    strategy_horizon_errors[strat][horizon].append((err, abs_err, act, cap))

            processed += 1
            if processed % 500 == 0:
                print(f"Processed {processed}/{total_sims} simulations ({time.time()-t0_sim:.1f}s)...", flush=True)

print("\n" + "="*95, flush=True)
print(f"ERGEBNISSE DER STRATEGIE-VERGLEICHSANALYSE ({len(eval_days)} Tage, {processed} Simulationen)", flush=True)
print("="*95, flush=True)
print(f"{'Strategie':40s} | {'MAE':6s} | {'RMSE':6s} | {'Kap-Err':7s} | {'WAPE':6s} | {'Bias':6s} | {'<=10%':5s} | {'+1h MAE':7s} | {'+2h MAE':7s}", flush=True)
print("-"*95, flush=True)

results_summary = {}

for strat in strategies:
    errs = strategy_errors[strat]
    n = len(errs)
    mae = sum(x[1] for x in errs) / n
    rmse = math.sqrt(sum(x[0]**2 for x in errs) / n)
    bias = sum(x[0] for x in errs) / n
    cap_err = sum((x[1] / x[3]) * 100 for x in errs) / n
    wape = sum(x[1] for x in errs) / sum(x[2] for x in errs) * 100
    within_10 = sum(1 for x in errs if (x[1] / x[3]) <= 0.10) / n * 100

    h1_errs = strategy_horizon_errors[strat][1]
    h2_errs = strategy_horizon_errors[strat][2]
    mae_1h = sum(x[1] for x in h1_errs) / len(h1_errs) if h1_errs else 0
    mae_2h = sum(x[1] for x in h2_errs) / len(h2_errs) if h2_errs else 0

    results_summary[strat] = {
        'mae': round(mae, 2),
        'rmse': round(rmse, 2),
        'cap_err': round(cap_err, 2),
        'wape': round(wape, 2),
        'bias': round(bias, 2),
        'within_10': round(within_10, 1),
        'mae_1h': round(mae_1h, 2),
        'mae_2h': round(mae_2h, 2)
    }

    print(f"{strat:40s} | {mae:6.2f} | {rmse:6.2f} | {cap_err:6.1f}% | {wape:5.1f}% | {bias:+6.2f} | {within_10:4.1f}% | {mae_1h:7.2f} | {mae_2h:7.2f}", flush=True)

with open('scripts/strategy_comparison_results.json', 'w', encoding='utf-8') as f:
    json.dump(results_summary, f, indent=2, ensure_ascii=False)

print(f"\nVergleich abgeschlossen in {time.time()-t_start:.1f}s!", flush=True)
