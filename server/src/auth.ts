import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

const COOKIE_NAME = "minhome_session";
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";
const AUTH_SECRET =
  process.env.AUTH_SECRET || randomBytes(32).toString("hex");

/** Whether auth is enabled (password is configured) */
export const authEnabled = AUTH_PASSWORD.length > 0;

// ── Token helpers ────────────────────────────────────────

function signToken(secret: string): string {
  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL;
  const payload = String(expires);
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyToken(token: string, secret: string): boolean {
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  // Timing-safe comparison of signatures
  if (sig.length !== expected.length) return false;
  const sigMatch = timingSafeEqual(
    Buffer.from(sig, "hex"),
    Buffer.from(expected, "hex"),
  );
  if (!sigMatch) return false;

  // Check expiry
  const expires = parseInt(payload, 10);
  return expires > Math.floor(Date.now() / 1000);
}

function passwordMatches(input: string): boolean {
  // Timing-safe comparison to prevent timing attacks
  const a = Buffer.from(input);
  const b = Buffer.from(AUTH_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Middleware ────────────────────────────────────────────

export function authMiddleware() {
  return async (
    c: Parameters<Parameters<Hono["use"]>[0]>[0],
    next: () => Promise<void>,
  ) => {
    // Auth disabled — let everything through
    if (!authEnabled) return next();

    const path = c.req.path;

    // Always allow auth endpoints and static assets
    if (
      path === "/api/auth/login" ||
      path === "/api/auth/check" ||
      path === "/api/auth/logout"
    ) {
      return next();
    }

    // Only protect API routes and WebSocket
    if (!path.startsWith("/api/") && path !== "/ws") {
      return next();
    }

    // Check session cookie
    const cookieToken = getCookie(c, COOKIE_NAME);
    if (cookieToken && verifyToken(cookieToken, AUTH_SECRET)) return next();

    return c.json({ error: "Unauthorized" }, 401);
  };
}

// ── Routes ───────────────────────────────────────────────

export function authRoutes() {
  const auth = new Hono();

  auth.get("/api/auth/check", (c) => {
    if (!authEnabled) {
      return c.json({ required: false, authenticated: true });
    }
    const token = getCookie(c, COOKIE_NAME);
    const authenticated = !!token && verifyToken(token, AUTH_SECRET);
    return c.json({ required: true, authenticated });
  });

  auth.post(
    "/api/auth/login",
    zValidator("json", z.object({ password: z.string() })),
    (c) => {
      if (!authEnabled) {
        return c.json({ ok: true });
      }

      const { password } = c.req.valid("json");
      if (!passwordMatches(password)) {
        return c.json({ error: "Invalid password" }, 401);
      }

      const token = signToken(AUTH_SECRET);
      const isSecure =
        c.req.header("x-forwarded-proto") === "https" ||
        c.req.url.startsWith("https");

      setCookie(c, COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: "Lax",
        secure: isSecure,
        path: "/",
        maxAge: TOKEN_TTL,
      });

      return c.json({ ok: true });
    },
  );

  auth.post("/api/auth/logout", (c) => {
    deleteCookie(c, COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  return auth;
}
