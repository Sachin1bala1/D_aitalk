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

};
