import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateOdoo, createOdooClientForUser, isOdooAdmin } from "../odoo/client.js";
import { config } from "../config.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${String((req.body as { login?: string })?.login ?? "")}`,
  message: { error: "rate_limited", message: "Too many login attempts, try again later" },
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { login, password } = req.body as { login?: string; password?: string };
  if (!login || !password) {
    return res.status(400).json({ error: "bad_request", message: "login and password are required" });
  }

  try {
    const uid = await authenticateOdoo(config.odoo.db, login, password);
    const client = createOdooClientForUser({ uid, password, db: config.odoo.db });
    const [isAdmin, userRows] = await Promise.all([
      isOdooAdmin(client),
      client.searchRead("res.users", [["id", "=", uid]], ["name"]),
    ]);
    const name = userRows[0]?.name ?? login;
    req.session.odoo = {
      uid,
      login,
      name,
      password,
      db: config.odoo.db,
      lastUsedAt: new Date().toISOString(),
      isAdmin,
    };
    res.json({ uid, login, name, isAdmin });
  } catch {
    res.status(401).json({ error: "invalid_credentials", message: "Invalid Odoo username or password" });
  }
});

authRouter.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("khanico.sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", (req, res) => {
  if (!req.session.odoo) {
    return res.status(401).json({ error: "unauthenticated", message: "Login required" });
  }
  const { uid, login, name, isAdmin } = req.session.odoo;
  res.json({ uid, login, name, isAdmin });
});
