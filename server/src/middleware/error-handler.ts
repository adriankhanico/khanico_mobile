import type { NextFunction, Request, Response } from "express";

type OdooError = Error & { odooErrorName?: string };

function isAccessError(err: unknown): err is OdooError {
  if (!(err instanceof Error)) return false;
  const odooErr = err as OdooError;
  return (
    odooErr.odooErrorName === "odoo.exceptions.AccessError" ||
    /AccessError|access rights|not allowed to (access|create|write|read|unlink)/i.test(err.message)
  );
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  console.error(err);

  if (isAccessError(err)) {
    res.status(403).json({
      error: "access_denied",
      message: "Your Odoo account doesn't have permission for this action.",
    });
    return;
  }

  // ValidationError / UserError text is written by Odoo (or a module) for end users,
  // e.g. "Barcode X is already the main barcode of Y" — pass it through as a 400.
  const odooName = (err as OdooError | undefined)?.odooErrorName;
  if (err instanceof Error && (odooName === "odoo.exceptions.ValidationError" || odooName === "odoo.exceptions.UserError")) {
    res.status(400).json({
      error: "odoo_validation",
      message: err.message.replace(/^Odoo JSON-RPC error: /, ""),
    });
    return;
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({ error: "internal_error", message });
}
