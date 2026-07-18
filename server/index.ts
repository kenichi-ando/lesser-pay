/**
 * LesserPay API (Cloudflare Worker).
 *
 * Reads and writes a Google Spreadsheet via Sheets API v4 using a service
 * account. The same Worker also serves the SPA from `public/` via the
 * static-assets binding, so frontend and API live on a single origin.
 *
 * Single dispatch endpoint:
 *   POST /api      body={action, ...}
 *
 * Anything else falls through to the static-assets binding.
 */

import { ACTIONS, type ActionRequest } from "./actions";
import type { Env } from "./env";
import { HttpError, constantTimeEqual, isValidUser } from "./util";
import { validateActionRequest } from "../shared/contracts-runtime";
import { runDeadlineReminders } from "./reminders";

export type { Env };
const INVITE_CODE_PATTERN = /^[A-Z0-9]{6}$/;
// API_TOKEN: opaque bearer token. We only length-bound it to reject pathological
// inputs; format is otherwise unconstrained.
const API_TOKEN_MIN_LENGTH = 16;
const API_TOKEN_MAX_LENGTH = 128;
type GuardResult = { ok: true } | { ok: false; response: Response };
type DefResult = { ok: true; value: (typeof ACTIONS)[Exclude<SharedActionName, "redeemInvite">] } | { ok: false; response: Response };
type JsonParseResult = { ok: true; value: unknown } | { ok: false; response: Response };

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);

		if (req.method === "OPTIONS") {
			return handleOptions(req, url);
		}

		try {
			if (url.pathname === "/api" && req.method === "POST") {
				return await dispatch(req, env);
			}
			// Anything else is a static asset (SPA shell, JS, CSS, icons, etc.).
			return env.ASSETS.fetch(req);
		} catch (e: unknown) {
			return toErrorResponse(e);
		}
	},
	async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		try {
			await runDeadlineReminders(env);
		} catch (err) {
			console.error("scheduled reminder failed:", err);
		}
	},
} satisfies ExportedHandler<Env>;

async function dispatch(req: Request, env: Env): Promise<Response> {
	const bodyRaw = await readRequestJson(req);
	if (!bodyRaw.ok) return bodyRaw.response;
	const validated = validateActionRequest(bodyRaw.value);
	if (!validated.ok) {
		return jsonError(validated.error, 400);
	}
	const body = validated.value as ActionRequest;
	// `redeemInvite` is the only action that runs without API_TOKEN. Everything
	// else requires Authorization: Bearer <API_TOKEN>.
	if (body.action === "redeemInvite") {
		return redeemInvite(body, env);
	}
	const def = getActionDef(body);
	if (!def.ok) return def.response;
	const guard = guardAuthorizedRequest(req, env, body, def.value.requireUser);
	if (!guard.ok) return guard.response;
	const result = await def.value.handler(body, env);
	return json({ ok: true, ...(result as object) });
}

function jsonError(message: string, status: number): Response {
	return json({ ok: false, error: message }, status);
}

function toErrorResponse(error: unknown): Response {
	if (error instanceof HttpError) {
		return jsonError(error.message, error.status);
	}
	const err = error as Error;
	console.error("Unhandled error:", err.stack ?? err.message);
	return jsonError(err.message, 500);
}

function getActionDef(body: ActionRequest): DefResult {
	const action = body.action;
	if (action === "redeemInvite") {
		return { ok: false, response: jsonError("Unsupported action: redeemInvite", 400) };
	}
	const def = action ? ACTIONS[action] : undefined;
	if (!def) {
		return { ok: false, response: jsonError(`Unsupported action: ${body.action}`, 400) };
	}
	return { ok: true, value: def };
}

function guardAuthorizedRequest(
	req: Request,
	env: Env,
	body: ActionRequest,
	requireUser: boolean,
): GuardResult {
	if (!authorized(req, env)) {
		return { ok: false, response: jsonError("Unauthorized", 401) };
	}
	if (requireUser && !isValidUser(body.user)) {
		return { ok: false, response: jsonError(`Invalid user: ${body.user}`, 400) };
	}
	return { ok: true };
}

async function readRequestJson(req: Request): Promise<JsonParseResult> {
	try {
		const text = await req.text();
		return { ok: true, value: JSON.parse(text) };
	} catch {
		return { ok: false, response: jsonError("Invalid JSON body", 400) };
	}
}

function redeemInvite(body: ActionRequest, env: Env): Response {
	const code = typeof body.code === "string" ? body.code : "";
	if (!isValidInviteCode(code)) {
		return jsonError("Invalid invite code", 400);
	}
	const expected = env.INVITE_CODE ?? "";
	if (!isMatchingInviteCode(code, expected)) {
		return jsonError("Invalid invite code", 401);
	}
	const apiToken = env.API_TOKEN ?? "";
	if (!isValidApiToken(apiToken)) {
		return jsonError("Server misconfigured", 500);
	}
	return json({ ok: true, apiToken });
}

function isMatchingInviteCode(code: string, expected: string): boolean {
	if (!isValidInviteCode(expected)) return false;
	return constantTimeEqual(code, expected);
}

// Gate /api with the long-lived API_TOKEN secret. The SPA obtains it once via
// `redeemInvite` (after the user types the short INVITE_CODE) and persists it
// in localStorage. Brute-forcing the API_TOKEN directly is the only attack
// surface left for non-invite-holders, so it's sized for ~256 bits of entropy.
function authorized(req: Request, env: Env): boolean {
	const expected = env.API_TOKEN ?? "";
	if (!isValidApiToken(expected)) return false;
	const provided = extractBearerToken(req.headers.get("Authorization") ?? "");
	if (!provided || !isValidApiToken(provided)) return false;
	return constantTimeEqual(provided, expected);
}

function extractBearerToken(headerValue = ""): string {
	const header = headerValue;
	const prefix = "bearer ";
	const lower = header.toLowerCase();
	if (!lower.startsWith(prefix)) return "";
	return header.slice(prefix.length).trim();
}

function isValidInviteCode(value: string): boolean {
	return INVITE_CODE_PATTERN.test(value);
}

function isValidApiToken(value: string): boolean {
	return (
		typeof value === "string" &&
		value.length >= API_TOKEN_MIN_LENGTH &&
		value.length <= API_TOKEN_MAX_LENGTH
	);
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
		},
	});
}

function handleOptions(req: Request, url: URL): Response {
	const origin = req.headers.get("Origin");
	if (!origin || origin !== url.origin) {
		return new Response(null, { status: 403 });
	}
	return new Response(null, {
		status: 204,
		headers: {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
			"Access-Control-Max-Age": "86400",
			Vary: "Origin",
		},
	});
}
