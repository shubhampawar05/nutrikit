// Request and instance decorations used across route groups.
import type { Sql } from 'postgres';
import type { KeyContext } from './domain/auth.ts';
import type { Account, Role, User } from './domain/accounts.ts';
import type { Monitor } from './plugins/monitoring.ts';

declare module 'fastify' {
  interface FastifyInstance {
    sql: Sql;
    routeTable: { method: string; url: string; hidden: boolean }[];
    monitor: Monitor;
  }
  interface FastifyRequest {
    key: KeyContext;
    /** Portal: the team in use, the signed-in user, their role in the team and the session cookie's value. */
    account: Account;
    user: User;
    role: Role;
    sessionToken: string;
    rawBody?: Buffer;
  }
  interface FastifyContextConfig {
    /** Cost key from COSTS: the route needs an API key and is metered. 'dynamic' = the handler picks. */
    cost?: string;
    /** Answer 405 (instead of 404) when the path exists with another method. */
    allow405?: boolean;
  }
}
