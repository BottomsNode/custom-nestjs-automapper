/** Test-only. sql.js ships no types, and @types/sql.js is not worth a dependency. */
declare module 'sql.js' {
  const initSqlJs: (config?: Record<string, unknown>) => Promise<unknown>;
  export default initSqlJs;
}
