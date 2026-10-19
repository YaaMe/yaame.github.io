import type { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";

export function database(client: DatabaseSync) {
  return Object.assign(drizzle({ client }), {
    async atomic(statements: string[]): Promise<void> {
      const nested = client.isTransaction;
      client.exec(nested ? "SAVEPOINT interaction_batch" : "BEGIN IMMEDIATE");
      try {
        for (const statement of statements) client.exec(statement);
        client.exec(nested ? "RELEASE interaction_batch" : "COMMIT");
      } catch (error) {
        if (nested) {
          client.exec("ROLLBACK TO interaction_batch");
          client.exec("RELEASE interaction_batch");
        } else {
          client.exec("ROLLBACK");
        }
        throw error;
      }
    },
  });
}
