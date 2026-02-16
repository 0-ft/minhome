import { readFileSync, existsSync } from "fs";
import { z } from "zod";
import { timingSafeEqual } from "crypto";

const TokenEntrySchema = z.object({
  name: z.string(),
  token: z.string(),
  scopes: z.array(z.string()),
});

const TokensSchema = z.array(TokenEntrySchema);

type TokenEntry = z.infer<typeof TokenEntrySchema>;

function scopeMatchesPath(scope: string, path: string): boolean {
  if (scope.endsWith("*")) {
    return path.startsWith(scope.slice(0, -1));
  }
  return path === scope;
}

export class TokenStore {
  private entries: TokenEntry[] = [];

  constructor(private filePath: string) {
    this.reload();
  }

  /** Re-read from disk so hand-edits to tokens.json are picked up */
  private reload(): void {
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf-8");
        this.entries = TokensSchema.parse(JSON.parse(raw));
      } catch (e) {
        console.warn(`[tokens] Failed to parse ${this.filePath}:`, (e as Error).message);
        this.entries = [];
      }
    } else {
      this.entries = [];
    }
  }

  /**
   * Extract a token from Authorization: Bearer or Access-Token headers
   * and match it against stored tokens with scope checking.
   * Returns the token entry name on success, or null.
   */
  match(authHeader: string | undefined, accessToken: string | undefined, path: string): string | null {
    this.reload();

    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const value = bearer || accessToken;
    if (!value) return null;

    for (const entry of this.entries) {
      // Timing-safe comparison
      const a = Buffer.from(value);
      const b = Buffer.from(entry.token);
      if (a.length !== b.length) continue;
      if (!timingSafeEqual(a, b)) continue;

      // Token matched — check scopes
      for (const scope of entry.scopes) {
        if (scopeMatchesPath(scope, path)) return entry.name;
      }
      return null; // token matched but path not in scope
    }

    return null;
  }
}
