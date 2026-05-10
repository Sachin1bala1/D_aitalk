// src/lib/pyodide/stat_kernels.ts
// Globals injected per-call by ToolExecutor match the parameter names below.

export const STAT_KERNELS: Record<string, string> = {

  describe: `
import numpy as np
from scipy import stats as sp_stats
arr = np.array(data, dtype=float)
q1, q3 = np.percentile(arr, [25, 75])
result = {
    "n": int(len(arr)),
    "mean": round(float(arr.mean()), 6),
    "std": round(float(arr.std(ddof=1)), 6),
    "min": round(float(arr.min()), 6),
    "q1": round(float(q1), 6),
    "median": round(float(np.median(arr)), 6),
    "q3": round(float(q3), 6),
    "max": round(float(arr.max()), 6),
    "skewness": round(float(sp_stats.skew(arr)), 6),
    "kurtosis": round(float(sp_stats.kurtosis(arr)), 6),
}
result
`,

  spc_xbar_r: `
import numpy as np
arr = np.array(data, dtype=float)
n = int(subgroup_size)
if len(arr) < n:
    raise ValueError(f"Data length {len(arr)} is less than subgroup_size {n}. Need at least {n} measurements.")
A2 = {2:1.880,3:1.023,4:0.729,5:0.577,6:0.483,7:0.419,8:0.373,9:0.337,10:0.308}
D3 = {2:0,3:0,4:0,5:0,6:0,7:0.076,8:0.136,9:0.184,10:0.223}
D4 = {2:3.267,3:2.574,4:2.282,5:2.114,6:2.004,7:1.924,8:1.864,9:1.816,10:1.777}
n_groups = len(arr) // n
groups = arr[:n_groups * n].reshape(n_groups, n)
xbar = groups.mean(axis=1)
ranges = groups.max(axis=1) - groups.min(axis=1)
xbar_bar = float(xbar.mean())
r_bar = float(ranges.mean())
a2 = A2.get(n, 0.577)
d3 = D3.get(n, 0)
d4 = D4.get(n, 2.114)
result = {
    "xbar": [round(float(v), 6) for v in xbar],
    "ranges": [round(float(v), 6) for v in ranges],
    "xbar_bar": round(xbar_bar, 6),
    "r_bar": round(r_bar, 6),
    "ucl_x": round(xbar_bar + a2 * r_bar, 6),
    "lcl_x": round(xbar_bar - a2 * r_bar, 6),
    "ucl_r": round(d4 * r_bar, 6),
    "lcl_r": round(d3 * r_bar, 6),
    "n_groups": int(n_groups),
    "subgroup_size": n,
}
result
`,

  capability: `
import numpy as np
arr = np.array(data, dtype=float)
if len(arr) < 2:
    raise ValueError("capability requires at least 2 data points")
mean = float(arr.mean())
std = float(arr.std(ddof=1))
if std == 0.0:
    raise ValueError("All data values are identical — standard deviation is zero, capability indices undefined")
cp = round((usl - lsl) / (6 * std), 4)
cpu = round((usl - mean) / (3 * std), 4)
cpl = round((mean - lsl) / (3 * std), 4)
cpk = round(min(cpu, cpl), 4)
result = {
    "cp": cp, "cpk": cpk, "cpu": cpu, "cpl": cpl,
    "pp": cp, "ppk": cpk,
    "mean": round(mean, 6),
    "std": round(std, 6),
    "usl": float(usl),
    "lsl": float(lsl),
    "n": int(len(arr)),
    "sigma_level": round(cpk * 3, 4),
}
result
`,

  western_electric: `
import numpy as np
arr = np.array(data, dtype=float)
mean = float(arr.mean())
std = float(arr.std(ddof=1))
violations = []
n = len(arr)
s1, s2, s3 = mean + std, mean + 2*std, mean + 3*std
s1n, s2n, s3n = mean - std, mean - 2*std, mean - 3*std
for i in range(n):
    if arr[i] > s3 or arr[i] < s3n:
        violations.append({"rule": 1, "index": i, "value": round(float(arr[i]),6), "description": "Point beyond 3σ"})
for i in range(2, n):
    w = arr[i-2:i+1]
    if sum(1 for x in w if x > s2) >= 2:
        violations.append({"rule": 2, "index": i, "value": round(float(arr[i]),6), "description": "2 of 3 beyond 2σ above"})
    if sum(1 for x in w if x < s2n) >= 2:
        violations.append({"rule": 2, "index": i, "value": round(float(arr[i]),6), "description": "2 of 3 beyond 2σ below"})
for i in range(4, n):
    w = arr[i-4:i+1]
    if sum(1 for x in w if x > s1) >= 4:
        violations.append({"rule": 3, "index": i, "value": round(float(arr[i]),6), "description": "4 of 5 beyond 1σ above"})
    if sum(1 for x in w if x < s1n) >= 4:
        violations.append({"rule": 3, "index": i, "value": round(float(arr[i]),6), "description": "4 of 5 beyond 1σ below"})
for i in range(7, n):
    w = arr[i-7:i+1]
    if all(x > mean for x in w) or all(x < mean for x in w):
        violations.append({"rule": 4, "index": i, "value": round(float(arr[i]),6), "description": "8 consecutive same side of mean"})
result = {"violations": violations, "n_violations": len(violations), "mean": round(mean,6), "std": round(std,6), "n": n}
result
`,

  regression: `
import numpy as np
from scipy import stats as sp_stats
xarr = np.array(x, dtype=float)
yarr = np.array(y, dtype=float)
deg = int(degree) if degree else 1
if deg == 1:
    slope, intercept, r_value, p_value, std_err = sp_stats.linregress(xarr, yarr)
    y_pred = slope * xarr + intercept
    result = {
        "type": "linear",
        "slope": round(float(slope), 6),
        "intercept": round(float(intercept), 6),
        "r_squared": round(float(r_value**2), 6),
        "p_value": round(float(p_value), 6),
        "std_err": round(float(std_err), 6),
        "y_pred": [round(float(v), 6) for v in y_pred],
        "residuals": [round(float(v), 6) for v in (yarr - y_pred)],
    }
else:
    coeffs = np.polyfit(xarr, yarr, deg)
    y_pred = np.polyval(coeffs, xarr)
    ss_res = float(np.sum((yarr - y_pred)**2))
    ss_tot = float(np.sum((yarr - yarr.mean())**2))
    r_sq = 1.0 - ss_res / ss_tot if ss_tot != 0 else 0.0
    result = {
        "type": "polynomial",
        "degree": deg,
        "coefficients": [round(float(c), 6) for c in coeffs],
        "r_squared": round(r_sq, 6),
        "y_pred": [round(float(v), 6) for v in y_pred],
        "residuals": [round(float(v), 6) for v in (yarr - y_pred)],
    }
result
`,

  fft: `
import numpy as np
arr = np.array(data, dtype=float)
sr = float(sample_rate) if sample_rate else 1.0
n = len(arr)
fft_vals = np.fft.rfft(arr)
freqs = np.fft.rfftfreq(n, d=1.0/sr)
amps = np.abs(fft_vals) * 2 / n
top_idx = np.argsort(amps)[-5:][::-1]
result = {
    "frequencies": [round(float(f), 6) for f in freqs],
    "amplitudes": [round(float(a), 6) for a in amps],
    "dominant_frequencies": [
        {"frequency": round(float(freqs[i]), 4), "amplitude": round(float(amps[i]), 4)}
        for i in top_idx if float(freqs[i]) > 0
    ],
    "n": n,
    "sample_rate": sr,
}
result
`,

  anomaly_zscore: `
import numpy as np
arr = np.array(data, dtype=float)
thr = float(threshold) if threshold else 3.0
mean = float(arr.mean())
std = float(arr.std(ddof=1))
z_scores = (arr - mean) / std if std > 0 else np.zeros_like(arr)
anomalies = []
for i, (val, z) in enumerate(zip(arr, z_scores)):
    if abs(z) > thr:
        anomalies.append({"index": i, "value": round(float(val), 6), "z_score": round(float(z), 4)})
result = {
    "anomalies": anomalies,
    "n_anomalies": len(anomalies),
    "mean": round(mean, 6),
    "std": round(std, 6),
    "threshold": thr,
    "n": int(len(arr)),
}
result
`,

  pca: `
import numpy as np
from sklearn.decomposition import PCA
n_components = int(n_components) if n_components else 2
arr = np.array(data, dtype=float)
n_samples, n_features = arr.shape
n_components = min(n_components, n_samples, n_features)
pca = PCA(n_components=n_components)
scores = pca.fit_transform(arr)
result = {
    "components": [[round(float(v), 6) for v in row] for row in pca.components_],
    "explained_variance_ratio": [round(float(v), 6) for v in pca.explained_variance_ratio_],
    "cumulative_variance": [round(float(v), 6) for v in np.cumsum(pca.explained_variance_ratio_)],
    "scores": [[round(float(v), 6) for v in row] for row in scores],
    "n_components": n_components,
    "n_features": n_features,
    "n_samples": n_samples,
}
result
`,

  kmeans_cluster: `
import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
k = int(k) if k else 3
random_state = int(random_state) if random_state else 42
arr = np.array(data, dtype=float)
n_samples = arr.shape[0]
k = min(k, n_samples - 1)
km = KMeans(n_clusters=k, random_state=random_state, n_init=10)
labels = km.fit_predict(arr)
sil = float(silhouette_score(arr, labels)) if k > 1 and n_samples > k else 0.0
result = {
    "labels": [int(v) for v in labels],
    "centroids": [[round(float(v), 6) for v in row] for row in km.cluster_centers_],
    "inertia": round(float(km.inertia_), 6),
    "silhouette_score": round(sil, 6),
    "k": k,
    "n_samples": n_samples,
}
result
`,

  feature_importance: `
import numpy as np
from sklearn.ensemble import RandomForestRegressor
X_arr = np.array(X, dtype=float)
y_arr = np.array(y, dtype=float)
n_samples, n_features = X_arr.shape
n_estimators = int(n_estimators) if n_estimators else 100
random_state = int(random_state) if random_state else 42
names = list(feature_names) if feature_names else [f"feature_{i}" for i in range(n_features)]
rf = RandomForestRegressor(n_estimators=n_estimators, random_state=random_state)
rf.fit(X_arr, y_arr)
importances = sorted(
    [{"feature": names[i], "importance": round(float(rf.feature_importances_[i]), 6)} for i in range(n_features)],
    key=lambda x: x["importance"], reverse=True
)
result = {
    "importances": importances,
    "top_features": [item["feature"] for item in importances[:5]],
    "model_type": "regressor",
    "n_features": n_features,
    "n_samples": n_samples,
}
result
`,

  change_point: `
import numpy as np
threshold = float(threshold) if threshold else 3.0
arr = np.array(data, dtype=float)
mean = float(arr.mean())
std = float(arr.std(ddof=1))
cusum_pos = np.zeros(len(arr))
cusum_neg = np.zeros(len(arr))
k = threshold * std
for i in range(1, len(arr)):
    cusum_pos[i] = max(0, cusum_pos[i-1] + arr[i] - mean - k/2)
    cusum_neg[i] = max(0, cusum_neg[i-1] - arr[i] + mean - k/2)
h = threshold * std
change_points = [i for i in range(len(arr)) if cusum_pos[i] > h or cusum_neg[i] > h]
deduped = []
prev = -2
for cp in change_points:
    if cp - prev > 3:
        deduped.append(cp)
        prev = cp
result = {
    "change_points": deduped,
    "n_change_points": len(deduped),
    "cusum_pos": [round(float(v), 6) for v in cusum_pos],
    "cusum_neg": [round(float(v), 6) for v in cusum_neg],
    "threshold": round(threshold, 6),
    "mean": round(mean, 6),
    "std": round(std, 6),
}
result
`,

  arima_forecast: `
import numpy as np
from statsmodels.tsa.arima.model import ARIMA
steps = int(steps) if steps else 10
order = list(order) if order else [1, 1, 1]
arr = np.array(data, dtype=float)
try:
    model = ARIMA(arr, order=(int(order[0]), int(order[1]), int(order[2])))
    fit = model.fit()
    forecast_res = fit.get_forecast(steps=steps)
    forecast = forecast_res.predicted_mean
    conf = forecast_res.conf_int(alpha=0.05)
    result = {
        "forecast": [round(float(v), 6) for v in forecast],
        "conf_int_lower": [round(float(v), 6) for v in conf[:, 0]],
        "conf_int_upper": [round(float(v), 6) for v in conf[:, 1]],
        "aic": round(float(fit.aic), 6),
        "bic": round(float(fit.bic), 6),
        "order": [int(order[0]), int(order[1]), int(order[2])],
        "n_obs": int(len(arr)),
    }
except Exception as e:
    result = {"error": str(e), "order": order}
result
`,

  doe_design: `
import numpy as np
from itertools import product as iterproduct
design_type = str(design_type) if design_type else "full"
n_center_points = int(n_center_points) if n_center_points else 0
factor_list = list(factors)
k = len(factor_list)
names = [f["name"] for f in factor_list]
lows = [float(f["low"]) for f in factor_list]
highs = [float(f["high"]) for f in factor_list]
if design_type == "full":
    coded = np.array(list(iterproduct(*[[-1, 1]] * k)), dtype=float)
elif design_type == "fractional":
    base = np.array(list(iterproduct(*[[-1, 1]] * (k - 1))), dtype=float)
    last_col = np.prod(base, axis=1, keepdims=True)
    coded = np.hstack([base, last_col])
else:
    # CCD
    full = np.array(list(iterproduct(*[[-1, 1]] * k)), dtype=float)
    alpha = 1.414
    axial = []
    for i in range(k):
        row_pos = np.zeros(k); row_pos[i] = alpha
        row_neg = np.zeros(k); row_neg[i] = -alpha
        axial.extend([row_pos, row_neg])
    axial = np.array(axial, dtype=float)
    centers = np.zeros((n_center_points, k)) if n_center_points > 0 else np.empty((0, k))
    coded = np.vstack([full, axial, centers])
if n_center_points > 0 and design_type != "ccd":
    centers = np.zeros((n_center_points, k))
    coded = np.vstack([coded, centers])
actual = np.array([
    [(lows[j] + highs[j]) / 2 + coded[i, j] * (highs[j] - lows[j]) / 2 for j in range(k)]
    for i in range(len(coded))
])
result = {
    "design_matrix": [[round(float(v), 6) for v in row] for row in actual],
    "coded_matrix": [[round(float(v), 6) for v in row] for row in coded],
    "factor_names": names,
    "n_runs": int(len(coded)),
    "design_type": design_type,
}
result
`,

  doe_analyze: `
import numpy as np
from scipy import stats as sp_stats
dm = np.array(design_matrix, dtype=float)
resp = np.array(responses, dtype=float)
fnames = list(factor_names)
k = dm.shape[1]
n = dm.shape[0]
total_ss = float(np.sum((resp - resp.mean()) ** 2))
main_effects = []
for j in range(k):
    contrast = dm[:, j]
    effect = float(2 * np.dot(contrast, resp) / n)
    ss = float(n * effect ** 2 / 4)
    pct = round(ss / total_ss * 100, 4) if total_ss > 0 else 0.0
    main_effects.append({"factor": fnames[j], "effect": round(effect, 6), "ss": round(ss, 6), "pct_contribution": pct})
interactions = []
for i in range(k):
    for j in range(i + 1, k):
        contrast = dm[:, i] * dm[:, j]
        effect = float(2 * np.dot(contrast, resp) / n)
        ss = float(n * effect ** 2 / 4)
        pct = round(ss / total_ss * 100, 4) if total_ss > 0 else 0.0
        interactions.append({"factors": f"{fnames[i]}*{fnames[j]}", "effect": round(effect, 6), "ss": round(ss, 6), "pct_contribution": pct})
result = {
    "main_effects": main_effects,
    "interactions": interactions,
    "total_ss": round(total_ss, 6),
    "n_runs": n,
}
result
`,

  doe_suggest: `
n_factors = int(n_factors)
budget = int(budget)
goal = str(goal) if goal else "screen"
if goal == "screen":
    if n_factors <= 4:
        runs = 2 ** n_factors
        if runs <= budget:
            rec = f"Full Factorial 2^{n_factors}"
            res = "V+"
        else:
            runs = 2 ** (n_factors - 1)
            rec = f"Fractional Factorial 2^({n_factors}-1)"
            res = "IV"
        if runs > budget:
            runs = max(n_factors + 1, 12)
            rec = "Plackett-Burman"
            res = "III"
    elif n_factors <= 8:
        runs = 2 ** (n_factors - int(n_factors // 2))
        rec = f"Fractional Factorial 2^({n_factors}-{int(n_factors // 2)})"
        res = "IV"
        if runs > budget:
            runs = max(n_factors + 1, 12)
            rec = "Plackett-Burman"
            res = "III"
    else:
        runs = max(n_factors + 1, 12)
        rec = "Plackett-Burman"
        res = "III"
elif goal == "optimize":
    if n_factors <= 3:
        runs = 2 ** n_factors
        rec = f"Full Factorial 2^{n_factors}"
        res = "V+"
    else:
        runs = 2 ** n_factors + 2 * n_factors + 1
        rec = f"CCD (Central Composite Design) for {n_factors} factors"
        res = "V"
    if runs > budget:
        runs = min(runs, budget)
        rec += " (reduced)"
else:  # rsm
    if 3 <= n_factors <= 7:
        runs = int(n_factors * (n_factors - 1) * 3 / 2) + 1
        rec = f"Box-Behnken Design for {n_factors} factors"
        res = "V"
    else:
        runs = 2 ** n_factors + 2 * n_factors + 1
        rec = f"CCD (Central Composite Design) for {n_factors} factors"
        res = "V"
    if runs > budget:
        runs = min(runs, budget)
        rec += " (reduced)"
result = {
    "recommended_design": rec,
    "n_runs": runs,
    "rationale": f"For {goal} with {n_factors} factors and budget {budget}: {rec} uses {runs} runs.",
    "resolution": res,
    "can_fit_in_budget": bool(runs <= budget),
}
result
`,

  correlation_matrix: `
import numpy as np
from scipy.stats import pearsonr
arr = np.array(data, dtype=float)
n_samples, n_features = arr.shape
names = list(column_names) if column_names else [f"col_{i}" for i in range(n_features)]
corr = np.zeros((n_features, n_features))
pvals = np.zeros((n_features, n_features))
for i in range(n_features):
    for j in range(n_features):
        if i == j:
            corr[i, j] = 1.0
            pvals[i, j] = 0.0
        else:
            r, p = pearsonr(arr[:, i], arr[:, j])
            corr[i, j] = round(float(r), 6)
            pvals[i, j] = round(float(p), 6)
strong = []
for i in range(n_features):
    for j in range(i + 1, n_features):
        if abs(corr[i, j]) > 0.7:
            strong.append({"col1": names[i], "col2": names[j], "r": round(float(corr[i, j]), 6), "p": round(float(pvals[i, j]), 6)})
strong.sort(key=lambda x: abs(x["r"]), reverse=True)
result = {
    "correlation": [[round(float(v), 6) for v in row] for row in corr],
    "p_values": [[round(float(v), 6) for v in row] for row in pvals],
    "column_names": names,
    "n_samples": n_samples,
    "strong_correlations": strong,
}
result
`,

  time_series_decompose: `
import numpy as np
from statsmodels.tsa.seasonal import STL
period = int(period) if period else 12
arr = np.array(data, dtype=float)
stl = STL(arr, period=period)
res = stl.fit()
result = {
    "trend": [round(float(v), 6) for v in res.trend],
    "seasonal": [round(float(v), 6) for v in res.seasonal],
    "residual": [round(float(v), 6) for v in res.resid],
    "period": period,
    "n": int(len(arr)),
}
result
`,

  weibull_analysis: `
import numpy as np
from scipy.stats import weibull_min
confidence = float(confidence) if confidence else 0.9
arr = np.array(data, dtype=float)
c, loc, scale = weibull_min.fit(arr, floc=0)
b10 = float(weibull_min.ppf(0.10, c, loc=loc, scale=scale))
b50 = float(weibull_min.ppf(0.50, c, loc=loc, scale=scale))
mean_life = float(weibull_min.mean(c, loc=loc, scale=scale))
rel_at_mean = float(weibull_min.sf(mean_life, c, loc=loc, scale=scale))
result = {
    "shape": round(float(c), 6),
    "scale": round(float(scale), 6),
    "loc": round(float(loc), 6),
    "b10_life": round(b10, 6),
    "b50_life": round(b50, 6),
    "mean_life": round(mean_life, 6),
    "reliability_at_mean": round(rel_at_mean, 6),
    "n": int(len(arr)),
}
result
`,

  distribution_fit: `
import numpy as np
from scipy import stats as sp_stats
arr = np.array(data, dtype=float)
n = len(arr)
dists = ["norm", "lognorm", "weibull_min", "gamma", "expon"]
fits = []
for dname in dists:
    dist = getattr(sp_stats, dname)
    try:
        params = dist.fit(arr)
        log_l = float(np.sum(dist.logpdf(arr, *params)))
        if not np.isfinite(log_l):
            continue
        k_params = len(params)
        aic = round(2 * k_params - 2 * log_l, 6)
        bic = round(k_params * np.log(n) - 2 * log_l, 6)
        ks_stat, ks_p = sp_stats.kstest(arr, dname, args=params)
        fits.append({
            "distribution": dname,
            "params": [round(float(p), 6) for p in params],
            "aic": aic,
            "bic": bic,
            "ks_statistic": round(float(ks_stat), 6),
            "ks_p_value": round(float(ks_p), 6),
        })
    except Exception:
        pass
if not fits:
    raise ValueError("No distributions could be fitted to the provided data")
fits.sort(key=lambda x: x["aic"])
result = {
    "best_fit": fits[0]["distribution"],
    "fits": fits,
    "n": n,
}
result
`,

  multi_regression: `
import numpy as np
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import cross_val_score
X_arr = np.array(X, dtype=float)
y_arr = np.array(y, dtype=float)
n_samples, n_features = X_arr.shape
cv_folds = int(cv_folds) if cv_folds else 5
names = list(feature_names) if feature_names else [f"feature_{i}" for i in range(n_features)]
lr = LinearRegression()
lr.fit(X_arr, y_arr)
y_pred = lr.predict(X_arr)
ss_res = float(np.sum((y_arr - y_pred) ** 2))
ss_tot = float(np.sum((y_arr - y_arr.mean()) ** 2))
r2 = 1.0 - ss_res / ss_tot if ss_tot != 0 else 0.0
adj_r2 = 1.0 - (1 - r2) * (n_samples - 1) / (n_samples - n_features - 1) if n_samples > n_features + 1 else r2
cv_scores = cross_val_score(lr, X_arr, y_arr, cv=min(cv_folds, n_samples), scoring="r2")
vifs = []
for j in range(n_features):
    X_j = np.delete(X_arr, j, axis=1)
    lr_j = LinearRegression()
    lr_j.fit(X_j, X_arr[:, j])
    y_j_pred = lr_j.predict(X_j)
    ss_res_j = float(np.sum((X_arr[:, j] - y_j_pred) ** 2))
    ss_tot_j = float(np.sum((X_arr[:, j] - X_arr[:, j].mean()) ** 2))
    r2_j = 1.0 - ss_res_j / ss_tot_j if ss_tot_j != 0 else 0.0
    vif_j = 1.0 / (1.0 - r2_j) if r2_j < 1.0 else float("inf")
    vifs.append(vif_j)
coefficients = [{"feature": names[j], "coef": round(float(lr.coef_[j]), 6), "vif": round(float(vifs[j]), 6)} for j in range(n_features)]
high_vif = [names[j] for j in range(n_features) if vifs[j] > 10]
result = {
    "coefficients": coefficients,
    "intercept": round(float(lr.intercept_), 6),
    "r_squared": round(r2, 6),
    "adj_r_squared": round(adj_r2, 6),
    "cv_r2_mean": round(float(cv_scores.mean()), 6),
    "cv_r2_std": round(float(cv_scores.std()), 6),
    "n_samples": n_samples,
    "n_features": n_features,
    "high_vif_features": high_vif,
}
result
`,

  anomaly_isolation_forest: `
import numpy as np
from sklearn.ensemble import IsolationForest
contamination = float(contamination) if contamination else 0.05
random_state = int(random_state) if random_state else 42
arr = np.array(data, dtype=float)
if arr.ndim == 1:
    arr = arr.reshape(-1, 1)
n_samples = arr.shape[0]
iso = IsolationForest(contamination=contamination, random_state=random_state)
labels = iso.fit_predict(arr)
scores = iso.decision_function(arr)
anomaly_indices = [int(i) for i in range(n_samples) if labels[i] == -1]
anomaly_scores = [round(float(scores[i]), 6) for i in anomaly_indices]
result = {
    "anomaly_indices": anomaly_indices,
    "anomaly_scores": anomaly_scores,
    "labels": [int(v) for v in labels],
    "n_anomalies": int(np.sum(labels == -1)),
    "contamination": contamination,
    "n_samples": n_samples,
}
result
`,

  hypothesis_test_suite: `
import numpy as np
from scipy.stats import shapiro, levene, ttest_ind, mannwhitneyu
alpha = float(alpha) if alpha else 0.05
a = np.array(group_a, dtype=float)
b = np.array(group_b, dtype=float)
if len(a) + len(b) <= 2:
    raise ValueError("Each group must have at least 2 observations for hypothesis testing")
sha, shpa = shapiro(a)
shb, shpb = shapiro(b)
norm_a = bool(float(shpa) >= alpha)
norm_b = bool(float(shpb) >= alpha)
denom = len(a) + len(b) - 2
pooled_std = float(np.sqrt(((len(a)-1)*a.std(ddof=1)**2 + (len(b)-1)*b.std(ddof=1)**2) / denom)) if denom > 0 else 0.0
cohens_d = float((a.mean() - b.mean()) / pooled_std) if pooled_std > 0 else 0.0
if norm_a and norm_b:
    _, lev_p = levene(a, b)
    if float(lev_p) >= alpha:
        stat, pval = ttest_ind(a, b, equal_var=True)
        test_used = "student_t"
    else:
        stat, pval = ttest_ind(a, b, equal_var=False)
        test_used = "welch_t"
else:
    stat, pval = mannwhitneyu(a, b, alternative="two-sided")
    test_used = "mann_whitney"
result = {
    "test_used": test_used,
    "statistic": round(float(stat), 6),
    "p_value": round(float(pval), 6),
    "significant": bool(float(pval) < alpha),
    "alpha": alpha,
    "normality_a": {"statistic": round(float(sha), 6), "p": round(float(shpa), 6), "normal": norm_a},
    "normality_b": {"statistic": round(float(shb), 6), "p": round(float(shpb), 6), "normal": norm_b},
    "group_a_mean": round(float(a.mean()), 6),
    "group_b_mean": round(float(b.mean()), 6),
    "group_a_n": int(len(a)),
    "group_b_n": int(len(b)),
    "effect_size": round(cohens_d, 6),
}
result
`,

  oee_analysis: `
planned_time = float(planned_time)
actual_run_time = float(actual_run_time)
ideal_cycle_time = float(ideal_cycle_time)
total_parts = int(total_parts)
good_parts = int(good_parts)
import math
availability = actual_run_time / planned_time if planned_time > 0 else 0.0
performance = (ideal_cycle_time * total_parts) / (actual_run_time * 60) if actual_run_time > 0 else 0.0
quality = good_parts / total_parts if total_parts > 0 else 0.0
oee = availability * performance * quality
theoretical_max = math.floor(actual_run_time * 60 / ideal_cycle_time) if ideal_cycle_time > 0 else 0
if oee >= 0.85:
    oee_class = "World Class"
elif oee >= 0.70:
    oee_class = "Good"
elif oee >= 0.50:
    oee_class = "Average"
else:
    oee_class = "Poor"
result = {
    "availability": round(availability, 6),
    "performance": round(performance, 6),
    "quality": round(quality, 6),
    "oee": round(oee, 6),
    "oee_class": oee_class,
    "planned_time": planned_time,
    "actual_run_time": actual_run_time,
    "total_parts": total_parts,
    "good_parts": good_parts,
    "rejected_parts": total_parts - good_parts,
    "theoretical_max_parts": theoretical_max,
}
result
`,

  pareto_analysis: `
cats = list(categories)
vals = list(values)
total = float(sum(vals))
pairs = sorted(zip(cats, vals), key=lambda x: x[1], reverse=True)
items = []
cumulative = 0.0
vital_few_count = 0
for cat, val in pairs:
    cumulative += float(val)
    cum_pct = round(cumulative / total * 100, 6) if total > 0 else 0.0
    is_vital = cum_pct <= 80.0
    if is_vital:
        vital_few_count += 1
    items.append({"category": cat, "value": round(float(val), 6), "cumulative_pct": cum_pct, "vital_few": is_vital})
result = {
    "items": items,
    "vital_few_count": vital_few_count,
    "total": round(total, 6),
    "n": len(items),
}
result
`,

  cusum_chart: `
import numpy as np
arr = np.array(data, dtype=float)
k = float(k) if k is not None else 0.5
h = float(h) if h is not None else 4.0
target_val = float(target) if target is not None else float(arr.mean())
sigma = float(arr.std(ddof=1))
k_val = k * sigma
h_val = h * sigma
cusum_pos = np.zeros(len(arr))
cusum_neg = np.zeros(len(arr))
for i in range(1, len(arr)):
    cusum_pos[i] = max(0, cusum_pos[i-1] + arr[i] - target_val - k_val)
    cusum_neg[i] = max(0, cusum_neg[i-1] - arr[i] + target_val - k_val)
signals = []
for i in range(len(arr)):
    if cusum_pos[i] > h_val:
        signals.append({"index": i, "direction": "high", "value": round(float(arr[i]), 6)})
    elif cusum_neg[i] > h_val:
        signals.append({"index": i, "direction": "low", "value": round(float(arr[i]), 6)})
result = {
    "cusum_pos": [round(float(v), 6) for v in cusum_pos],
    "cusum_neg": [round(float(v), 6) for v in cusum_neg],
    "signals": signals,
    "target": round(target_val, 6),
    "sigma": round(sigma, 6),
    "k_val": round(k_val, 6),
    "h_val": round(h_val, 6),
    "n": int(len(arr)),
    "n_signals": len(signals),
}
result
`,

};
