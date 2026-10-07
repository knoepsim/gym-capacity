import csv
from datetime import datetime, timezone, timedelta
from collections import defaultdict
import json

BERLIN_TZ = timezone(timedelta(hours=2))

gym_rows = defaultdict(list)
with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        ts_str = row['timestamp'].replace(' ', 'T')
        if not ts_str.endswith('Z'): ts_str += 'Z'
        dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).astimezone(BERLIN_TZ)
        gym_rows[row['gymId']].append((dt, int(row['count'])))

wd_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
german_wds = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

# Inferred schedule per gym
inferred_schedules = {}

for g in sorted(gym_rows.keys()):
    rows = gym_rows[g]
    rows.sort(key=lambda x: x[0])
    
    # Calculate sample-to-sample activity rate per (weekday, hour)
    wd_h_changes = defaultdict(lambda: defaultdict(list))
    wd_h_ranges = defaultdict(lambda: defaultdict(list))
    
    by_day_h = defaultdict(lambda: defaultdict(list))
    
    for i in range(1, len(rows)):
        dt, cnt = rows[i]
        prev_dt, prev_cnt = rows[i-1]
        delta_min = (dt - prev_dt).total_seconds() / 60.0
        if 4.0 <= delta_min <= 6.5:
            wd = (dt.weekday() + 1) % 7
            h = dt.hour
            d_str = dt.strftime('%Y-%m-%d')
            wd_h_changes[wd][h].append(1 if abs(cnt - prev_cnt) > 0 else 0)
            by_day_h[d_str][h].append(cnt)
            
    for d_str, h_dict in by_day_h.items():
        dt = datetime.strptime(d_str, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
        wd = (dt.weekday() + 1) % 7
        for h, cnts in h_dict.items():
            if cnts:
                wd_h_ranges[wd][h].append(max(cnts) - min(cnts))
                
    sched = {}
    print(f"\n==================== {g} ====================")
    for wd in range(7):
        # An hour is considered open/active if:
        # activity rate (% of 5-min intervals with changes) >= 30% AND avg range >= 2.0
        # (or for quiet night hours in 24h gym, activity >= 20%)
        active_hours = []
        for h in range(24):
            ch = wd_h_changes[wd][h]
            rg = wd_h_ranges[wd][h]
            act_rate = (sum(ch) / len(ch) * 100) if ch else 0
            avg_rg = (sum(rg) / len(rg)) if rg else 0
            
            # An hour is active if there is sustained turnover (>30% of 5-min intervals)
            if act_rate >= 30.0:
                active_hours.append(h)
                
        # Check if 24h: active across all 24 hours (or at least 21+ hours including 00..04)
        night_active = sum(1 for h in range(0, 5) if h in active_hours)
        if len(active_hours) >= 22 and night_active >= 4:
            sched[wd_names[wd]] = "00:00-24:00"
            print(f"  {german_wds[wd]:10s}: 00:00 - 24:00 (24h geöffnet)")
        elif active_hours:
            open_h = min(active_hours)
            # The closing time is the end of the last active hour + 1
            # E.g. if hour 22 (22:00-22:59) is active and 23 is inactive, it closes at 23:00!
            close_h = max(active_hours) + 1
            sched[wd_names[wd]] = f"{open_h:02d}:00-{close_h:02d}:00"
            print(f"  {german_wds[wd]:10s}: {open_h:02d}:00 - {close_h:02d}:00")
        else:
            sched[wd_names[wd]] = "closed"
            print(f"  {german_wds[wd]:10s}: Geschlossen")
            
    inferred_schedules[g] = sched

with open('scripts/inferred_opening_hours.json', 'w', encoding='utf-8') as f:
    json.dump(inferred_schedules, f, indent=2)
