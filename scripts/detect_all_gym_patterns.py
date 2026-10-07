import csv
from datetime import datetime, timezone, timedelta
from collections import defaultdict

BERLIN_TZ = timezone(timedelta(hours=2))

gym_rows = defaultdict(list)
with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        ts_str = row['timestamp'].replace(' ', 'T')
        if not ts_str.endswith('Z'): ts_str += 'Z'
        dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).astimezone(BERLIN_TZ)
        gym_rows[row['gymId']].append((dt, int(row['count'])))

wd_names = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

for g in sorted(gym_rows.keys()):
    rows = gym_rows[g]
    rows.sort(key=lambda x: x[0])
    wd_h_changes = defaultdict(lambda: defaultdict(list))
    for i in range(1, len(rows)):
        dt, cnt = rows[i]
        prev_dt, prev_cnt = rows[i-1]
        delta_min = (dt - prev_dt).total_seconds() / 60.0
        if 4.0 <= delta_min <= 6.5:
            wd = (dt.weekday() + 1) % 7
            h = dt.hour
            wd_h_changes[wd][h].append(1 if abs(cnt - prev_cnt) > 0 else 0)

    print(f"\n==================== {g} ====================")
    # Determine for each weekday which hours have > 30% turnover activity
    for wd in range(7):
        active_hours = []
        for h in range(24):
            ch = wd_h_changes[wd][h]
            pct = (sum(ch) / len(ch) * 100) if ch else 0
            if pct >= 35.0:
                active_hours.append(h)
        if active_hours:
            open_h = min(active_hours)
            close_h = max(active_hours)
            print(f"  {wd_names[wd]}: Active {open_h:02d}:00 - {close_h:02d}:59 (Hours: {len(active_hours)})")
        else:
            print(f"  {wd_names[wd]}: Inactive all day")
