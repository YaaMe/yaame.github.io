import { drizzle } from "drizzle-orm/d1";

export function database(client: D1Database) {
  return Object.assign(drizzle(client), {
    async atomic(statements: string[]): Promise<void> {
      if (statements.length > 0) await client.batch(statements.map((statement) => client.prepare(statement)));
    },
  });
}
