import { describe, expect, it, vi } from "vitest";
import { makeCallResponses } from "./client";

const req = { instructions: "i", input: [], tools: [], toolChoice: "auto" as const };
const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers }));

describe("model client with Writing Tools sign-in", () => {
  it("sends the access token and returns the output items", async () => {
    const fetchImpl = respond(200, { output: [{ type: "message" }] });
    const out = await makeCallResponses({ bearerToken: "tok", fetchImpl })(req);
    expect(out).toEqual([{ type: "message" }]);
    const init = fetchImpl.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.credentials).toBe("omit");
  });

  it("sends no Authorization header without a token (local dev)", async () => {
    const fetchImpl = respond(200, { output: [] });
    await makeCallResponses({ fetchImpl })(req);
    expect(fetchImpl.mock.calls[0]![1]!.headers).not.toHaveProperty("Authorization");
  });

  it("reports a sign-in failure only when the backend marks it as one", async () => {
    const onAccessError = vi.fn();
    const expired = respond(401, { detail: "expired" }, { "X-Writing-Tools-Error": "platform-auth" });
    await expect(makeCallResponses({ bearerToken: "t", onAccessError, fetchImpl: expired })(req)).rejects.toThrow("Backend 401");
    expect(onAccessError).toHaveBeenCalledWith(401);

    const upstream = respond(401, { detail: "OpenAI said no" }); // forwarded provider error, not ours
    await expect(makeCallResponses({ bearerToken: "t", onAccessError, fetchImpl: upstream })(req)).rejects.toThrow();
    expect(onAccessError).toHaveBeenCalledTimes(1);
  });
});
