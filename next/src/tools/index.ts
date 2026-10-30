import type { Level } from "../state/types";
import type { Tool } from "./common";
import { proposeCard } from "./proposeCard";
import { proposeLink } from "./proposeLink";
import { proposeNest } from "./proposeNest";
import { suggestIdea } from "./suggestIdea";

/** All four are offered at every level (spec §5); handlers decide what each level allows. */
export const TOOLS: Tool[] = [proposeCard, proposeLink, proposeNest, suggestIdea];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Responses API function-tool definitions for this level. */
export function toolDefinitions(level: Level): unknown[] {
  return TOOLS.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description(level),
    parameters: t.parameters,
    strict: true,
  }));
}
