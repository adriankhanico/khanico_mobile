import "express-session";

declare module "express-session" {
  interface SessionData {
    odoo?: {
      uid: number;
      login: string;
      name: string;
      password: string;
      db: string;
      lastUsedAt: string;
      isAdmin: boolean;
    };
  }
}
