declare module 'sql.js' {
  interface QueryExecResult {
    columns: string[];
    values: (string | number | null)[][];
  }

  interface SqlJsDatabase {
    run(sql: string, params?: (string | number | null)[]): void;
    exec(sql: string, params?: (string | number | null)[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => SqlJsDatabase;
  }

  export type { SqlJsDatabase, SqlJsStatic, QueryExecResult };

  function initSqlJs(): Promise<SqlJsStatic>;
  export default initSqlJs;
}
