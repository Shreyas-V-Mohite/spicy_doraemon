/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai_answerPrompt from "../ai/answerPrompt.js";
import type * as ai_prompts from "../ai/prompts.js";
import type * as answers from "../answers.js";
import type * as copilot from "../copilot.js";
import type * as courses from "../courses.js";
import type * as feedback from "../feedback.js";
import type * as lessons from "../lessons.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_chem from "../lib/chem.js";
import type * as lib_chunk from "../lib/chunk.js";
import type * as lib_embed from "../lib/embed.js";
import type * as lib_lesson from "../lib/lesson.js";
import type * as lib_verify from "../lib/verify.js";
import type * as lib_visual from "../lib/visual.js";
import type * as questions from "../questions.js";
import type * as retrieval from "../retrieval.js";
import type * as sessions from "../sessions.js";
import type * as visuals from "../visuals.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "ai/answerPrompt": typeof ai_answerPrompt;
  "ai/prompts": typeof ai_prompts;
  answers: typeof answers;
  copilot: typeof copilot;
  courses: typeof courses;
  feedback: typeof feedback;
  lessons: typeof lessons;
  "lib/auth": typeof lib_auth;
  "lib/chem": typeof lib_chem;
  "lib/chunk": typeof lib_chunk;
  "lib/embed": typeof lib_embed;
  "lib/lesson": typeof lib_lesson;
  "lib/verify": typeof lib_verify;
  "lib/visual": typeof lib_visual;
  questions: typeof questions;
  retrieval: typeof retrieval;
  sessions: typeof sessions;
  visuals: typeof visuals;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
