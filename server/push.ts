/**
 * Web Push public API (VAPID + RFC 8291).
 *
 * Architectural contract:
 * - Push fan-out is server-side only. The browser never talks to push gateways.
 * - Subscriptions are persisted in the `PushSubscriptions` sheet.
 * - Payloads are encrypted (`aes128gcm`) for compatibility with APNs/FCM endpoints.
 * - Delivery is best-effort: failures are logged and stale endpoints are pruned.
 */
import type { Env } from "./env";
import { getAccessToken } from "./api";
import { formatDateTime, toText } from "./util";
import { buildVapidJwt, encryptPayload } from "./push-crypto";
import {
	appendPushRow,
	clearPushRow,
	ensurePushSheet,
	normalizePushRole,
	readPushRows,
	type PushRole,
	type StoredSubscription,
	updatePushLastSentAt,
	updatePushRow,
} from "./push-store";

export type { PushRole } from "./push-store";

const MAX_PUSH_SUBSCRIPTIONS = 50;

export interface PushSubscriptionInput {
	endpoint?: unknown;
	keys?: {
		p256dh?: unknown;
		auth?: unknown;
	};
}

export function getPushPublicKey(env: Env): string {
	const key = (env.PUSH_VAPID_PUBLIC_KEY ?? "").trim();
	return key;
}

export function pushEnabled(env: Env): boolean {
	return Boolean(getPushPublicKey(env) && (env.PUSH_VAPID_PRIVATE_KEY ?? "").trim());
}

export function normalizePushSubscription(input: unknown): PushSubscriptionInput {
	if (!input || typeof input !== "object") return {};
	const sub = input as Record<string, unknown>;
	const keys = sub.keys && typeof sub.keys === "object" ? (sub.keys as Record<string, unknown>) : {};
	return {
		endpoint: sub.endpoint,
		keys: {
			p256dh: keys.p256dh,
			auth: keys.auth,
		},
	};
}

export async function upsertPushSubscription(
	env: Env,
	user: string,
	subscription: PushSubscriptionInput,
	roleRaw: unknown,
	deviceLabelRaw?: unknown,
): Promise<void> {
	if (!pushEnabled(env)) return;
	const endpoint = toText(subscription.endpoint).trim();
	const p256dh = toText(subscription.keys?.p256dh).trim();
	const auth = toText(subscription.keys?.auth).trim();
	if (!endpoint || !p256dh || !auth) return;

	const token = await getAccessToken(env);
	await ensurePushSheet(env, token);
	const rows = await readPushRows(env, token);
	const now = formatDateTime(new Date());
	const role = normalizePushRole(roleRaw);
	const userForStorage = role === "parent" ? "" : user;
	const deviceLabel = typeof deviceLabelRaw === "string" ? deviceLabelRaw.trim() : "";
	const found = rows.find((r) => r.endpoint === endpoint);
	if (found) {
		const isSameAsStored =
			found.p256dh === p256dh &&
			found.auth === auth &&
			found.user === userForStorage &&
			found.role === role &&
			found.deviceLabel === deviceLabel;
		if (isSameAsStored) return;
		await updatePushRow(env, token, found, [
			endpoint,
			p256dh,
			auth,
			userForStorage,
			role,
			deviceLabel,
			now,
		]);
		return;
	}
	if (rows.length >= MAX_PUSH_SUBSCRIPTIONS) return;
	await appendPushRow(env, token, rows, [
		endpoint,
		p256dh,
		auth,
		userForStorage,
		role,
		deviceLabel,
		now,
		now,
		"",
	]);
}

export async function removePushSubscription(env: Env, endpointRaw: unknown): Promise<void> {
	if (!pushEnabled(env)) return;
	const endpoint = toText(endpointRaw).trim();
	if (!endpoint) return;
	const token = await getAccessToken(env);
	await ensurePushSheet(env, token);
	const rows = await readPushRows(env, token);
	const found = rows.find((r) => r.endpoint === endpoint);
	if (!found) return;
	await clearPushRow(env, token, found.rowIndex);
}

export async function notifyViaPush(
	env: Env,
	title: string,
	body: string,
	targetRole?: PushRole,
	targetUser?: string,
	targetEndpointRaw?: string,
): Promise<void> {
	if (!pushEnabled(env)) return;
	const token = await getAccessToken(env);
	await ensurePushSheet(env, token);
	const rows = await readPushRows(env, token);
	if (rows.length === 0) return;
	const targetEndpoint = toText(targetEndpointRaw).trim();
	const deduped = dedupeSubscriptions(rows, targetRole, targetUser, targetEndpoint);

	const pub = getPushPublicKey(env);
	const plaintext = new TextEncoder().encode(JSON.stringify({ title, body }));
	for (const row of deduped.values()) {
		await sendPushToRow(env, token, pub, plaintext, row, title, body);
	}
}

/** Best-effort notification fan-out (Web Push only). */
export const notify = notifyViaPush;

function dedupeSubscriptions(
	rows: StoredSubscription[],
	targetRole?: PushRole,
	targetUser?: string,
	targetEndpoint?: string,
): Map<string, StoredSubscription> {
	const deduped = new Map<string, StoredSubscription>();
	for (const row of rows) {
		if (targetRole && row.role !== targetRole) continue;
		if (targetUser && row.user !== targetUser) continue;
		if (targetEndpoint && row.endpoint !== targetEndpoint) continue;
		deduped.set(row.endpoint, row);
	}
	return deduped;
}

async function sendPushToRow(
	env: Env,
	token: string,
	pub: string,
	plaintext: Uint8Array,
	row: StoredSubscription,
	title: string,
	body: string,
): Promise<void> {
	try {
		const encrypted = await encryptPayload(plaintext, row.p256dh, row.auth);
		const vapidToken = await buildVapidJwt(env, row.endpoint, pub);
		const res = await sendWebPush(row.endpoint, vapidToken, pub, encrypted);
		// 404/410 means expired subscription, so prune it.
		if (res.status === 404 || res.status === 410) {
			await clearPushRow(env, token, row.rowIndex);
			return;
		}
		if (res.ok) {
			await updatePushLastSentAt(env, token, row.rowIndex, formatDateTime(new Date()));
		}
		if (!res.ok) {
			console.warn("Push send failed:", res.status, await res.text());
		}
	} catch (e) {
		console.warn(
			"Push send exception:",
			e instanceof Error ? e.message : toText(e),
			`(title=${title}, body=${body.slice(0, 60)})`,
		);
	}
}

async function sendWebPush(
	endpoint: string,
	token: string,
	pub: string,
	body: Uint8Array,
): Promise<Response> {
	return fetch(endpoint, {
		method: "POST",
		headers: {
			TTL: "120",
			Urgency: "high",
			"Content-Encoding": "aes128gcm",
			"Content-Type": "application/octet-stream",
			"Content-Length": String(body.length),
			Authorization: `vapid t=${token}, k=${pub}`,
		},
		body,
	});
}
