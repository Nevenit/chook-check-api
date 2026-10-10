/** Wrap a D1 binding and count executed statements. */
export function countQueries(db: D1Database): {
  db: D1Database;
  count: () => number;
} {
  let queries = 0;
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, prop) {
        if (prop === "bind")
          return (...values: unknown[]) => wrap(target.bind(...values));
        if (
          prop === "all" ||
          prop === "run" ||
          prop === "first" ||
          prop === "raw"
        ) {
          return (...args: unknown[]) => {
            queries++;
            return (target[prop] as (...a: unknown[]) => unknown).apply(
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
  return { db: counted, count: () => queries };
}
