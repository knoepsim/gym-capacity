import csv
import json
import math
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

# Load data once
print("Loading data for optimization tests...")
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

print(f"Data ready. Testing {len(eval_days)} days x {len(sim_hours)} hours x {len(gym_rows)} gyms...")

# Function to run simulation with configurable parameters
def evaluate_variant(variant_name, lookback_days=56, recency_weights=False, slope_mode='original', blend_1h=0.7, fix_ramp=False):
    t0 = time.time()
    errors = []
    errors_by_horizon = defaultdict(list)
    cap_errors = []

    for day_str in eval_days:
        day_dt = datetime.strptime(day_str, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
        js_wd = (day_dt.weekday() + 1) % 7

        for sim_h in sim_hours:
            sim_dt_berlin = day_dt.replace(hour=sim_h, minute=20, second=0)
            sim_dt_utc = sim_dt_berlin.astimezone(timezone.utc)
            now_ms = sim_dt_utc.timestamp() * 1000
            lookback_ms = (sim_dt_utc - timedelta(days=lookback_days)).timestamp() * 1000

            for gym_id, rows in gym_rows.items():
                cap = gym_max_caps[gym_id]
                history = [r for r in rows if lookback_ms <= r['time_ms'] <= now_ms]

                # Group into day buckets
                day_buckets = {}
                for r in history:
                    dk = r['local_day']
                    if dk not in day_buckets:
                        day_buckets[dk] = {
                            'weekday': r['weekday'],
                            'maxCapacity': r['max_count'],
                            'hourlyValues': defaultdict(list),
                            'date_str': dk
                        }
                    b = day_buckets[dk]
                    b['maxCapacity'] = max(b['maxCapacity'], r['max_count'])
                    b['hourlyValues'][r['hour']].append(r['count'])

                wh_prof = [[[] for _ in range(24)] for _ in range(7)]
                h_prof = [[] for _ in range(24)]
                o_prof = []

                # Build profiles
                for dk, bucket in day_buckets.items():
                    hourly_averages = [mean(bucket['hourlyValues'].get(h, [])) for h in range(24)]
                    low_th = max(3, round(bucket['maxCapacity'] * 0.05))
                    ramp_start = detect_ramp_start(hourly_averages, low_th, bucket['maxCapacity'])

                    # Recency weight: recent weeks have more replicas in profile
                    if recency_weights:
                        b_dt = datetime.strptime(dk, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
                        age_days = (sim_dt_berlin - b_dt).days
                        # Last 14 days get weight 3, days 15-28 weight 2, older weight 1
                        weight = 3 if age_days <= 14 else (2 if age_days <= 28 else 1)
                    else:
                        weight = 1

                    for h in range(24):
                        val = hourly_averages[h]
                        if val is None or val <= low_th:
                            continue
                        if not fix_ramp:
                            if ramp_start is not None and (h >= ramp_start and h <= ramp_start + 1):
                                continue

                        for _ in range(weight):
                            wh_prof[bucket['weekday']][h].append(val)
                            h_prof[h].append(val)
                            o_prof.append(val)

                opening = infer_opening_hours(day_buckets)

                def resolve_val(wd, h):
                    if not within_opening_hours(opening, wd, h):
                        return 0
                    wm = median(wh_prof[wd][h])
                    if wm is not None: return wm
                    hm = median(h_prof[h])
                    if hm is not None: return hm
                    om = median(o_prof)
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

                # Generate forecasts for target_h >= sim_h
                for target_h in range(sim_h, 24):
                    act = actual_hourly_means.get((gym_id, day_str, target_h))
                    if act is None: continue
                    horizon = target_h - sim_h

                    base_val = resolve_val(js_wd, target_h)

                    if horizon == 0:
                        if nowcast_cur is not None and len(cur_samples) >= 2:
                            fc = round(nowcast_cur)
                        else:
                            fc = round(base_val)
                    elif horizon == 1:
                        if slope_mode == 'original':
                            if nowcast_cur is not None and len(cur_samples) >= 3:
                                blended = round(0.7 * nowcast_cur + 0.3 * base_val)
                                fc = max(0, min(blended + round(slope_per_10m * 6), cap))
                            else:
                                fc = max(0, min(round(base_val) + round(slope_per_10m * 6), cap))
                        elif slope_mode == 'no_slope':
                            if nowcast_cur is not None and len(cur_samples) >= 3:
                                fc = round(blend_1h * nowcast_cur + (1 - blend_1h) * base_val)
                            else:
                                fc = round(base_val)
                        elif slope_mode == 'damped_slope':
                            # Damped slope: clamp max slope adjustment to +/- 5% capacity, damp by 0.25
                            max_adj = round(cap * 0.05)
                            raw_adj = round(slope_per_10m * 6 * 0.25)
                            adj = max(-max_adj, min(raw_adj, max_adj))
                            if nowcast_cur is not None and len(cur_samples) >= 3:
                                blended = round(blend_1h * nowcast_cur + (1 - blend_1h) * base_val)
                                fc = max(0, min(blended + adj, cap))
                            else:
                                fc = max(0, min(round(base_val) + adj, cap))
                        elif slope_mode == 'decay_delta':
                            # Blend baseline with current deviation: delta_0 = nowcast - base_0, decays to delta_1 = 0.5 * delta_0
                            if nowcast_cur is not None and len(cur_samples) >= 2:
                                base_cur = resolve_val(js_wd, sim_h)
                                delta = (nowcast_cur - base_cur) * 0.5
                                fc = max(0, min(round(base_val + delta), cap))
                            else:
                                fc = round(base_val)
                    elif horizon == 2:
                        if slope_mode == 'original':
                            fc = max(0, min(round(base_val) + round(slope_per_10m * 12 * 0.5), cap))
                        elif slope_mode in ('no_slope', 'damped_slope'):
                            fc = round(base_val)
                        elif slope_mode == 'decay_delta':
                            if nowcast_cur is not None and len(cur_samples) >= 2:
                                base_cur = resolve_val(js_wd, sim_h)
                                delta = (nowcast_cur - base_cur) * 0.25
                                fc = max(0, min(round(base_val + delta), cap))
                            else:
                                fc = round(base_val)
                    else:
                        fc = round(base_val)

                    err = fc - act
                    abs_err = abs(err)
                    errors.append((err, abs_err, act, cap))
                    errors_by_horizon[horizon].append((err, abs_err, act, cap))

    n = len(errors)
    mae = sum(x[1] for x in errors) / n
    rmse = math.sqrt(sum(x[0]**2 for x in errors) / n)
    bias = sum(x[0] for x in errors) / n
    mean_cap_err = sum((x[1] / x[3]) * 100 for x in errors) / n
    wape = sum(x[1] for x in errors) / sum(x[2] for x in errors) * 100
    within_10pct = sum(1 for x in errors if (x[1] / x[3]) <= 0.10) / n * 100

    mae_1h = sum(x[1] for x in errors_by_horizon[1]) / len(errors_by_horizon[1])
    mae_2h = sum(x[1] for x in errors_by_horizon[2]) / len(errors_by_horizon[2])

    print(f"[{variant_name:24s}] MAE: {mae:5.2f} Pers | RMSE: {rmse:5.2f} | Kap-Err: {mean_cap_err:4.1f}% | WAPE: {wape:4.1f}% | Bias: {bias:+5.2f} | <=10% Cap: {within_10pct:4.1f}% | +1h MAE: {mae_1h:5.2f} | +2h MAE: {mae_2h:5.2f} ({time.time()-t0:.1f}s)")
    return {
        'name': variant_name,
        'mae': mae, 'rmse': rmse, 'bias': bias, 'cap_err': mean_cap_err,
        'wape': wape, 'within_10pct': within_10pct,
        'mae_1h': mae_1h, 'mae_2h': mae_2h
    }

# 1. Baseline (Current Implementation)
evaluate_variant("1. Baseline (Current)", lookback_days=56, recency_weights=False, slope_mode='original')

# 2. No Slope (Pure blend + baseline)
evaluate_variant("2. No Slope", lookback_days=56, recency_weights=False, slope_mode='no_slope', blend_1h=0.7)

# 3. No Slope + blend 0.5
evaluate_variant("3. No Slope (blend 0.5)", lookback_days=56, recency_weights=False, slope_mode='no_slope', blend_1h=0.5)

# 4. Decaying Delta (deviation from baseline decays 50% at +1h, 25% at +2h)
evaluate_variant("4. Decaying Delta", lookback_days=56, recency_weights=False, slope_mode='decay_delta')

# 5. Lookback 35 days (5 weeks) instead of 56 days (8 weeks)
evaluate_variant("5. Lookback 35d + No Slope", lookback_days=35, recency_weights=False, slope_mode='no_slope', blend_1h=0.6)

# 6. Lookback 42 days (6 weeks) + Decaying Delta
evaluate_variant("6. Lookback 42d + Decay", lookback_days=42, recency_weights=False, slope_mode='decay_delta')

# 7. Recency Weighting (last 2 weeks x3, weeks 3-4 x2, older x1) + Decaying Delta
evaluate_variant("7. Recency Weighted + Decay", lookback_days=56, recency_weights=True, slope_mode='decay_delta')

# 8. Recency Weighting + No Slope
evaluate_variant("8. Recency Weighted + NoSlope", lookback_days=56, recency_weights=True, slope_mode='no_slope', blend_1h=0.6)
