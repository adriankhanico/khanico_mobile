import type { NextFunction, Request, Response } from "express";
import type { OdooIdentity } from "../odoo/client.js";

declare global {
  namespace Express {
    interface Request {
      odoo?: OdooIdentity;
      odooIsAdmin?: boolean;
    }
  }
}

export function requireOdooAuth(req: Request, res: Response, next: NextFunction) {
  const session = req.session.odoo;
  if (!session) {
    return res.status(401).json({ error: "unauthenticated", message: "Login required" });
  }
  session.lastUsedAt = new Date().toISOString();
  req.odoo = { uid: session.uid, password: session.password, db: session.db };
  req.odooIsAdmin = session.isAdmin;
  next();
}
