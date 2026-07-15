import cors from "cors";
import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireOdooAuth } from "./middleware/require-odoo-auth.js";
import { authRouter } from "./routes/auth.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { healthRouter, publicHealthRouter } from "./routes/health.routes.js";
import { inventoryRouter } from "./routes/inventory.routes.js";
import { pickingRouter } from "./routes/picking.routes.js";
import { salesRouter } from "./routes/sales.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(__dirname, "../../../../client/dist");

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
  })
);

app.use(
  session({
    name: "ventor.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.cookieSecure,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

app.use("/api/auth", authRouter);
app.use("/api/health", publicHealthRouter);
app.use(express.static(clientDistDir));

// Non-API paths (deep links, hard refreshes) fall through to the SPA shell.
// Left unauthenticated on purpose: the client app decides login-vs-app-shell itself.
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(clientDistDir, "index.html"));
});

app.use(requireOdooAuth);

app.use("/api/health", healthRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/pickings", pickingRouter);
app.use("/api", salesRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Ventor BFF listening on http://localhost:${config.port}`);
});
