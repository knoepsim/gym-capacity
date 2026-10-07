import csv
import json
import math
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

# Test Karlruhe-sued morning profile with and without ramp filter
gym_rows = []
with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        if row['gymId'] == 'karlsruhe-sued':
            ts = row['timestamp'].replace(' ', 'T')
            if not ts.endswith('Z'): ts += 'Z'
            dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
            gym_rows.append({
                'time_ms': dt.timestamp() * 1000,
                'count': int(row['count']),
                'max_count': int(row['maxCount']),
                'local_day': dt.astimezone(BERLIN_TZ).strftime('%Y-%m-%d'),
                'weekday': (dt.astimezone(BERLIN_TZ).weekday() + 1) % 7,
                'hour': dt.astimezone(BERLIN_TZ).hour
            })

gym_rows.sort(key=lambda x: x['time_ms'])

# Let's inspect what profile Karlsruhe-sued produces at hours 6, 7, 8
sim_dt = datetime(2026, 10, 6, 8, 0, tzinfo=BERLIN_TZ)
now_ms = sim_dt.timestamp() * 1000
lookback_ms = now_ms - 56 * 86400 * 1000
history = [r for r in gym_rows if lookback_ms <= r['time_ms'] <= now_ms]

day_buckets = {}
for r in history:
    dk = r['local_day']
    if dk not in day_buckets:
        day_buckets[dk] = {'weekday': r['weekday'], 'maxCapacity': r['max_count'], 'hourlyValues': defaultdict(list)}
    day_buckets[dk]['hourlyValues'][r['hour']].append(r['count'])

wh_filtered = [[[] for _ in range(24)] for _ in range(7)]
wh_unfiltered = [[[] for _ in range(24)] for _ in range(7)]

for bucket in day_buckets.values():
    has = [mean(bucket['hourlyValues'].get(h, [])) for h in range(24)]
    low_th = max(3, round(bucket['maxCapacity'] * 0.05))
    rs = detect_ramp_start(has, low_th, bucket['maxCapacity'])
    for h in range(24):
        val = has[h]
        if val is None or val <= low_th: continue
        wh_unfiltered[bucket['weekday']][h].append(val)
        if rs is not None and rs <= h <= rs + 1:
            continue
        wh_filtered[bucket['weekday']][h].append(val)

print("Weekday 2 (Tuesday) Profile for Karlsruhe-Sued:")
for h in range(5, 12):
    mf = median(wh_filtered[2][h])
    mu = median(wh_unfiltered[2][h])
    print(f"Hour {h:02d}: Filtered={mf} (count {len(wh_filtered[2][h])}) | Unfiltered={mu} (count {len(wh_unfiltered[2][h])})")
