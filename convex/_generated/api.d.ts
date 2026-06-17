/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentThoughts from "../agentThoughts.js";
import type * as agents from "../agents.js";
import type * as ai from "../ai.js";
import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as benchmark from "../benchmark.js";
import type * as buildLoop from "../buildLoop.js";
import type * as changeHistory from "../changeHistory.js";
import type * as chat from "../chat.js";
import type * as cinema from "../cinema.js";
import type * as collaboration from "../collaboration.js";
import type * as constants from "../constants.js";
import type * as costEntries from "../costEntries.js";
import type * as crossProject from "../crossProject.js";
import type * as dashboard from "../dashboard.js";
import type * as debate from "../debate.js";
import type * as deployVercel from "../deployVercel.js";
import type * as email from "../email.js";
import type * as engine from "../engine.js";
import type * as errorIngestion from "../errorIngestion.js";
import type * as export_ from "../export.js";
import type * as files from "../files.js";
import type * as forensic from "../forensic.js";
import type * as git from "../git.js";
import type * as github from "../github.js";
import type * as gitops from "../gitops.js";
import type * as http from "../http.js";
import type * as intelligence from "../intelligence.js";
import type * as limits from "../limits.js";
import type * as memory from "../memory.js";
import type * as missions from "../missions.js";
import type * as mutation from "../mutation.js";
import type * as previews from "../previews.js";
import type * as projects from "../projects.js";
import type * as rag from "../rag.js";
import type * as reflection from "../reflection.js";
import type * as repoImport from "../repoImport.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as sentry from "../sentry.js";
import type * as sessions from "../sessions.js";
import type * as stripe from "../stripe.js";
import type * as suggestions from "../suggestions.js";
import type * as swarm from "../swarm.js";
import type * as testAuth from "../testAuth.js";
import type * as users from "../users.js";
import type * as vision from "../vision.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentThoughts: typeof agentThoughts;
  agents: typeof agents;
  ai: typeof ai;
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  benchmark: typeof benchmark;
  buildLoop: typeof buildLoop;
  changeHistory: typeof changeHistory;
  chat: typeof chat;
  cinema: typeof cinema;
  collaboration: typeof collaboration;
  constants: typeof constants;
  costEntries: typeof costEntries;
  crossProject: typeof crossProject;
  dashboard: typeof dashboard;
  debate: typeof debate;
  deployVercel: typeof deployVercel;
  email: typeof email;
  engine: typeof engine;
  errorIngestion: typeof errorIngestion;
  export: typeof export_;
  files: typeof files;
  forensic: typeof forensic;
  git: typeof git;
  github: typeof github;
  gitops: typeof gitops;
  http: typeof http;
  intelligence: typeof intelligence;
  limits: typeof limits;
  memory: typeof memory;
  missions: typeof missions;
  mutation: typeof mutation;
  previews: typeof previews;
  projects: typeof projects;
  rag: typeof rag;
  reflection: typeof reflection;
  repoImport: typeof repoImport;
  seedTestUser: typeof seedTestUser;
  sentry: typeof sentry;
  sessions: typeof sessions;
  stripe: typeof stripe;
  suggestions: typeof suggestions;
  swarm: typeof swarm;
  testAuth: typeof testAuth;
  users: typeof users;
  vision: typeof vision;
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
