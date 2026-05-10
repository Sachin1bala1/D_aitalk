export class BinQueryBuilder {
  /**
   * Builds a SQL query that bins scatter plot data into a grid using WIDTH_BUCKET.
   * Returns columns: x_bin, y_bin, point_count, x (mean), y (mean),
   * x_min_bin, x_max_bin, and optionally color_val.
   */
  static scatter(
    table: string,
    schema: string,
    xCol: string,
    yCol: string,
    colorCol: string | undefined,
    bins: number,
    whereClause?: string
  ): string {
    const fqTable = `${schema}.${table}`;
    const where = whereClause ? `WHERE ${whereClause}` : "";
    const colorSelect = colorCol ? `, MODE() WITHIN GROUP (ORDER BY ${colorCol}) AS color_val` : "";

    return `
WITH bounds AS (
  SELECT
    MIN(${xCol}::numeric) AS x_min,
    MAX(${xCol}::numeric) AS x_max,
    MIN(${yCol}::numeric) AS y_min,
    MAX(${yCol}::numeric) AS y_max
  FROM ${fqTable}
  ${where}
),
binned AS (
  SELECT
    WIDTH_BUCKET(${xCol}::numeric, b.x_min, b.x_max + 1e-10, ${bins}) AS x_bin,
    WIDTH_BUCKET(${yCol}::numeric, b.y_min, b.y_max + 1e-10, ${bins}) AS y_bin,
    AVG(${xCol}::numeric) AS x,
    AVG(${yCol}::numeric) AS y,
    MIN(${xCol}::numeric) AS x_min_bin,
    MAX(${xCol}::numeric) AS x_max_bin,
    COUNT(*) AS point_count
    ${colorCol ? `, MODE() WITHIN GROUP (ORDER BY ${colorCol}) AS color_val` : ""}${colorSelect.startsWith(",") ? "" : ""}
  FROM ${fqTable}, bounds b
  ${where}
  GROUP BY x_bin, y_bin
)
SELECT
  x_bin,
  y_bin,
  point_count,
  x,
  y,
  x_min_bin,
  x_max_bin
  ${colorCol ? ", color_val" : ""}
FROM binned
ORDER BY point_count DESC
`.trim();
  }

  /**
   * Builds a SQL query for line chart data with time-bucketing or numeric binning.
   * Returns columns: x (timestamp or numeric), y (mean), y_min, y_max, point_count.
   */
  static line(
    table: string,
    schema: string,
    xCol: string,
    yCol: string,
    xColType: string,
    buckets: number,
    whereClause?: string
  ): string {
    const fqTable = `${schema}.${table}`;
    const where = whereClause ? `WHERE ${whereClause}` : "";
    const isTime = /timestamp|date/i.test(xColType);

    if (isTime) {
      return `
WITH bounds AS (
  SELECT
    EXTRACT(EPOCH FROM MIN(${xCol})) AS ts_min,
    EXTRACT(EPOCH FROM MAX(${xCol})) AS ts_max
  FROM ${fqTable}
  ${where}
),
binned AS (
  SELECT
    WIDTH_BUCKET(
      EXTRACT(EPOCH FROM ${xCol}),
      b.ts_min,
      b.ts_max + 1e-10,
      ${buckets}
    ) AS time_bin,
    AVG(${yCol}::numeric) AS y,
    MIN(${yCol}::numeric) AS y_min,
    MAX(${yCol}::numeric) AS y_max,
    COUNT(*) AS point_count,
    b.ts_min,
    b.ts_max
  FROM ${fqTable}, bounds b
  ${where}
  GROUP BY time_bin, b.ts_min, b.ts_max
)
SELECT
  TO_TIMESTAMP(
    ts_min + (time_bin - 1) * (ts_max - ts_min) / ${buckets}
  ) AS x,
  y,
  y_min,
  y_max,
  point_count
FROM binned
ORDER BY x
`.trim();
    }

    return `
WITH bounds AS (
  SELECT
    MIN(${xCol}::numeric) AS x_min,
    MAX(${xCol}::numeric) AS x_max
  FROM ${fqTable}
  ${where}
),
binned AS (
  SELECT
    WIDTH_BUCKET(${xCol}::numeric, b.x_min, b.x_max + 1e-10, ${buckets}) AS x_bin,
    AVG(${xCol}::numeric) AS x,
    AVG(${yCol}::numeric) AS y,
    MIN(${yCol}::numeric) AS y_min,
    MAX(${yCol}::numeric) AS y_max,
    COUNT(*) AS point_count
  FROM ${fqTable}, bounds b
  ${where}
  GROUP BY x_bin
)
SELECT
  x,
  y,
  y_min,
  y_max,
  point_count
FROM binned
ORDER BY x
`.trim();
  }

  /**
   * Builds a SQL query for box plot data using PERCENTILE_CONT.
   * Returns columns: x (category), q1, median, q3, whisker_low, whisker_high,
   * mean, n, val_min, val_max.
   * Selects top N categories by count.
   */
  static boxPlot(
    table: string,
    schema: string,
    xCol: string,
    yCol: string,
    maxCategories: number,
    whereClause?: string
  ): string {
    const fqTable = `${schema}.${table}`;
    const where = whereClause ? `WHERE ${whereClause}` : "";

    return `
WITH top_categories AS (
  SELECT ${xCol} AS cat
  FROM ${fqTable}
  ${where}
  GROUP BY ${xCol}
  ORDER BY COUNT(*) DESC
  LIMIT ${maxCategories}
),
stats AS (
  SELECT
    t.${xCol} AS x,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY t.${yCol}::numeric) AS q1,
    PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY t.${yCol}::numeric) AS median,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY t.${yCol}::numeric) AS q3,
    AVG(t.${yCol}::numeric) AS mean,
    COUNT(*) AS n,
    MIN(t.${yCol}::numeric) AS val_min,
    MAX(t.${yCol}::numeric) AS val_max
  FROM ${fqTable} t
  INNER JOIN top_categories tc ON t.${xCol} = tc.cat
  ${where}
  GROUP BY t.${xCol}
)
SELECT
  x,
  q1,
  median,
  q3,
  q1 - 1.5 * (q3 - q1) AS whisker_low,
  q3 + 1.5 * (q3 - q1) AS whisker_high,
  mean,
  n,
  val_min,
  val_max
FROM stats
ORDER BY n DESC
`.trim();
  }

  /**
   * Builds a SQL query for histogram data using WIDTH_BUCKET.
   * Returns columns: bin_start, bin_end, frequency, mean, stddev.
   */
  static histogram(
    table: string,
    schema: string,
    xCol: string,
    bins: number,
    whereClause?: string
  ): string {
    const fqTable = `${schema}.${table}`;
    const where = whereClause ? `WHERE ${whereClause}` : "";

    return `
WITH bounds AS (
  SELECT
    MIN(${xCol}::numeric) AS x_min,
    MAX(${xCol}::numeric) AS x_max
  FROM ${fqTable}
  ${where}
),
binned AS (
  SELECT
    WIDTH_BUCKET(${xCol}::numeric, b.x_min, b.x_max + 1e-10, ${bins}) AS bin_num,
    COUNT(*) AS frequency,
    AVG(${xCol}::numeric) AS mean,
    STDDEV(${xCol}::numeric) AS stddev,
    b.x_min,
    b.x_max
  FROM ${fqTable}, bounds b
  ${where}
  GROUP BY bin_num, b.x_min, b.x_max
)
SELECT
  x_min + (bin_num - 1) * (x_max - x_min) / ${bins} AS bin_start,
  x_min + bin_num * (x_max - x_min) / ${bins} AS bin_end,
  frequency,
  mean,
  stddev
FROM binned
ORDER BY bin_start
`.trim();
  }
}
