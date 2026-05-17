import { beforeEach, describe, expect, it, vi } from "vitest";

describe("ChartPresetStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("migrates legacy chart presets into native persistence", async () => {
    const legacyPresets = [
      {
        id: "chart-1",
        name: "Orders by Status",
        assignments: { x: "status", y: "count", color: null, size: null, facet: null },
        chartType: "bar",
        options: {
          showDataPoints: true,
          showTrendLine: false,
          logScaleX: false,
          logScaleY: false,
          xAxisMode: "fit",
          yAxisMode: "fit",
          xAxisMin: "",
          xAxisMax: "",
          yAxisMin: "",
          yAxisMax: "",
          xAxisLabel: "status",
          yAxisLabel: "count",
          refLineValue: "",
          refLineLabel: "",
          confidenceInterval: "none",
        },
        savedAt: 1,
      },
    ];
    localStorage.setItem("daitalk_saved_charts", JSON.stringify(legacyPresets));

    const { DbClient } = await import("../db/DbClient");
    vi.spyOn(DbClient, "loadAppDocument").mockResolvedValue(null);
    const saveSpy = vi.spyOn(DbClient, "saveAppDocument").mockResolvedValue();

    const chartPresetModule = await import("./ChartPresetStore");
    const presets = await chartPresetModule.ensureChartPresetsLoaded();

    expect(presets).toEqual(legacyPresets);
    expect(saveSpy).toHaveBeenCalledWith("chart_presets", JSON.stringify(legacyPresets));
    expect(localStorage.getItem("daitalk_saved_charts")).toBeNull();
  });
});
