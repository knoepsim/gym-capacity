import csv
from datetime import datetime, timezone, timedelta

BERLIN_TZ = timezone(timedelta(hours=2))

rows = []
with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        if row['gymId'] == 'freiburg-west':
            ts_str = row['timestamp'].replace(' ', 'T')
            if not ts_str.endswith('Z'): ts_str += 'Z'
            dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).astimezone(BERLIN_TZ)
            rows.append((dt, int(row['count'])))

rows.sort(key=lambda x: x[0])

# Look at Sunday evening (closing at 21:00) into Monday morning (opening at 07:00)
target_start = datetime(2026, 9, 20, 20, 0, tzinfo=BERLIN_TZ)
target_end = datetime(2026, 9, 21, 9, 0, tzinfo=BERLIN_TZ)

print("Raw timestamps and counts for Freiburg-West (Sun 20:00 to Mon 09:00):")
for dt, cnt in rows:
    if target_start <= dt <= target_end:
        print(f"{dt.strftime('%Y-%m-%d %H:%M:%S')} : count = {cnt}")

# Also look at Wednesday night (closing at 23:00) into Thursday morning (opening at 07:00)
target_start_wed = datetime(2026, 9, 23, 22, 0, tzinfo=BERLIN_TZ)
target_end_wed = datetime(2026, 9, 24, 8, 30, tzinfo=BERLIN_TZ)

print("\nRaw timestamps and counts for Freiburg-West (Wed 22:00 to Thu 08:30):")
for dt, cnt in rows:
    if target_start_wed <= dt <= target_end_wed:
        print(f"{dt.strftime('%Y-%m-%d %H:%M:%S')} : count = {cnt}")

rows_ks = []
with open('test/Occupancy.csv', 'r', encoding='utf-8') as f:
    r = csv.DictReader(f)
    for row in r:
        if row['gymId'] == 'karlsruhe-sued':
            ts_str = row['timestamp'].replace(' ', 'T')
            if not ts_str.endswith('Z'): ts_str += 'Z'
            dt = datetime.fromisoformat(ts_str.replace('Z', '+00:00')).astimezone(BERLIN_TZ)
            rows_ks.append((dt, int(row['count'])))
rows_ks.sort(key=lambda x: x[0])

print("\nRaw readings for Karlsruhe-Sued (24h gym) Wed 23:00 to Thu 05:00:")
for dt, cnt in rows_ks:
    if target_start_wed <= dt <= target_start_wed + timedelta(hours=6):
        print(f"{dt.strftime('%Y-%m-%d %H:%M:%S')} : count = {cnt}")

