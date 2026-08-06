/**
 * Runtime config — parent PIN from secrets; user roster from the `Users` sheet.
 *
 * Sheet columns: A=key, B=label (row 1 = headers).
 * Users are cached briefly in the Worker isolate; `getConfig` (login switch /
 * bootstrap) passes `{ force: true }` to bypass the cache.
 */

import type { Env } from "./env";
import { getAccessToken } from "./api";
import { MSG } from "./messages";
import { ensureSheet } from "./sheets";
import { HttpError, constantTimeEqual, toText } from "./util";

export interface User {
	key: string;
	label: string;
}

export interface Config {
	parentPin: string;
	users: User[];
}

/** Sheet key used for the optional debug roster row; cron skips this user. */
export const DEBUG_USER_KEY = "Debug";

const USERS_SHEET = "Users";
const USERS_HEADERS = ["key", "label"] as const;
const USERS_CACHE_TTL_MS = 60_000;

let usersCache: { ts: number; users: User[] } | null = null;

export async function fetchConfig(
	env: Env,
	options?: { force?: boolean },
): Promise<Config> {
	const users = await loadUsers(env, options?.force === true);
	return {
		parentPin: env.PARENT_PIN ?? "",
		users,
	};
}

async function loadUsers(env: Env, force: boolean): Promise<User[]> {
	const now = Date.now();
	if (!force && usersCache && now - usersCache.ts < USERS_CACHE_TTL_MS) {
		return usersCache.users;
	}

	const token = await getAccessToken(env);
	await ensureSheet(env, token, USERS_SHEET, USERS_HEADERS);
	const users = await readUsersSheet(env, token);
	usersCache = { ts: now, users };
	return users;
}

async function readUsersSheet(env: Env, token: string): Promise<User[]> {
	const range = `${USERS_SHEET}!A2:B`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		console.warn("Users sheet read failed:", res.status, await res.text());
		return [];
	}
	const body = (await res.json()) as { values?: unknown[][] };
	const seen = new Set<string>();
	const users: User[] = [];
	for (const row of body.values ?? []) {
		const key = toText(row[0]).trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		const label = toText(row[1]).trim() || key;
		users.push({ key, label });
	}
	return users;
}

// Throws if the PIN is missing, the server is misconfigured, or the supplied
// PIN does not match. Used by every parent-only action.
export async function checkPin(env: Env, pin: unknown): Promise<void> {
	if (typeof pin !== "string" || pin.length === 0) {
		throw new HttpError(400, MSG.errPinRequired);
	}
	const cfg = await fetchConfig(env);
	if (!cfg.parentPin) {
		throw new HttpError(500, MSG.errParentPinNotSet);
	}
	if (!constantTimeEqual(pin, cfg.parentPin)) {
		throw new HttpError(401, MSG.errPinWrong);
	}
}

export function labelFor(users: User[], userKey: string): string {
	for (const u of users) if (u.key === userKey) return u.label;
	return userKey;
}
