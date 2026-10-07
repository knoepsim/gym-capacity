import csv
import sys
sys.path.insert(0, 'scripts')
from datetime import datetime, timezone, timedelta

from collections import defaultdict
from simulate_forecast_accuracy import (
    BERLIN_TZ,
    mean,
    build_profiles,
    infer_opening_hours
)

gym_rows = defaultdict(list)
with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        ts_str = row['timestamp'].replace(' ', 'T')
        if not ts_str.endswith('Z'): ts_str += 'Z'
        dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).astimezone(BERLIN_TZ)
        gym_rows[row['gymId']].append({
            'time_ms': dt.timestamp() * 1000,
            'count': int(row['count']),
            'max_count': int(row['maxCount']),
            'local_day': dt.strftime('%Y-%m-%d'),
            'weekday': (dt.weekday() + 1) % 7,
            'hour': dt.hour
        })

wd_names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

for g in sorted(gym_rows.keys()):
    wh, h, o, cap, buckets = build_profiles(gym_rows[g])
    opening = infer_opening_hours(buckets)
    print(f"=== {g} ===")
    for wd in range(7):
        w = opening[wd]
        if w:
            print(f"  {wd_names[wd]}: {w['open']:02d}:00 - {w['close']:02d}:00")
        else:
            print(f"  {wd_names[wd]}: Geschlossen / None")
