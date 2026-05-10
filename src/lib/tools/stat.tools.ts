import type { UnifiedTool } from "../ai/types";

export const STAT_TOOLS: UnifiedTool[] = [
  {
    name: "stat__describe",
    description:
      "Compute descriptive statistics (n, mean, std, min, Q1, median, Q3, max, skewness, kurtosis) for a numeric array. Use this first when asked to 'analyze', 'summarize', or 'describe' a column.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "Array of numeric values extracted from a database column." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__spc_xbar_r",
    description:
      "Compute SPC X-bar/R control chart data: subgroup means, ranges, centerlines, and control limits (UCL/LCL). Use for process monitoring and control.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "Time-ordered numeric process measurements." },
        subgroup_size: { type: "number", description: "Number of measurements per subgroup (2–10). Typically 4 or 5." },
      },
      required: ["data", "subgroup_size"],
    },
  },
  {
    name: "stat__capability",
    description:
      "Compute process capability indices: Cp, Cpk, Cpu, Cpl, Pp, Ppk, and sigma level. Requires specification limits. Cpk > 1.33 indicates a capable process.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "Array of process measurements." },
        usl: { type: "number", description: "Upper specification limit." },
        lsl: { type: "number", description: "Lower specification limit." },
      },
      required: ["data", "usl", "lsl"],
    },
  },
  {
    name: "stat__western_electric",
    description:
      "Apply the four Western Electric rules to detect special-cause variation. Returns violations with index, value, rule number, and description.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "Time-ordered numeric measurements (individual values or subgroup means)." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__regression",
    description:
      "Fit a linear (degree=1) or polynomial regression model to x/y data. Returns slope, intercept (or coefficients), R², p-value, and predicted values.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "array", description: "Independent variable values." },
        y: { type: "array", description: "Dependent variable values (same length as x)." },
        degree: { type: "number", description: "Polynomial degree. 1 = linear, 2 = quadratic, etc." },
      },
      required: ["x", "y", "degree"],
    },
  },
  {
    name: "stat__fft",
    description:
      "Compute the Fast Fourier Transform of a time-series signal. Returns frequency bins, amplitudes, and the top 5 dominant frequencies. Use for vibration analysis and cyclical pattern detection.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "Time-series signal values (equally spaced)." },
        sample_rate: { type: "number", description: "Samples per second (Hz). Use 1.0 if unknown." },
      },
      required: ["data", "sample_rate"],
    },
  },
  {
    name: "stat__anomaly_zscore",
    description:
      "Detect outliers using z-score thresholding. Returns each anomaly's index, value, and z-score. Default threshold is 3.0 (3-sigma rule).",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "Numeric values to check for anomalies." },
        threshold: { type: "number", description: "Z-score threshold. Default: 3.0." },
      },
      required: ["data", "threshold"],
    },
  },
  {
    name: "stat__pca",
    description:
      "Run Principal Component Analysis (PCA) on a 2D dataset. Returns PCA components, explained variance ratios, cumulative variance, and projected scores. Use for dimensionality reduction and identifying dominant variation sources.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "2D array of shape [n_samples, n_features]." },
        n_components: { type: "number", description: "Number of principal components to compute. Default: 2." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__kmeans_cluster",
    description:
      "Cluster data points into k groups using K-Means. Returns cluster labels, centroids, inertia, and silhouette score. Use for segmentation and grouping similar observations.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "2D array of shape [n_samples, n_features]." },
        k: { type: "number", description: "Number of clusters. Default: 3." },
        random_state: { type: "number", description: "Random seed for reproducibility. Default: 42." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__feature_importance",
    description:
      "Compute feature importances using a Random Forest regressor. Returns features ranked by importance, top 5 features, and model metadata. Use to identify which inputs most influence an outcome.",
    parameters: {
      type: "object",
      properties: {
        X: { type: "array", description: "2D feature matrix [n_samples, n_features]." },
        y: { type: "array", description: "1D target array [n_samples]." },
        feature_names: { type: "array", description: "List of feature name strings. If omitted, uses feature_0, feature_1, ..." },
        n_estimators: { type: "number", description: "Number of trees. Default: 100." },
        random_state: { type: "number", description: "Random seed. Default: 42." },
      },
      required: ["X", "y"],
    },
  },
  {
    name: "stat__change_point",
    description:
      "Detect change points (mean shifts) in a time series using a CUSUM algorithm. Returns detected change point indices and cumulative sum series. Use for detecting process upsets or step changes.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "1D time-ordered numeric array." },
        threshold: { type: "number", description: "Sensitivity threshold in sigma units. Default: 3.0 (higher = fewer detections)." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__arima_forecast",
    description:
      "Fit an ARIMA model and forecast future values with 95% confidence intervals. Returns forecast, confidence bounds, AIC, and BIC. Use for short-term time-series prediction.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "1D time-ordered numeric array (historical observations)." },
        steps: { type: "number", description: "Number of future steps to forecast. Default: 10." },
        order: { type: "array", description: "[p, d, q] ARIMA order. Default: [1, 1, 1]." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__doe_design",
    description:
      "Generate a Design of Experiments (DOE) matrix: full factorial, fractional factorial, or Central Composite Design (CCD). Returns both coded (-1/+1) and actual-value matrices.",
    parameters: {
      type: "object",
      properties: {
        factors: { type: "array", description: "Array of factor objects: [{name, low, high}, ...]." },
        design_type: { type: "string", description: "Design type: 'full', 'fractional', or 'ccd'. Default: 'full'." },
        n_center_points: { type: "number", description: "Number of center point runs to add. Default: 0." },
      },
      required: ["factors", "design_type"],
    },
  },
  {
    name: "stat__doe_analyze",
    description:
      "Analyze a DOE experiment: compute main effects and two-way interactions with sum of squares and percent contribution. Use after running a designed experiment to identify significant factors.",
    parameters: {
      type: "object",
      properties: {
        design_matrix: { type: "array", description: "2D coded design matrix (-1/+1) from doe_design." },
        responses: { type: "array", description: "1D array of measured response values, one per run." },
        factor_names: { type: "array", description: "List of factor name strings." },
      },
      required: ["design_matrix", "responses", "factor_names"],
    },
  },
  {
    name: "stat__doe_suggest",
    description:
      "Recommend the best DOE design given the number of factors, run budget, and experimental goal. Returns the design name, number of runs, resolution, and rationale.",
    parameters: {
      type: "object",
      properties: {
        n_factors: { type: "number", description: "Number of controllable factors." },
        budget: { type: "number", description: "Maximum number of experimental runs available." },
        goal: { type: "string", description: "Experimental goal: 'screen' (identify significant factors), 'optimize' (find optimum), or 'rsm' (response surface modeling)." },
      },
      required: ["n_factors", "budget", "goal"],
    },
  },
  {
    name: "stat__correlation_matrix",
    description:
      "Compute the Pearson correlation matrix and p-values for a multivariate dataset. Highlights strong correlations (|r| > 0.7). Use for collinearity diagnosis and relationship discovery.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "2D array [n_samples, n_features]." },
        column_names: { type: "array", description: "Optional list of column name strings." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__time_series_decompose",
    description:
      "Decompose a time series into trend, seasonal, and residual components using STL (Seasonal-Trend decomposition using LOESS). Use to separate underlying trend from cyclical patterns.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "1D time-ordered numeric array." },
        period: { type: "number", description: "Seasonal period (e.g., 12 for monthly data, 7 for daily). Default: 12." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__weibull_analysis",
    description:
      "Fit a Weibull distribution to failure-time data. Returns shape (beta), scale (eta), B10 life, B50 life, mean life, and reliability at mean. Use for reliability engineering and lifetime prediction.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "1D array of positive failure times or lifetimes." },
        confidence: { type: "number", description: "Confidence level for intervals. Default: 0.9." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__distribution_fit",
    description:
      "Fit five common distributions (normal, lognormal, Weibull, gamma, exponential) to data and rank by AIC. Returns KS test statistics and best-fit recommendation.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "1D numeric array to fit distributions to." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__multi_regression",
    description:
      "Fit a multiple linear regression model with cross-validation, adjusted R², and Variance Inflation Factors (VIF) to detect multicollinearity. Flags high-VIF features (VIF > 10).",
    parameters: {
      type: "object",
      properties: {
        X: { type: "array", description: "2D feature matrix [n_samples, n_features]." },
        y: { type: "array", description: "1D target array [n_samples]." },
        feature_names: { type: "array", description: "Optional list of feature name strings." },
        cv_folds: { type: "number", description: "Number of cross-validation folds. Default: 5." },
      },
      required: ["X", "y"],
    },
  },
  {
    name: "stat__anomaly_isolation_forest",
    description:
      "Detect anomalies using Isolation Forest, a tree-based algorithm effective for high-dimensional data. Returns anomaly indices, decision scores, and per-sample labels. More robust than z-score for multivariate data.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "1D or 2D numeric array." },
        contamination: { type: "number", description: "Expected fraction of anomalies (0–0.5). Default: 0.05." },
        random_state: { type: "number", description: "Random seed. Default: 42." },
      },
      required: ["data"],
    },
  },
  {
    name: "stat__hypothesis_test_suite",
    description:
      "Auto-select and run the appropriate hypothesis test (Student's t, Welch's t, or Mann-Whitney U) by first checking normality (Shapiro-Wilk) and variance equality (Levene). Returns test result, effect size (Cohen's d), and decision.",
    parameters: {
      type: "object",
      properties: {
        group_a: { type: "array", description: "First group of numeric observations." },
        group_b: { type: "array", description: "Second group of numeric observations." },
        alpha: { type: "number", description: "Significance level. Default: 0.05." },
      },
      required: ["group_a", "group_b"],
    },
  },
  {
    name: "stat__oee_analysis",
    description:
      "Calculate Overall Equipment Effectiveness (OEE) from Availability, Performance, and Quality factors. Classifies result as World Class (≥85%), Good, Average, or Poor. Use for manufacturing equipment monitoring.",
    parameters: {
      type: "object",
      properties: {
        planned_time: { type: "number", description: "Total planned production time (minutes)." },
        actual_run_time: { type: "number", description: "Actual time the machine ran (minutes)." },
        ideal_cycle_time: { type: "number", description: "Ideal (fastest possible) cycle time (seconds per part)." },
        total_parts: { type: "number", description: "Total parts produced (including rejects)." },
        good_parts: { type: "number", description: "Number of good (conforming) parts produced." },
      },
      required: ["planned_time", "actual_run_time", "ideal_cycle_time", "total_parts", "good_parts"],
    },
  },
  {
    name: "stat__pareto_analysis",
    description:
      "Perform a Pareto analysis on categorical data to identify the 'vital few' causes that account for 80% of the total. Returns items sorted by value with cumulative percentages.",
    parameters: {
      type: "object",
      properties: {
        categories: { type: "array", description: "List of category/defect name strings." },
        values: { type: "array", description: "Corresponding numeric values (counts, costs, etc.)." },
      },
      required: ["categories", "values"],
    },
  },
  {
    name: "stat__cusum_chart",
    description:
      "Compute a CUSUM (Cumulative Sum) control chart with configurable allowance (k) and decision interval (h). Detects small sustained shifts more sensitively than Shewhart charts. Returns signal points with direction.",
    parameters: {
      type: "object",
      properties: {
        data: { type: "array", description: "1D time-ordered numeric measurements." },
        target: { type: "number", description: "Target (reference) value. Defaults to data mean if omitted." },
        k: { type: "number", description: "Allowance parameter in sigma units (slack). Default: 0.5." },
        h: { type: "number", description: "Decision interval in sigma units (alarm threshold). Default: 4.0." },
      },
      required: ["data"],
    },
  },
];

/** Map from tool name to the STAT_KERNELS key (replaces __ with _). */
export function statToolToKernelKey(toolName: string): string {
  return toolName.replace("stat__", "");
}
