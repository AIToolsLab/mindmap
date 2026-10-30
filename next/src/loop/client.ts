import { PLATFORM_BACKEND_URL } from "../platform/platform-session";

/**
 * One call to the Responses API through the Writing Tools proxy (spec §7). Stateless:
 * `store: false`, and reasoning comes back encrypted so it can be passed back within a
 * turn without the provider keeping anything.
 */
export interface ModelRequest {
  instructions: string;
  input: unknown[];
  tools: unknown[];
  toolChoice: "auto" | "none";
}

/** The raw `output` items of one response. */
export type ModelCall = (req: ModelRequest) => Promise<unknown[]>;

const env = import.meta.env ?? {};
/** Same rules as the current app: https and set in production, localhost in dev. */
export const BACKEND_URL: string = PLATFORM_BACKEND_URL;
export const MODEL: string = env.VITE_MINDMAP_MODEL ?? "gpt-5.6-terra";
export const REASONING_EFFORT: string = env.VITE_MINDMAP_REASONING_EFFORT ?? "low";

/** The backend marks sign-in failures (expired or revoked token, account not allowed) with this header. */
const PLATFORM_AUTH_ERROR_HEADER = "X-Writing-Tools-Error";
const PLATFORM_AUTH_ERROR_VALUE = "platform-auth";

export interface ClientOptions {
  /** Writing Tools access token from the sign-in; absent in local dev without login. */
  bearerToken?: string;
  /** 401: sign in again. 403: this account isn't allowed to use the AI. */
  onAccessError?: (status: 401 | 403) => void;
  fetchImpl?: typeof fetch;
}

export function makeCallResponses(options: ClientOptions = {}): ModelCall {
  return async (req) => {
    const doFetch = options.fetchImpl ?? fetch;
    const res = await doFetch(`${BACKEND_URL}/openai/responses`, {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        ...(options.bearerToken ? { Authorization: `Bearer ${options.bearerToken}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        reasoning: { effort: REASONING_EFFORT },
        instructions: req.instructions,
        input: req.input,
        tools: req.tools,
        tool_choice: req.toolChoice,
        parallel_tool_calls: true,
        store: false,
        include: ["reasoning.encrypted_content"],
      }),
    });
    if ((res.status === 401 || res.status === 403) && res.headers.get(PLATFORM_AUTH_ERROR_HEADER) === PLATFORM_AUTH_ERROR_VALUE) {
      options.onAccessError?.(res.status);
    }
    if (!res.ok) throw new Error(`Backend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { output?: unknown[] };
    return Array.isArray(body.output) ? body.output : [];
  };
}

/** No sign-in (local dev and tests). */
export const callResponses: ModelCall = makeCallResponses();
