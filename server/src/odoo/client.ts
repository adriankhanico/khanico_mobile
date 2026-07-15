import { config } from "../config.js";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: "call";
  params: Record<string, unknown>;
  id: number;
}

let requestCounter = 0;

async function callJsonRpc(service: string, method: string, args: unknown[]): Promise<any> {
  const body: JsonRpcRequest = {
    jsonrpc: "2.0",
    method: "call",
    params: { service, method, args },
    id: ++requestCounter,
  };

  const response = await fetch(`${config.odoo.baseUrl}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Odoo JSON-RPC HTTP error: ${response.status}`);
  }

  const json = await response.json();
  if (json.error) {
    const message = json.error.data?.message ?? json.error.message ?? "Unknown Odoo error";
    const err = new Error(`Odoo JSON-RPC error: ${message}`) as Error & { odooErrorName?: string };
    err.odooErrorName = json.error.data?.name;
    throw err;
  }
  return json.result;
}

export async function authenticateOdoo(db: string, login: string, password: string): Promise<number> {
  const uid = await callJsonRpc("common", "authenticate", [db, login, password, {}]);
  if (!uid) {
    throw new Error("Invalid Odoo username or password");
  }
  return uid;
}

export interface OdooIdentity {
  uid: number;
  password: string;
  db: string;
}

export interface OdooClient {
  uid: number;
  executeKw<T = any>(
    model: string,
    method: string,
    args?: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T>;
  searchRead<T = any>(
    model: string,
    domain?: unknown[],
    fields?: string[],
    opts?: Record<string, unknown>
  ): Promise<T[]>;
  searchCount(model: string, domain?: unknown[]): Promise<number>;
}

export function createOdooClientForUser(identity: OdooIdentity): OdooClient {
  async function executeKw<T = any>(
    model: string,
    method: string,
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
  ): Promise<T> {
    return callJsonRpc("object", "execute_kw", [
      identity.db,
      identity.uid,
      identity.password,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  async function searchRead<T = any>(
    model: string,
    domain: unknown[] = [],
    fields: string[] = [],
    opts: Record<string, unknown> = {}
  ): Promise<T[]> {
    return executeKw<T[]>(model, "search_read", [domain], { fields, ...opts });
  }

  async function searchCount(model: string, domain: unknown[] = []): Promise<number> {
    return executeKw<number>(model, "search_count", [domain]);
  }

  return { uid: identity.uid, executeKw, searchRead, searchCount };
}

/** Odoo's built-in "Settings / Administrator" group (base.group_system). */
export async function isOdooAdmin(client: OdooClient): Promise<boolean> {
  const dataRows = await client.searchRead(
    "ir.model.data",
    [
      ["module", "=", "base"],
      ["name", "=", "group_system"],
    ],
    ["res_id"]
  );
  if (dataRows.length === 0) return false;
  const count = await client.searchCount("res.users", [
    ["id", "=", client.uid],
    ["groups_id", "in", [dataRows[0].res_id]],
  ]);
  return count > 0;
}
