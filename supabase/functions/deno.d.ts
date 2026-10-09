/** Ambient types for Deno and npm imports; used as fallback when Deno extension is inactive */

declare namespace Deno {
  namespace env {
    function get(key: string): string | undefined;
  }
  function serve(
    handler: (req: Request) => Response | Promise<Response>,
    options?: { port?: number }
  ): void;
  function test(name: string, fn: () => void | Promise<void>): void;
}

declare module "@supabase/supabase-js" {
  type Result = { data: unknown; error: unknown };
  type QueryBuilder = PromiseLike<Result> & {
    select(cols?: string): QueryBuilder;
    insert(data: object): QueryBuilder;
    upsert(data: object, opts?: object): QueryBuilder;
    update(data: object): QueryBuilder;
    eq(col: string, val: unknown): QueryBuilder;
    not(col: string, op: string, val: unknown): QueryBuilder;
    order(col: string, opts?: object): QueryBuilder;
    limit(n: number): QueryBuilder;
    range(from: number, to: number): QueryBuilder;
    single(): Promise<Result>;
    maybeSingle(): Promise<Result>;
  };
  export interface SupabaseClient {
    from(table: string): QueryBuilder;
    rpc(fn: string, params?: object): Promise<{ data: unknown; error: unknown }>;
  }
  export function createClient(
    supabaseUrl: string,
    supabaseKey: string
  ): SupabaseClient;
}
