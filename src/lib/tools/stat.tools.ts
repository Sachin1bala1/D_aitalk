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
];

/** Map from tool name to the STAT_KERNELS key (replaces __ with _). */
export function statToolToKernelKey(toolName: string): string {
  return toolName.replace("stat__", "");
}
