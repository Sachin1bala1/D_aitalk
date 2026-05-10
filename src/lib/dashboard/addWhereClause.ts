export function addWhereClause(sql: string, where: string): string {
  if (!where.trim()) return sql;
  const upper = sql.toUpperCase();
  const insertAt = Math.min(
    upper.includes("GROUP BY") ? upper.indexOf("GROUP BY") : Infinity,
    upper.includes("ORDER BY") ? upper.indexOf("ORDER BY") : Infinity,
    upper.includes("LIMIT") ? upper.indexOf("LIMIT") : Infinity,
    sql.length
  );
  const hasWhere = upper.includes("WHERE");
  const connector = hasWhere ? " AND " : " WHERE ";
  return sql.slice(0, insertAt) + connector + where + " " + sql.slice(insertAt);
}
