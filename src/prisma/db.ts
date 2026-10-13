import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "./contract.d";
import contractJson from "./contract.json" with { type: "json" };

export const db = postgres<Contract>({
  contractJson,
  url: process.env["DATABASE_URL"]!,
});

export type DbClient = typeof db;

export type PublicOrm = DbClient["orm"]["public"];

/** The scoped handle a transaction callback receives. */
export type Transaction = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
