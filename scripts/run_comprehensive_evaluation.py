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
    simulate_forecast,
)

def run_evaluation():
    t_start = time.time()
    print("=== Loading Occupancy.csv ===")
    gym_rows = defaultdict(list)
    # Store all raw rows per gym
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
                'hour': dt_berlin.hour,
                'minute': dt_berlin.minute,
                'dt_utc': dt
            })

    print("Sorting rows by timestamp...")
    for g in gym_rows:
        gym_rows[g].sort(key=lambda x: x['time_ms'])

    # Precompute true actual hourly means for each gym, day, and hour
    # key: (gymId, local_day, hour) -> true_mean
    print("Precomputing true actuals...")
    actual_hourly_means = {}
    actual_hourly_samples = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    gym_max_capacities = {}

    for g, rows in gym_rows.items():
        for r in rows:
            day = r['local_day']
            h = r['hour']
            actual_hourly_samples[g][day][h].append(r['count'])
            gym_max_capacities[g] = max(gym_max_capacities.get(g, 0), r['max_count'])

    for g in actual_hourly_samples:
        for day in actual_hourly_samples[g]:
            for h, vals in actual_hourly_samples[g][day].items():
                m = mean(vals)
                if m is not None:
                    actual_hourly_means[(g, day, h)] = round(m)

    # Define the 12-week evaluation period:
    # From 2026-07-15 to 2026-10-06 (84 days)
    end_date = datetime(2026, 10, 6, tzinfo=BERLIN_TZ)
    start_date = end_date - timedelta(days=83) # 84 days total

    eval_days = []
    cur = start_date
    while cur <= end_date:
        eval_days.append(cur.strftime('%Y-%m-%d'))
        cur += timedelta(days=1)

    print(f"Evaluation window: {eval_days[0]} to {eval_days[-1]} ({len(eval_days)} days / 12 weeks)")
    print(f"Gyms: {list(gym_rows.keys())}")

    # Simulation query hours (Europe/Berlin time):
    # 1. Standard user times: 08:00, 12:00, 16:00, 19:00
    # 2. Granular lead time times: 07:00, 09:00, 11:00, 13:00, 15:00, 17:00, 19:00, 21:00
    sim_hours = [7, 9, 11, 13, 15, 17, 19, 21]

    # Containers for results
    # Each item: { gymId, date, weekday, sim_hour, target_hour, horizon, actual, forecast, error, abs_error, max_cap }
    forecast_results = []

    # Daily peak evaluation:
    # At 08:00 (morning) and 12:00 (lunch), what was the forecasted peak vs actual peak for hours 08..22?
    peak_evaluations = []

    total_simulations = len(eval_days) * len(sim_hours) * len(gym_rows)
    print(f"Running {total_simulations} forecast simulations...")

    sim_count = 0
    t0_sim = time.time()

    for day_str in eval_days:
        day_dt = datetime.strptime(day_str, '%Y-%m-%d').replace(tzinfo=BERLIN_TZ)
        js_wd = (day_dt.weekday() + 1) % 7

        for sim_h in sim_hours:
            # Simulated query time: day_dt at sim_h:20 Berlin time (realistic mid-hour fetch)
            sim_dt_berlin = day_dt.replace(hour=sim_h, minute=20, second=0)
            sim_dt_utc = sim_dt_berlin.astimezone(timezone.utc)

            for gym_id, rows in gym_rows.items():
                sim_count += 1
                series, opening, max_cap = simulate_forecast(rows, sim_dt_utc)
                cap = gym_max_capacities.get(gym_id, max_cap)

                # Collect forecasted hours for target_hour >= sim_h
                for item in series:
                    target_h = item['hour']
                    forecast = item['forecast_count']
                    if target_h < sim_h or forecast is None:
                        continue

                    # True actual for target_h on that day
                    actual = actual_hourly_means.get((gym_id, day_str, target_h))
                    if actual is None:
                        continue

                    horizon = target_h - sim_h # 0 = current hour, 1 = +1h, etc.
                    error = forecast - actual
                    abs_error = abs(error)

                    forecast_results.append({
                        'gym_id': gym_id,
                        'date': day_str,
                        'weekday': js_wd,
                        'sim_hour': sim_h,
                        'target_hour': target_h,
                        'horizon': horizon,
                        'actual': actual,
                        'forecast': forecast,
                        'error': error,
                        'abs_error': abs_error,
                        'rel_error_cap': (abs_error / cap) * 100.0,
                        'max_cap': cap
                    })

                # Peak evaluation at 08:00 and 12:00
                if sim_h in (7, 9, 11):
                    # Actual peak in operating hours (07..22)
                    day_actuals = [(h, actual_hourly_means.get((gym_id, day_str, h))) for h in range(7, 23) if actual_hourly_means.get((gym_id, day_str, h)) is not None]
                    # Forecasted peak in operating hours (07..22)
                    day_forecasts = [(item['hour'], item['forecast_count']) for item in series if 7 <= item['hour'] <= 22 and item['forecast_count'] is not None]

                    if day_actuals and day_forecasts:
                        actual_peak_h, actual_peak_val = max(day_actuals, key=lambda x: x[1])
                        fc_peak_h, fc_peak_val = max(day_forecasts, key=lambda x: x[1])

                        peak_evaluations.append({
                            'gym_id': gym_id,
                            'date': day_str,
                            'weekday': js_wd,
                            'sim_hour': sim_h,
                            'actual_peak_val': actual_peak_val,
                            'actual_peak_hour': actual_peak_h,
                            'fc_peak_val': fc_peak_val,
                            'fc_peak_hour': fc_peak_h,
                            'peak_val_diff': fc_peak_val - actual_peak_val,
                            'peak_val_abs_diff': abs(fc_peak_val - actual_peak_val),
                            'peak_hour_diff': abs(fc_peak_h - actual_peak_h),
                            'max_cap': cap
                        })

    t_sim_elapsed = time.time() - t0_sim
    print(f"Completed {sim_count} simulations in {t_sim_elapsed:.2f}s ({len(forecast_results)} evaluated forecast points)!")

    # Now calculate aggregation metrics
    def calc_metrics(items):
        if not items:
            return None
        n = len(items)
        mae = sum(x['abs_error'] for x in items) / n
        rmse = math.sqrt(sum(x['error'] ** 2 for x in items) / n)
        mean_bias = sum(x['error'] for x in items) / n
        mean_cap_err = sum(x['rel_error_cap'] for x in items) / n
        sum_actual = sum(x['actual'] for x in items)
        wape = (sum(x['abs_error'] for x in items) / sum_actual * 100.0) if sum_actual > 0 else 0.0

        within_3 = sum(1 for x in items if x['abs_error'] <= 3) / n * 100.0
        within_5 = sum(1 for x in items if x['abs_error'] <= 5) / n * 100.0
        within_10 = sum(1 for x in items if x['abs_error'] <= 10) / n * 100.0
        within_15 = sum(1 for x in items if x['abs_error'] <= 15) / n * 100.0
        within_5pct_cap = sum(1 for x in items if x['rel_error_cap'] <= 5.0) / n * 100.0
        within_10pct_cap = sum(1 for x in items if x['rel_error_cap'] <= 10.0) / n * 100.0
        within_15pct_cap = sum(1 for x in items if x['rel_error_cap'] <= 15.0) / n * 100.0

        return {
            'count': n,
            'mae': round(mae, 2),
            'rmse': round(rmse, 2),
            'bias': round(mean_bias, 2),
            'mean_cap_error_pct': round(mean_cap_err, 2),
            'wape_pct': round(wape, 2),
            'within_5_persons_pct': round(within_5, 1),
            'within_10_persons_pct': round(within_10, 1),
            'within_5pct_cap_pct': round(within_5pct_cap, 1),
            'within_10pct_cap_pct': round(within_10pct_cap, 1),
            'within_15pct_cap_pct': round(within_15pct_cap, 1),
        }

    # 1. Overall Metrics
    overall = calc_metrics(forecast_results)

    # 2. By Horizon (+0h, +1h, +2h, +3h, +4h, +5h, +6h..12h)
    by_horizon = {}
    for h in range(13):
        h_items = [x for x in forecast_results if x['horizon'] == h]
        if h_items:
            by_horizon[f"+{h}h"] = calc_metrics(h_items)

    # Horizon Groups
    horizon_groups = {
        'nowcast_0h': calc_metrics([x for x in forecast_results if x['horizon'] == 0]),
        'short_term_1h': calc_metrics([x for x in forecast_results if x['horizon'] == 1]),
        'near_term_2h': calc_metrics([x for x in forecast_results if x['horizon'] == 2]),
        'medium_term_3_5h': calc_metrics([x for x in forecast_results if 3 <= x['horizon'] <= 5]),
        'longer_term_6_12h': calc_metrics([x for x in forecast_results if 6 <= x['horizon'] <= 12]),
    }

    # 3. By Gym
    by_gym = {}
    for g in sorted(gym_rows.keys()):
        g_items = [x for x in forecast_results if x['gym_id'] == g]
        by_gym[g] = calc_metrics(g_items)

    # 4. By Day of Week (0=Sun, 1=Mon, ..., 6=Sat)
    weekday_names = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]
    by_weekday = {}
    for wd in range(7):
        wd_items = [x for x in forecast_results if x['weekday'] == wd]
        by_weekday[weekday_names[wd]] = calc_metrics(wd_items)

    # Weekdays vs Weekends
    workday_items = [x for x in forecast_results if 1 <= x['weekday'] <= 5]
    weekend_items = [x for x in forecast_results if x['weekday'] in (0, 6)]
    weekday_vs_weekend = {
        'Werktage (Mo-Fr)': calc_metrics(workday_items),
        'Wochenende (Sa-So)': calc_metrics(weekend_items)
    }

    # 5. By Target Hour of Day (Time slots)
    time_slots = {
        'Morgens (06:00 - 10:00)': [x for x in forecast_results if 6 <= x['target_hour'] <= 10],
        'Mittags (11:00 - 14:00)': [x for x in forecast_results if 11 <= x['target_hour'] <= 14],
        'Nachmittags (15:00 - 17:00)': [x for x in forecast_results if 15 <= x['target_hour'] <= 17],
        'Abend-Peak (18:00 - 21:00)': [x for x in forecast_results if 18 <= x['target_hour'] <= 21],
        'Spätabends (22:00 - 23:00)': [x for x in forecast_results if 22 <= x['target_hour'] <= 23]
    }
    by_time_slot = {k: calc_metrics(v) for k, v in time_slots.items()}

    # 6. Peak Evaluation Metrics
    peak_n = len(peak_evaluations)
    peak_metrics = {
        'count': peak_n,
        'mean_peak_val_abs_diff': round(sum(x['peak_val_abs_diff'] for x in peak_evaluations) / peak_n, 2),
        'mean_peak_val_bias': round(sum(x['peak_val_diff'] for x in peak_evaluations) / peak_n, 2),
        'mean_peak_hour_diff': round(sum(x['peak_hour_diff'] for x in peak_evaluations) / peak_n, 2),
        'peak_hour_exact_pct': round(sum(1 for x in peak_evaluations if x['peak_hour_diff'] == 0) / peak_n * 100.0, 1),
        'peak_hour_within_1h_pct': round(sum(1 for x in peak_evaluations if x['peak_hour_diff'] <= 1) / peak_n * 100.0, 1),
        'peak_val_within_10pct_cap_pct': round(sum(1 for x in peak_evaluations if (x['peak_val_abs_diff'] / x['max_cap']) <= 0.10) / peak_n * 100.0, 1),
    }

    # 7. Weekly evolution / stability over the 12 weeks
    # Group by calendar week or week index (Week 1 to Week 12)
    by_week_index = {}
    for w in range(12):
        w_start_str = eval_days[w * 7]
        w_end_str = eval_days[min((w + 1) * 7 - 1, len(eval_days) - 1)]
        w_items = [x for x in forecast_results if w_start_str <= x['date'] <= w_end_str]
        by_week_index[f"Woche {w+1} ({w_start_str} bis {w_end_str})"] = calc_metrics(w_items)

    # 8. Comparison of +1h forecast: Blended Nowcast vs Pure Baseline
    # Let's inspect cases where slope and nowcast moved the prediction
    report = {
        'window': {
            'start': eval_days[0],
            'end': eval_days[-1],
            'weeks': 12,
            'days': len(eval_days)
        },
        'overall': overall,
        'horizon_groups': horizon_groups,
        'by_horizon': by_horizon,
        'by_gym': by_gym,
        'by_weekday': by_weekday,
        'weekday_vs_weekend': weekday_vs_weekend,
        'by_time_slot': by_time_slot,
        'peak_metrics': peak_metrics,
        'by_week_index': by_week_index,
    }

    out_json = 'scripts/forecast_evaluation_results.json'
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"Results saved to {out_json}")

    # Print summary report to console
    print("\n" + "="*80)
    print("PROGNOSE-QUALITÄTSBERICHT (LETZTE 12 WOCHEN)")
    print("="*80)
    print(f"Zeitraum: {eval_days[0]} bis {eval_days[-1]} ({len(eval_days)} Tage, 6 Studios)")
    print(f"Gesamtanzahl evaluierte Prognosepunkte: {overall['count']:,}")
    print(f"MAE (Mittlerer absoluter Fehler):       {overall['mae']} Personen")
    print(f"RMSE (Root Mean Squared Error):        {overall['rmse']} Personen")
    print(f"Mittlere relative Abweichung (% Kapazität): {overall['mean_cap_error_pct']}%")
    print(f"WAPE (Weighted Abs. Percentage Error): {overall['wape_pct']}%")
    print(f"Mittlerer Bias (Über-/Unterprognose):  {overall['bias']} Personen")
    print(f"Prognose innerhalb ±5 Personen:         {overall['within_5_persons_pct']}%")
    print(f"Prognose innerhalb ±10 Personen:        {overall['within_10_persons_pct']}%")
    print(f"Prognose innerhalb ±5% der Kapazität:   {overall['within_5pct_cap_pct']}%")
    print(f"Prognose innerhalb ±10% der Kapazität:  {overall['within_10pct_cap_pct']}%")
    print(f"Prognose innerhalb ±15% der Kapazität:  {overall['within_15pct_cap_pct']}%")

    print("\n" + "-"*80)
    print("QUALITÄT NACH VORLAUFZEIT (HORIZONT)")
    print("-"*80)
    for grp_name, m in horizon_groups.items():
        print(f"  {grp_name:20s}: MAE={m['mae']:5.2f} Pers | RMSE={m['rmse']:5.2f} | Kap-Fehler={m['mean_cap_error_pct']:4.1f}% | WAPE={m['wape_pct']:4.1f}% | Bias={m['bias']:+5.2f} | <=10% Kap: {m['within_10pct_cap_pct']}%")

    print("\n" + "-"*80)
    print("QUALITÄT NACH STUDIO")
    print("-"*80)
    for g, m in by_gym.items():
        cap = gym_max_capacities.get(g, 160)
        print(f"  {g:26s} (Max {cap:3d}): MAE={m['mae']:5.2f} Pers | Kap-Fehler={m['mean_cap_error_pct']:4.1f}% | WAPE={m['wape_pct']:4.1f}% | Bias={m['bias']:+5.2f} | <=10% Kap: {m['within_10pct_cap_pct']}%")

    print("\n" + "-"*80)
    print("QUALITÄT NACH TAGESZEIT (ZIEL-STUNDE)")
    print("-"*80)
    for slot, m in by_time_slot.items():
        print(f"  {slot:30s}: MAE={m['mae']:5.2f} Pers | Kap-Fehler={m['mean_cap_error_pct']:4.1f}% | WAPE={m['wape_pct']:4.1f}% | Bias={m['bias']:+5.2f}")

    print("\n" + "-"*80)
    print("PEAK-PROGNOSE (Tageshöchststand-Erkennung morgens/mittags)")
    print("-"*80)
    print(f"  Mittlerer Fehler Peak-Besucherzahl:   {peak_metrics['mean_peak_val_abs_diff']} Personen (Bias: {peak_metrics['mean_peak_val_bias']:+5.2f})")
    print(f"  Peak-Besucherzahl innerhalb ±10% Kap: {peak_metrics['peak_val_within_10pct_cap_pct']}%")
    print(f"  Mittlere Abweichung Peak-Uhrzeit:     {peak_metrics['mean_peak_hour_diff']:.2f} Stunden")
    print(f"  Peak-Uhrzeit exakt getroffen:         {peak_metrics['peak_hour_exact_pct']}%")
    print(f"  Peak-Uhrzeit innerhalb ±1 Stunde:     {peak_metrics['peak_hour_within_1h_pct']}%")

    print(f"\nGesamtlaufzeit: {time.time() - t_start:.2f}s")

if __name__ == '__main__':
    run_evaluation()
