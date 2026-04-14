declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: typeof Database;
  }
  export interface QueryExecResult {
    columns: string[];
    values: any[][];
  }
  export class Database {
    constructor(data?: ArrayLike<number>);
    run(sql: string, params?: any[]): void;
    exec(sql: string, params?: any[]): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }
  export default function initSqlJs(): Promise<SqlJsStatic>;
}
