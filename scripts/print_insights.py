import json

with open('scripts/forecast_evaluation_results.json', 'r', encoding='utf-8') as f:
    d = json.load(f)

print('=== BY INDIVIDUAL HORIZON ===')
for h, m in d['by_horizon'].items():
    print(f'{h:5s}: MAE={m["mae"]:5.2f} | RMSE={m["rmse"]:5.2f} | Kap={m["mean_cap_error_pct"]:4.1f}% | WAPE={m["wape_pct"]:4.1f}% | Bias={m["bias"]:+.2f} | <=10% Kap: {m["within_10pct_cap_pct"]}%')

print('\n=== BY WEEKDAY ===')
for wd, m in d['by_weekday'].items():
    print(f'{wd:12s}: MAE={m["mae"]:5.2f} | RMSE={m["rmse"]:5.2f} | Kap={m["mean_cap_error_pct"]:4.1f}% | WAPE={m["wape_pct"]:4.1f}% | Bias={m["bias"]:+.2f} | <=10% Kap: {m["within_10pct_cap_pct"]}%')

print('\n=== WORKDAY VS WEEKEND ===')
for k, m in d['weekday_vs_weekend'].items():
    print(f'{k:20s}: MAE={m["mae"]:5.2f} | RMSE={m["rmse"]:5.2f} | Kap={m["mean_cap_error_pct"]:4.1f}% | WAPE={m["wape_pct"]:4.1f}% | Bias={m["bias"]:+.2f} | <=10% Kap: {m["within_10pct_cap_pct"]}%')

print('\n=== WEEKLY EVOLUTION (12 WEEKS) ===')
for w, m in d['by_week_index'].items():
    print(f'{w:35s}: MAE={m["mae"]:5.2f} | RMSE={m["rmse"]:5.2f} | Kap={m["mean_cap_error_pct"]:4.1f}% | WAPE={m["wape_pct"]:4.1f}% | Bias={m["bias"]:+.2f} | <=10% Kap: {m["within_10pct_cap_pct"]}%')
