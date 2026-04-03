import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { timingSafeEqual, randomBytes } from "crypto";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { TokenStore } from "./config/tokens.js";

const COOKIE_NAME = "minhome_session";
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";
const AUTH_SECRET =
  process.env.AUTH_SECRET || randomBytes(32).toString("hex");

/** Whether auth is enabled (password is configured) */
export const authEnabled = AUTH_PASSWORD.length > 0;

// ── Token helpers ────────────────────────────────────────

async function createSessionToken(): Promise<string> {
  return sign({ exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }, AUTH_SECRET, "HS256");
}

async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await verify(token, AUTH_SECRET, "HS256");
    return true;
  } catch {
    return false;
  }
}

function passwordMatches(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(AUTH_PASSWORD);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isSessionAuthenticated(cookieValue: string | undefined): Promise<boolean> {
  if (!authEnabled) return true;
  return !!cookieValue && verifySessionToken(cookieValue);
}

// ── Middleware ────────────────────────────────────────────

export function authMiddleware(tokens: TokenStore): MiddlewareHandler {
  return async (c, next) => {
    // Auth disabled — let everything through
    if (!authEnabled) return next();

    const path = c.req.path;

    // Always allow auth endpoints and static assets
    if (
      path === "/api/auth/login" ||
      path === "/api/auth/check" ||
      path === "/api/auth/logout" ||
      path === "/display/api/setup"
    ) {
      return next();
    }

    // Only protect API routes, selected WebSocket endpoints, and display endpoints
    if (
      !path.startsWith("/api/")
      && !path.startsWith("/display/")
      && path !== "/ws"
      && path !== "/ws/voice/browser"
    ) {
      return next();
    }

    // Check bearer token with scope (Authorization: Bearer or Access-Token)
    const tokenMatch = tokens.match(c.req.header("Authorization"), c.req.header("Access-Token"), path);
    if (tokenMatch) return next();

    // Check session cookie
    const cookieToken = getCookie(c, COOKIE_NAME);
    if (cookieToken && await verifySessionToken(cookieToken)) return next();

    return c.json({ error: "Unauthorized" }, 401);
  };
}

// ── Routes ───────────────────────────────────────────────

export function authRoutes() {
  const auth = new Hono();

  auth.get("/api/auth/check", async (c) => {
    if (!authEnabled) {
      return c.json({ required: false, authenticated: true });
    }
    const token = getCookie(c, COOKIE_NAME);
    const authenticated = !!token && await verifySessionToken(token);
    return c.json({ required: true, authenticated });
  });

  auth.post(
    "/api/auth/login",
    zValidator("json", z.object({ password: z.string() })),
    async (c) => {
      if (!authEnabled) {
        return c.json({ ok: true });
      }

      const { password } = c.req.valid("json");
      if (!passwordMatches(password)) {
        return c.json({ error: "Invalid password" }, 401);
      }

      const token = await createSessionToken();
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
