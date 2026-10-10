/** Wrap a D1 binding and count executed statements and the rows D1 reports reading. */
export function countQueries(db: D1Database): {
  db: D1Database;
  count: () => number;
  rowsRead: () => number;
} {
  let queries = 0;
  let rowsRead = 0;
  const record = (meta: { rows_read?: number } | undefined) => {
    queries++;
    rowsRead += meta?.rows_read ?? 0;
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, prop) {
        if (prop === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (prop === "all" || prop === "run") {
          return async () => {
            const result = await target[prop]();
            record(result.meta);
            return result;
          };
        }
        if (prop === "first") {
          // first() hides meta, so read through all() to count its rows.
          return async (column?: string) => {
            const result = await target.all<Record<string, unknown>>();
            record(result.meta);
            const row = result.results[0] ?? null;
            return column ? (row ? row[column] : null) : row;
          };
        }
        if (prop === "raw") {
          return (...args: unknown[]) => {
            queries++;
            return (target.raw as (...a: unknown[]) => unknown).apply(
              target,
              args,
            );
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const counted = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { db: counted, count: () => queries, rowsRead: () => rowsRead };
}
