import csv
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import math

BERLIN_TZ = timezone(timedelta(hours=2))

def mean(values):
    vals = [v for v in values if math.isfinite(v)]
    if not vals: return None
    return sum(vals) / len(vals)

def test_new_infer_algorithm(gym_id):
    rows = []
    with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            if row['gymId'] == gym_id:
                ts_str = row['timestamp'].replace(' ', 'T')
                if not ts_str.endswith('Z'): ts_str += 'Z'
                dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).astimezone(BERLIN_TZ)
                rows.append({
                    'count': int(row['count']),
                    'max_count': int(row['maxCount']),
                    'local_day': dt.strftime('%Y-%m-%d'),
                    'weekday': (dt.weekday() + 1) % 7,
                    'hour': dt.hour
                })

    # Group into day buckets
    day_buckets = {}
    for r in rows:
        dk = r['local_day']
        if dk not in day_buckets:
            day_buckets[dk] = {
                'weekday': r['weekday'],
                'maxCapacity': r['max_count'],
                'hourlyValues': defaultdict(list)
            }
        day_buckets[dk]['maxCapacity'] = max(day_buckets[dk]['maxCapacity'], r['max_count'])
        day_buckets[dk]['hourlyValues'][r['hour']].append(r['count'])

    by_weekday = {wd: [] for wd in range(7)}
    for bucket in day_buckets.values():
        var_arr = []
        for h in range(24):
            vals = bucket['hourlyValues'].get(h, [])
            if len(vals) <= 2:
                var_arr.append(0)
            else:
                mx = max(vals)
                mn = min(vals)
                # Count turnover transitions
                transitions = sum(1 for i in range(1, len(vals)) if vals[i] != vals[i-1])
                # An hour is considered active if range is >= 3 or transitions >= 3
                threshold = max(3, round(bucket['maxCapacity'] * 0.03))
                is_active = 1 if ((mx - mn) >= threshold or transitions >= 3) else 0
                var_arr.append(is_active)
        by_weekday[bucket['weekday']].append(var_arr)

    result = {}
    wd_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    
    for wd in range(7):
        rows_w = by_weekday[wd]
        if not rows_w:
            result[wd] = None
            continue
        hour_scores = [0] * 24
        for r in rows_w:
            for h in range(24):
                if r[h] == 1:
                    hour_scores[h] += 1
        
        # 35% threshold of days
        required = math.ceil(len(rows_w) * 0.35)
        
        active_hours = [h for h in range(24) if hour_scores[h] >= required]
        
        if len(active_hours) >= 22 and (0 in active_hours and 1 in active_hours and 2 in active_hours):
            result[wd] = {'open': 0, 'close': 23, 'is24h': True}
        elif active_hours:
            open_h = min(active_hours)
            close_h = max(active_hours)
            result[wd] = {'open': open_h, 'close': close_h, 'is24h': False}
        else:
            result[wd] = None
            
    return result

print("Testing new infer algorithm for all gyms...")
gyms = ['freiburg-west', 'karlsruhe-sued', 'freiburg-sued-sportprinz', 'freiburg-west-sportpark', 'hugstetten-sportpark', 'karlsruhe-west-sportprinz']
wd_names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

for g in gyms:
    res = test_new_infer_algorithm(g)
    print(f"\n=== {g} ===")
    for wd in range(7):
        info = res[wd]
        if info:
            if info.get('is24h'):
                print(f"  {wd_names[wd]}: 00:00 - 24:00 (24h geöffnet)")
            else:
                # Note: close_h is the last active hour, so operating until close_h + 1:00
                print(f"  {wd_names[wd]}: {info['open']:02d}:00 - {info['close']+1:02d}:00 (letzte aktive Stunde: {info['close']:02d}:00-{info['close']:02d}:59)")
        else:
            print(f"  {wd_names[wd]}: Geschlossen")
