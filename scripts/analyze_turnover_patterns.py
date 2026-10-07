import csv
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import math

BERLIN_TZ = timezone(timedelta(hours=2))

def analyze_gym(gym_id):
    rows = []
    with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            if row['gymId'] == gym_id:
                ts_str = row['timestamp'].replace(' ', 'T')
                if not ts_str.endswith('Z'): ts_str += 'Z'
                dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).astimezone(BERLIN_TZ)
                rows.append((dt, int(row['count'])))

    rows.sort(key=lambda x: x[0])

    # For each sample, compute abs(delta) from previous sample
    # Group by (weekday, hour)
    wd_h_changes = defaultdict(lambda: defaultdict(list)) # 1 if count changed, 0 if flat
    wd_h_abs_deltas = defaultdict(lambda: defaultdict(list))
    wd_h_hourly_range = defaultdict(lambda: defaultdict(list)) # max - min in the hour on a given date
    wd_h_counts = defaultdict(lambda: defaultdict(list))

    # Group rows by date
    by_date_hour = defaultdict(lambda: defaultdict(list))
    for i in range(1, len(rows)):
        dt, cnt = rows[i]
        prev_dt, prev_cnt = rows[i-1]
        delta_min = (dt - prev_dt).total_seconds() / 60.0
        if 4.0 <= delta_min <= 6.5: # 5-min intervals
            wd = (dt.weekday() + 1) % 7
            h = dt.hour
            d_str = dt.strftime('%Y-%m-%d')
            diff = abs(cnt - prev_cnt)
            wd_h_abs_deltas[wd][h].append(diff)
            wd_h_changes[wd][h].append(1 if diff > 0 else 0)
            by_date_hour[d_str][h].append(cnt)

    for d_str, h_dict in by_date_hour.items():
        dt = datetime.strptime(d_str, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
        wd = (dt.weekday() + 1) % 7
        for h, cnts in h_dict.items():
            if cnts:
                rng = max(cnts) - min(cnts)
                wd_h_hourly_range[wd][h].append(rng)
                wd_h_counts[wd][h].append(sum(cnts) / len(cnts))

    return wd_h_changes, wd_h_abs_deltas, wd_h_hourly_range, wd_h_counts

print("Analyzing Freiburg-West and Karlsruhe-Sued...")
fw_changes, fw_deltas, fw_ranges, fw_counts = analyze_gym('freiburg-west')
ks_changes, ks_deltas, ks_ranges, ks_counts = analyze_gym('karlsruhe-sued')

wd_names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

print("\n=== FREIBURG-WEST: % der 5-Min-Samples mit Änderung (Turnover-Aktivität) ===")
header = 'Hour | ' + ' | '.join(f'{wd_names[w]:6s}' for w in range(7))
print(header)
for h in range(24):
    line = f'{h:02d}:00 | '
    cols = []
    for w in range(7):
        ch = fw_changes[w][h]
        pct = (sum(ch) / len(ch) * 100) if ch else 0
        cols.append(f'{pct:5.1f}%')
    print(line + ' | '.join(cols))

print("\n=== FREIBURG-WEST: Mittlere Spannweite (Max - Min) innerhalb der Stunde ===")
print(header)
for h in range(24):
    line = f'{h:02d}:00 | '
    cols = []
    for w in range(7):
        rg = fw_ranges[w][h]
        avg_r = (sum(rg) / len(rg)) if rg else 0
        cols.append(f'{avg_r:5.1f} ')
    print(line + ' | '.join(cols))

print("\n=== KARLSRUHE-SUED (24h): % der 5-Min-Samples mit Änderung ===")
print(header)
for h in range(24):
    line = f'{h:02d}:00 | '
    cols = []
    for w in range(7):
        ch = ks_changes[w][h]
        pct = (sum(ch) / len(ch) * 100) if ch else 0
        cols.append(f'{pct:5.1f}%')
    print(line + ' | '.join(cols))
