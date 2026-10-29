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
export const BACKEND_URL: string = env.VITE_BACKEND_URL ?? "http://localhost:8000/api";
export const MODEL: string = env.VITE_MINDMAP_MODEL ?? "gpt-5.6-terra";
export const REASONING_EFFORT: string = env.VITE_MINDMAP_REASONING_EFFORT ?? "low";

export const callResponses: ModelCall = async (req) => {
  const res = await fetch(`${BACKEND_URL}/openai/responses`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
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
  if (!res.ok) throw new Error(`Backend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { output?: unknown[] };
  return Array.isArray(body.output) ? body.output : [];
};
