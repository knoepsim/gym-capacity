import csv
import json
import math
from datetime import datetime, timezone, timedelta
from collections import defaultdict
# Central European Summer Time (CEST) is UTC+2 from March 29 to October 25, 2026.
# Entire dataset (April 21 to October 7, 2026) is strictly in CEST (UTC+2).
BERLIN_TZ = timezone(timedelta(hours=2))


def mean(values):
    vals = [v for v in values if math.isfinite(v)]
    if not vals:
        return None
    return sum(vals) / len(vals)

def median(values):
    vals = [v for v in values if math.isfinite(v)]
    if not vals:
        return None
    vals.sort()
    mid = len(vals) // 2
    if len(vals) % 2 == 0:
        return (vals[mid - 1] + vals[mid]) / 2.0
    return vals[mid]

def detect_ramp_start(hourly_averages, low_threshold, max_capacity):
    rising_threshold = max(4, round(max_capacity * 0.08))
    for hour in range(4, 12):
        current = hourly_averages[hour]
        previous = hourly_averages[hour - 1] if hourly_averages[hour - 1] is not None else 0
        previous_two = hourly_averages[hour - 2] if hourly_averages[hour - 2] is not None else 0
        if (current is not None and
            current >= low_threshold and
            previous <= low_threshold and
            previous_two <= low_threshold and
            current - max(previous, previous_two) >= rising_threshold):
            return hour

    best_hour = None
    best_delta = 0
    for hour in range(4, 12):
        current = hourly_averages[hour]
        previous = hourly_averages[hour - 1]
        if current is None or previous is None:
            continue
        delta = current - previous
        if delta > best_delta and delta >= rising_threshold:
            best_delta = delta
            best_hour = hour
    return best_hour

def build_profiles(rows):
    day_buckets = {}
    for r in rows:
        day_key = r['local_day']
        weekday = r['weekday']
        hour = r['hour']
        count = r['count']
        max_cap = r['max_count']
        if day_key not in day_buckets:
            day_buckets[day_key] = {
                'weekday': weekday,
                'maxCapacity': max_cap,
                'hourlyValues': defaultdict(list)
            }
        b = day_buckets[day_key]
        b['maxCapacity'] = max(b['maxCapacity'], max_cap)
        b['hourlyValues'][hour].append(count)

    weekday_hour_profile = [[[] for _ in range(24)] for _ in range(7)]
    hour_profile = [[] for _ in range(24)]
    overall_profile = []
    max_capacity = 0

    for bucket in day_buckets.values():
        max_capacity = max(max_capacity, bucket['maxCapacity'])
        hourly_averages = [mean(bucket['hourlyValues'].get(h, [])) for h in range(24)]
        low_threshold = max(3, round(bucket['maxCapacity'] * 0.05))
        ramp_start = detect_ramp_start(hourly_averages, low_threshold, bucket['maxCapacity'])

        for hour in range(24):
            val = hourly_averages[hour]
            if val is None or val <= low_threshold:
                continue
            if ramp_start is not None and (hour >= ramp_start and hour <= ramp_start + 1):
                continue
            weekday_hour_profile[bucket['weekday']][hour].append(val)
            hour_profile[hour].append(val)
            overall_profile.append(val)

    return weekday_hour_profile, hour_profile, overall_profile, max_capacity, day_buckets

def infer_opening_hours(day_buckets):
    by_weekday = {wd: [] for wd in range(7)}
    for bucket in day_buckets.values():
        arr = [mean(bucket['hourlyValues'].get(h, [])) or 0.0 for h in range(24)]
        var_arr = []
        for h in range(24):
            vals = bucket['hourlyValues'].get(h, [])
            if len(vals) <= 1:
                var_arr.append(0)
            else:
                mx = max(vals)
                mn = min(vals)
                threshold = max(1, round(bucket['maxCapacity'] * 0.05)) if bucket['maxCapacity'] > 0 else 1
                if (mx - mn > 1) or ((mx - mn) >= threshold):
                    var_arr.append(1)
                else:
                    var_arr.append(0)
        by_weekday[bucket['weekday']].append(arr + var_arr)

    result = {}
    for wd in range(7):
        rows_w = by_weekday[wd]
        if not rows_w:
            result[wd] = None
            continue
        hour_scores = [0] * 24
        for r in rows_w:
            for h in range(24):
                mean_val = r[h]
                var_flag = r[h + 24]
                if var_flag >= 1 or mean_val >= 3:
                    hour_scores[h] += 1
        required = math.ceil(len(rows_w) * 0.35)
        open_h = 0
        close_h = 23
        for h in range(24):
            if hour_scores[h] >= required:
                open_h = h
                break
        for h in range(23, -1, -1):
            if hour_scores[h] >= required:
                close_h = h
                break
        if open_h >= close_h:
            result[wd] = None
        else:
            result[wd] = {'open': open_h, 'close': close_h}
    return result

def within_opening_hours(opening, weekday, hour):
    if not opening:
        return True
    w = opening.get(weekday)
    if not w:
        return True
    return w['open'] <= hour <= w['close']

def resolve_profile_value(wh_prof, h_prof, o_prof, weekday, hour, opening):
    if not within_opening_hours(opening, weekday, hour):
        return 0
    wm = median(wh_prof[weekday][hour])
    if wm is not None:
        return wm
    hm = median(h_prof[hour])
    if hm is not None:
        return hm
    om = median(o_prof)
    return om if om is not None else 0

def ewma(values, alpha=0.45):
    s = None
    for v in values:
        if s is None:
            s = v
        else:
            s = alpha * v + (1 - alpha) * s
    return s

def simulate_forecast(all_rows, sim_now):
    # sim_now is UTC datetime
    now_ms = sim_now.timestamp() * 1000
    lookback_ms = (sim_now - timedelta(days=56)).timestamp() * 1000

    # history in [now - 56d, now]
    history = [r for r in all_rows if lookback_ms <= r['time_ms'] <= now_ms]
    wh_prof, h_prof, o_prof, max_cap, day_buckets = build_profiles(history)
    opening = infer_opening_hours(day_buckets)

    sim_berlin = sim_now.astimezone(BERLIN_TZ)
    today_key = sim_berlin.strftime('%Y-%m-%d')
    # Sunday is 0 in JS:
    # Python weekday(): Monday is 0, Sunday is 6. JS weekday: Sunday is 0, Monday is 1.
    js_weekday = (sim_berlin.weekday() + 1) % 7
    cur_hour = sim_berlin.hour

    today_bucket = day_buckets.get(today_key)

    # slope over last 30 minutes
    win30_ms = (sim_now - timedelta(minutes=30)).timestamp() * 1000
    recent = [r for r in all_rows if win30_ms <= r['time_ms'] <= now_ms]

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

    actual_by_hour = {}
    if today_bucket:
        for h, vs in today_bucket['hourlyValues'].items():
            m = mean(vs)
            if m is not None:
                actual_by_hour[h] = m

    cur_samples = (today_bucket['hourlyValues'].get(cur_hour, [])[-12:]) if today_bucket else []
    nowcast_cur = ewma(cur_samples, 0.45) if cur_samples else None

    # maxCapacity from first bucket
    first_bucket_cap = next(iter(day_buckets.values()))['maxCapacity'] if day_buckets else max_cap

    series = []
    for h in range(24):
        actual = actual_by_hour.get(h)
        forecast = None
        if h < cur_hour:
            forecast = None
        elif h == cur_hour:
            if nowcast_cur is not None and len(cur_samples) >= 2:
                forecast = round(nowcast_cur)
            else:
                forecast = round(resolve_profile_value(wh_prof, h_prof, o_prof, js_weekday, h, opening))
        elif h == cur_hour + 1:
            baseline = resolve_profile_value(wh_prof, h_prof, o_prof, js_weekday, h, opening)
            if nowcast_cur is not None and len(cur_samples) >= 3:
                blended = round(0.7 * nowcast_cur + 0.3 * baseline)
                slope_adj = round(slope_per_10m * 6)
                forecast = max(0, min(blended + slope_adj, first_bucket_cap))
            else:
                slope_adj = round(slope_per_10m * 6)
                forecast = max(0, min(round(baseline) + slope_adj, first_bucket_cap))
        else:
            base = resolve_profile_value(wh_prof, h_prof, o_prof, js_weekday, h, opening)
            if h == cur_hour + 2:
                slope_adj = round(slope_per_10m * 12 * 0.5)
                forecast = max(0, min(round(base) + slope_adj, first_bucket_cap))
            else:
                forecast = round(base)

        series.append({
            'hour': h,
            'actual_count': round(actual) if actual is not None else None,
            'forecast_count': forecast
        })

    return series, opening

def main():
    print("Loading Occupancy.csv...")
    gym_rows = defaultdict(list)
    with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for r in reader:
            ts_str = r['timestamp'].replace(' ', 'T')
            if not ts_str.endswith('Z'):
                ts_str += 'Z'
            dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
            dt_berlin = dt.astimezone(BERLIN_TZ)
            js_wd = (dt_berlin.weekday() + 1) % 7
            gym_rows[r['gymId']].append({
                'time_ms': dt.timestamp() * 1000,
                'count': int(r['count']),
                'max_count': int(r['maxCount']),
                'local_day': dt_berlin.strftime('%Y-%m-%d'),
                'weekday': js_wd,
                'hour': dt_berlin.hour
            })

    print("Sorting rows...")
    for g in gym_rows:
        gym_rows[g].sort(key=lambda x: x['time_ms'])

    # Test against cache for karlsruhe-sued
    test_dt = datetime.fromisoformat("2026-10-07T08:16:50.574+00:00")
    sim_series, opening = simulate_forecast(gym_rows['karlsruhe-sued'], test_dt)
    print("Simulated series for karlsruhe-sued at", test_dt.isoformat())
    print(json.dumps(sim_series, indent=2))

    # Read ground truth from GymAnalyticsCache.csv
    print("\nReading ground truth from GymAnalyticsCache.csv...")
    with open('test/GymAnalyticsCache.csv', 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row['gymId'] == 'karlsruhe-sued':
                payload = json.loads(row['payload'])
                gt_series = payload['dailySeries']
                print("Ground truth series:")
                print(json.dumps(gt_series, indent=2))

                # Compare
                diffs = []
                for s, g in zip(sim_series, gt_series):
                    if s != g:
                        diffs.append((s, g))
                if not diffs:
                    print("\n>>> PERFECT 100% MATCH! ALL 24 HOURS ARE IDENTICAL! <<<")
                else:
                    print(f"\nDifferences found ({len(diffs)}):")
                    for s, g in diffs:
                        print("Sim:", s, "GT:", g)
                break

if __name__ == '__main__':
    main()
