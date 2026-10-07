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
    build_profiles,
    infer_opening_hours,
    resolve_profile_value,
    ewma
)

def compare_slope_ablation():
    print("Testing Slope Ablation on Karlsruhe-Sued and Freiburg-West...")
    gym_rows = defaultdict(list)
    with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            g = r['gymId']
            if g not in ('karlsruhe-sued', 'freiburg-west'):
                continue
            ts_str = r['timestamp'].replace(' ', 'T')
            if not ts_str.endswith('Z'): ts_str += 'Z'
            dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            dt_berlin = dt.astimezone(BERLIN_TZ)
            js_wd = (dt_berlin.weekday() + 1) % 7
            gym_rows[g].append({
                'time_ms': dt.timestamp() * 1000,
                'count': int(r['count']),
                'max_count': int(r['maxCount']),
                'local_day': dt_berlin.strftime('%Y-%m-%d'),
                'weekday': js_wd,
                'hour': dt_berlin.hour,
            })

    for g in gym_rows:
        gym_rows[g].sort(key=lambda x: x['time_ms'])

    # Precompute actuals
    actuals = {}
    for g, rows in gym_rows.items():
        hourly = defaultdict(lambda: defaultdict(list))
        for r in rows:
            hourly[r['local_day']][r['hour']].append(r['count'])
        for day in hourly:
            for h, vals in hourly[day].items():
                m = mean(vals)
                if m is not None:
                    actuals[(g, day, h)] = round(m)

    # Eval over last 4 weeks (28 days)
    end_date = datetime(2026, 10, 6, tzinfo=BERLIN_TZ)
    eval_days = [(end_date - timedelta(days=i)).strftime('%Y-%m-%d') for i in range(28)]
    sim_hours = [8, 12, 16, 18, 20]

    err_with_slope_1h = []
    err_no_slope_1h = []
    err_with_slope_2h = []
    err_no_slope_2h = []

    for day_str in eval_days:
        day_dt = datetime.strptime(day_str, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
        js_wd = (day_dt.weekday() + 1) % 7
        for sim_h in sim_hours:
            sim_dt_berlin = day_dt.replace(hour=sim_h, minute=20, second=0)
            sim_dt_utc = sim_dt_berlin.astimezone(timezone.utc)
            now_ms = sim_dt_utc.timestamp() * 1000
            lookback_ms = (sim_dt_utc - timedelta(days=56)).timestamp() * 1000

            for g, rows in gym_rows.items():
                history = [r for r in rows if lookback_ms <= r['time_ms'] <= now_ms]
                wh_prof, h_prof, o_prof, max_cap, day_buckets = build_profiles(history)
                opening = infer_opening_hours(day_buckets)

                today_bucket = day_buckets.get(day_str)
                win30_ms = (sim_dt_utc - timedelta(minutes=30)).timestamp() * 1000
                recent = [r for r in rows if win30_ms <= r['time_ms'] <= now_ms]

                slope_per_10m = 0.0
                if len(recent) >= 3:
                    times = [r['time_ms'] / 60000.0 for r in recent]
                    vals = [r['count'] for r in recent]
                    n = len(vals)
                    mean_t = sum(times) / n
                    mean_v = sum(vals) / n
                    num = sum((times[i] - mean_t) * (vals[i] - mean_v) for i in range(n))
                    den = sum((times[i] - mean_t) ** 2 for i in range(n))
                    slope_per_min = 0.0 if den == 0 else num / den
                    slope_per_10m = slope_per_min * 10.0

                cur_samples = (today_bucket['hourlyValues'].get(sim_h, [])[-12:]) if today_bucket else []
                nowcast_cur = ewma(cur_samples, 0.45) if cur_samples else None

                # Hour +1
                act_1h = actuals.get((g, day_str, sim_h + 1))
                if act_1h is not None and sim_h + 1 < 24:
                    base_1h = resolve_profile_value(wh_prof, h_prof, o_prof, js_wd, sim_h + 1, opening)
                    # Production logic
                    if nowcast_cur is not None and len(cur_samples) >= 3:
                        blended = round(0.7 * nowcast_cur + 0.3 * base_1h)
                        fc_with_slope = max(0, min(blended + round(slope_per_10m * 6), max_cap))
                        fc_no_slope = max(0, min(blended, max_cap))
                    else:
                        fc_with_slope = max(0, min(round(base_1h) + round(slope_per_10m * 6), max_cap))
                        fc_no_slope = round(base_1h)

                    err_with_slope_1h.append(abs(fc_with_slope - act_1h))
                    err_no_slope_1h.append(abs(fc_no_slope - act_1h))

                # Hour +2
                act_2h = actuals.get((g, day_str, sim_h + 2))
                if act_2h is not None and sim_h + 2 < 24:
                    base_2h = resolve_profile_value(wh_prof, h_prof, o_prof, js_wd, sim_h + 2, opening)
                    fc_with_slope_2 = max(0, min(round(base_2h) + round(slope_per_10m * 12 * 0.5), max_cap))
                    fc_no_slope_2 = round(base_2h)

                    err_with_slope_2h.append(abs(fc_with_slope_2 - act_2h))
                    err_no_slope_2h.append(abs(fc_no_slope_2 - act_2h))

    mae_with_1 = sum(err_with_slope_1h) / len(err_with_slope_1h)
    mae_no_1 = sum(err_no_slope_1h) / len(err_no_slope_1h)
    mae_with_2 = sum(err_with_slope_2h) / len(err_with_slope_2h)
    mae_no_2 = sum(err_no_slope_2h) / len(err_no_slope_2h)

    print(f"+1h MAE: With Slope = {mae_with_1:.2f} | WITHOUT Slope = {mae_no_1:.2f} (Delta: {mae_no_1 - mae_with_1:+.2f})")
    print(f"+2h MAE: With Slope = {mae_with_2:.2f} | WITHOUT Slope = {mae_no_2:.2f} (Delta: {mae_no_2 - mae_with_2:+.2f})")

if __name__ == '__main__':
    compare_slope_ablation()
