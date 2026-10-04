/**
 * Mirror validator — the enforcement core.
 *
 * Before any mirror reflection can be shown to the user, it must pass three
 * checks against the Source Bank. This is *code*, not prompting: a
 * reflection that fails cannot be displayed. The bounded recovery path
 * (see stage1-loop) decides what conversational move to make instead; code does
 * not interpret epistemic meaning (e.g. treating "I think" as uncertainty) —
 * that judgment belongs to the model.
 *
 * The checks, coarsest to finest:
 *   1. Lexical grounding — every reflection content word must stem-match the
 *      Source Bank utterances cited by that claim. Function-word glue remains
 *      free, but there is no unsupported-word budget.
 *   2. Source-span grounding — does every claim trace to a user utterance that
 *      actually supports it? (catches new *relationships* built from real words)
 *   3. Polarity — a claim uses exactly the negation words of the phrases it
 *      cites. Negators are function words, so checks 1 and 2 alone let a mirror
 *      add a "not" and reverse the user's meaning while every content word matches.
 *
 * Checks run per-claim so the caller can show/confirm chunks independently and
 * knows exactly which span to ask about when one fails.
 */

import type { MindmapConfig } from "./config";
import {
  containsWholePhrase,
  contentTokens,
  foldWidthAndQuotes,
  isStopword,
  normalize,
  stem,
  stemSet,
  tokenize,
} from "./normalize";
import type {
  ClaimValidation,
  GroundedClaim,
  MirrorCheckResult,
  MirrorClaim,
  MirrorReflection,
  MirrorValidationResult,
  SourceSpan,
  SourceUtterance,
} from "./types";

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * English negation words. They are stopwords, so lexical grounding lets them in
 * as free glue; this list takes them back out of that exemption. It does not
 * interpret meaning — it only requires that a negation word be pointed at like
 * a content word. The apostrophe-less spellings of n't forms map to "not".
 * Chinese negation is not covered: its markers sit inside words (不是, 没有) and
 * also occur in non-negative words (非常).
 */
const NEGATION_WORDS = new Set<string>([
  "not", "no", "never", "nor", "neither", "none", "nobody", "nothing", "nowhere", "without",
]);
const NOT_SPELLINGS = new Set<string>([
  "cannot", "dont", "doesnt", "didnt", "isnt", "arent", "wasnt", "werent", "cant", "couldnt",
  "wont", "wouldnt", "shouldnt", "hasnt", "havent", "hadnt", "aint", "mustnt",
]);

/**
 * The negation words in a text, so that "isn't", "is not" and "isnt" compare
 * equal. "n't" is expanded as a literal substring before tokenizing (which
 * would otherwise split "isn't" into "isn" + "t", indistinguishable from the
 * letter T); no pattern matching or clause parsing is involved.
 */
function negationWords(text: string): Set<string> {
  const expanded = foldWidthAndQuotes(text).toLocaleLowerCase("und").split("n't").join(" not");
  const words = new Set<string>();
  for (const token of tokenize(expanded)) {
    if (NEGATION_WORDS.has(token)) words.add(token);
    else if (NOT_SPELLINGS.has(token)) words.add("not");
  }
  return words;
}

/**
 * Polarity — a claim uses exactly the negation words of the user phrases it
 * cites. Content-word matching can't see this: "Money is not the main problem"
 * uses only the content words of "Money is the main problem". Like lexical
 * grounding, this compares the claim with its cited pointers, not with the
 * surrounding sentence, so it catches an added negation and one dropped from
 * inside a cited phrase. It does not catch a negation dropped by citing the
 * words on either side of it; the user's confirmation of each chunk covers that.
 *
 * Two consequences of comparing pointers:
 * - Spelling equivalence ("isn't" = "is not") holds only in this check. Lexical
 *   grounding still requires the user's own spelling, as it does for every word,
 *   so the prompt asks the model to keep it.
 * - A pointer wider than the claim that carries a negation the claim leaves out
 *   ("Not only money matters" cited for "money matters") is rejected; the repair
 *   note asks for the narrower pointer.
 */
function checkPolarity(claim: GroundedClaim): MirrorCheckResult {
  const inClaim = negationWords(claim.text);
  const cited = negationWords([
    ...claim.sourceSpans.map((span) => span.userPhrase),
    ...(claim.relationSpan ? [claim.relationSpan.text] : []),
  ].join(" \n "));
  const ok = inClaim.size === cited.size && [...inClaim].every((word) => cited.has(word));
  return { check: "polarity", ok, score: ok ? 1 : 0, threshold: 1 };
}

/** Repair hint for a polarity failure; stage1-loop forwards it to the repair call. */
export const POLARITY_REPAIR_NOTE =
  "The claim's negation words do not match the user phrases it cites. If the user negated the idea, keep their negating word, spelled as they wrote it, in both the claim and its userPhrase; if the claim does not negate it, cite only the words the claim reproduces so the userPhrase holds no 'not', 'no', 'never', n't or 'without'.";

/** Look up the text of cited utterances; missing ids contribute nothing. */
function citedTexts(span: SourceSpan, bank: Map<string, SourceUtterance>): string[] {
  return span.utteranceIds
    .map((id) => bank.get(id)?.text)
    .filter((t): t is string => typeof t === "string");
}

/**
 * Lexical grounding — is the reflection made of the user's words?
 *
 * Every content word in the displayed claim must be present, after stemming, in
 * the utterances the claim itself cites. This deliberately does not use the
 * whole Source Bank: an unrelated earlier user word cannot launder a new word
 * into a claim. The two reported parts retain useful calibration detail while
 * both enforce the same zero-addition boundary.
 */
function checkLexicalGrounding(
  claim: GroundedClaim,
  citedStems: Set<string>,
): { result: MirrorCheckResult; ungroundedContentWords: string[] } {
  const content = contentTokens(claim.text);
  const owned = content.filter((tok) => citedStems.has(stem(tok)));
  const seenUngrounded = new Set<string>();
  const ungroundedContentWords = content.filter((token) => {
    const tokenStem = stem(token);
    if (citedStems.has(tokenStem) || seenUngrounded.has(tokenStem)) return false;
    seenUngrounded.add(tokenStem);
    return true;
  });
  const overlap = ratio(owned.length, content.length);
  const additions = ratio(content.length - owned.length, content.length);

  const noContent = content.length === 0; // nothing reflected => fail closed
  const broadOk = !noContent && overlap === 1;
  const additionsOk = !noContent && additions === 0;

  return {
    ungroundedContentWords,
    result: {
      check: "lexical_grounding",
      ok: broadOk && additionsOk,
      score: overlap,
      threshold: 1,
      parts: [
        { name: "all_content_words_cited", ok: broadOk, score: overlap, threshold: 1 },
        { name: "additions", ok: additionsOk, score: additions, threshold: 0 },
      ],
    },
  };
}

function citedPhraseStemSet(claim: GroundedClaim): Set<string> {
  return stemSet([
    ...claim.sourceSpans.map((span) => span.userPhrase),
    ...(claim.relationSpan ? [claim.relationSpan.text] : []),
  ]);
}

/**
 * Is a span's user phrase grounded within a SINGLE cited utterance (not the
 * union of several)? Relationships must have been stated in one breath, so the
 * AI can't assemble a connection by citing the two entities from separate turns.
 */
function spanGroundedInSingleUtterance(
  span: SourceSpan,
  bank: Map<string, SourceUtterance>,
): boolean {
  if (contentTokens(span.userPhrase).length === 0) return false;
  for (const id of span.utteranceIds) {
    const text = bank.get(id)?.text;
    if (!text) continue;
    if (containsWholePhrase(text, span.userPhrase)) return true;
  }
  return false;
}

/**
 * Check 2 — source-span grounding.
 * Every span must (a) cite at least one real utterance and (b) have most of the
 * user-phrase's content words actually present in those utterances. A claim with
 * no spans is ungrounded by definition.
 *
 * For hierarchy/connection claims there is an additional pointer requirement:
 * the model declares the literal connective it relied on and code verifies it
 * against one source utterance.  No relation-word bank participates in this
 * enforcement path.
 */

/**
 * The relationship the CLAIM asserts must have been stated in one breath. The
 * per-span binding above is not enough on its own — the AI can stitch two
 * fully-grounded user sentences together with an invented connective
 * ("A. leads to B.") where each sentence happens to contain *some* relational
 * word; every span passes, yet the cross-utterance relationship is the AI's
 * invention. So some single cited utterance must (a) carry EVERY relational/
 * containment term the claim text itself uses — the connective can't be pasted
 * in from elsewhere — and (b) ground most of the claim's content words, so the
 * relationship isn't re-anchored onto a token-mass-dominant sentence while a
 * short stitched-on tail rides along.
 */
function claimRelationStatedInOneUtterance(
  claim: GroundedClaim,
  bank: Map<string, SourceUtterance>,
  threshold: number,
): boolean {
  const relation = claim.relationSpan;
  if (!relation?.text.trim()) return false;
  const utterance = bank.get(relation.utteranceId)?.text;
  if (
    !utterance ||
    !containsWholePhrase(utterance, relation.text) ||
    !containsWholePhrase(claim.text, relation.text)
  ) {
    return false;
  }
  const content = contentTokens(claim.text);
  if (content.length === 0) return false;
  const uStems = stemSet([utterance]);
  const grounded = content.filter((tok) => uStems.has(stem(tok)));
  return ratio(grounded.length, content.length) >= threshold;
}
function checkSpanGrounding(
  claim: GroundedClaim,
  bank: Map<string, SourceUtterance>,
  threshold: number,
): { result: MirrorCheckResult; weakest?: SourceSpan } {
  if (claim.sourceSpans.length === 0) {
    return {
      result: { check: "span_grounding", ok: false, score: 0, threshold },
    };
  }

  let weakest: SourceSpan | undefined;
  let weakestScore = Infinity;

  for (const span of claim.sourceSpans) {
    const sources = citedTexts(span, bank);
    const phraseContent = contentTokens(span.userPhrase);
    // The model nominates a precise phrase; code verifies that phrase occurs
    // in one original utterance after neutral width/quote folding.
    const spanScore =
      phraseContent.length > 0 &&
      sources.some((source) => containsWholePhrase(source, span.userPhrase))
        ? 1
        : 0;
    if (spanScore < weakestScore) {
      weakestScore = spanScore;
      weakest = span;
    }
  }

  // Relationship binding for relational targets.
  let relationshipOk = true;
  if (claim.target === "hierarchy" || claim.target === "connection") {
    const relation = claim.relationSpan;
    relationshipOk =
      !!relation &&
      claim.sourceSpans.some(
        (span) =>
          span.utteranceIds.includes(relation.utteranceId) &&
          spanGroundedInSingleUtterance(span, bank),
      ) &&
      claimRelationStatedInOneUtterance(claim, bank, threshold);
    if (!relationshipOk) {
      // Point Clarify Mode at the relational gap.
      weakest =
        claim.sourceSpans.find((s) => s.utteranceIds.includes(relation?.utteranceId ?? "")) ??
        weakest ??
        claim.sourceSpans[0];
    }
  }

  const ok = weakestScore >= threshold && relationshipOk;
  return {
    result: { check: "span_grounding", ok, score: weakestScore, threshold },
    weakest: ok ? undefined : weakest,
  };
}

function validateClaim(
  claim: GroundedClaim,
  bank: Map<string, SourceUtterance>,
  cfg: MindmapConfig,
): ClaimValidation {
  const lexical = checkLexicalGrounding(claim, citedPhraseStemSet(claim));
  const grounding = checkSpanGrounding(claim, bank, cfg.mirror.spanGroundingMin);

  const polarity = checkPolarity(claim);

  const checks = [lexical.result, grounding.result, polarity];
  const ok = checks.every((c) => c.ok);

  // The Clarify-Mode hint comes from the weakest span when grounding failed;
  // otherwise from the first failing span we can point at.
  const weakestSpan = grounding.weakest ?? (ok ? undefined : claim.sourceSpans[0]);

  const failed = checks.filter((c) => !c.ok).map((c) => c.check);
  // The polarity note goes to the repair call verbatim, so it names the fix.
  const polarityNote = polarity.ok ? "" : ` ${POLARITY_REPAIR_NOTE}`;
  const message = ok
    ? "Reflection is grounded in the user's words."
    : `Reflection not grounded in the user's words — failed checks: ${failed.join(", ")}.${polarityNote}`;

  return { claimId: claim.id, ok, checks, weakestSpan, ungroundedContentWords: lexical.ungroundedContentWords, message };
}

/**
 * Validate a full mirror reflection. Each claim is validated independently so
 * the caller can present passing chunks and re-question on failing ones.
 *
 * `bankUtterances` is the full Source Bank: chat input, direct node edits, and
 * user declarations all count as the user's own words.
 */
export function validateMirror(
  reflection: MirrorReflection,
  bankUtterances: SourceUtterance[],
  cfg: MindmapConfig,
): MirrorValidationResult {
  return validateGroundedClaims(reflection.claims, bankUtterances, cfg);
}

/** Apply the mirror's exact word-and-pointer boundary without map semantics. */
export function validateGroundedClaims(
  groundedClaims: GroundedClaim[],
  bankUtterances: SourceUtterance[],
  cfg: MindmapConfig,
): MirrorValidationResult {
  const bank = new Map(bankUtterances.map((u) => [u.id, u]));
  const claims = groundedClaims.map((claim) => validateClaim(claim, bank, cfg));
  return { ok: claims.length > 0 && claims.every((claim) => claim.ok), claims };
}

/** Exposed for tests/debugging: normalized view of how a claim grounds out. */
export function explainClaim(
  claim: MirrorClaim,
  bankUtterances: SourceUtterance[],
): { token: string; owned: boolean; glue: boolean }[] {
  const bankStems = stemSet(bankUtterances.map((u) => u.text));
  return tokenize(claim.text).map((tok) => ({
    token: tok,
    glue: isStopword(tok),
    owned: bankStems.has(stem(tok)),
  }));
}

export { normalize };
