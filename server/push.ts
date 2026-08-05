/**
 * Web Push implementation (VAPID + RFC 8291 payload encryption).
 *
 * Architectural contract:
 * - Push fan-out is server-side only. The browser never talks to push gateways.
 * - Subscriptions are persisted in the `PushSubscriptions` sheet.
 * - Payloads are encrypted (`aes128gcm`) for compatibility with APNs/FCM endpoints.
 * - Delivery is best-effort: failures are logged and stale endpoints are pruned.
 */
import type { Env } from "./env";
import { getAccessToken } from "./api";
import { b64url, b64urlBytes, formatDateTime } from "./util";

const PUSH_SHEET = "PushSubscriptions";
const PUSH_HEADERS = [
	"endpoint",
	"p256dh",
	"auth",
	"user",
	"role",
	"deviceLabel",
	"createdAt",
	"updatedAt",
	"lastSentAt",
] as const;
const MAX_PUSH_SUBSCRIPTIONS = 50;

export interface PushSubscriptionInput {
	endpoint?: unknown;
	keys?: {
		p256dh?: unknown;
		auth?: unknown;
	};
}

interface StoredSubscription {
	rowIndex: number;
	endpoint: string;
	p256dh: string;
	auth: string;
	user: string;
	role: PushRole;
	deviceLabel: string;
}

export type PushRole = "child" | "parent";

function consumePushError(_error: unknown): void {
	if (_error === undefined) return;
}

function toText(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
	if (typeof value === "bigint" || typeof value === "symbol") return String(value);
	if (value instanceof Date) return String(value);
	try {
		const json = JSON.stringify(value);
		return json ?? "";
	} catch (err) {
		consumePushError(err);
		return "";
	}
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
		await updatePushRow(env, token, found.rowIndex, [
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
	await appendPushRow(env, token, [
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
		const vapidToken = await buildVapidJwt(env, row.endpoint);
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

// RFC 8291 (Web Push) + RFC 8188 (aes128gcm) payload encryption.
// iOS/APNs drops no-payload pushes silently, so we must encrypt and ship a body.
async function encryptPayload(
	plaintext: Uint8Array,
	uaPublicB64Url: string,
	authSecretB64Url: string,
): Promise<Uint8Array> {
	const uaPublicRaw = base64UrlToBytes(uaPublicB64Url);
	const authSecret = base64UrlToBytes(authSecretB64Url);

	const asKeyPair = (await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		["deriveBits"],
	)) as CryptoKeyPair;
	const asPublicRaw = new Uint8Array(
		(await crypto.subtle.exportKey("raw", asKeyPair.publicKey)) as ArrayBuffer,
	);

	const uaPublicKey = await crypto.subtle.importKey(
		"raw",
		uaPublicRaw,
		{ name: "ECDH", namedCurve: "P-256" },
		false,
		[],
	);
	// `public` is a reserved word in Cloudflare's workers-types, surfaced as `$public`.
	// The runtime accepts the standard `public` field per the WebCrypto spec.
	const ecdhSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: uaPublicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
			asKeyPair.privateKey,
			256,
		),
	);

	// RFC 8291 §3.4: PRK_key = HMAC(auth_secret, ecdh_secret); IKM = HKDF-Expand(PRK_key, key_info, 32)
	const prkKey = await hmacSha256(authSecret, ecdhSecret);
	const keyInfo = concatBytes(
		new TextEncoder().encode("WebPush: info\0"),
		uaPublicRaw,
		asPublicRaw,
	);
	const ikm = await hkdfExpand(prkKey, keyInfo, 32);

	const salt = crypto.getRandomValues(new Uint8Array(16));
	const prk = await hmacSha256(salt, ikm);
	const cek = await hkdfExpand(
		prk,
		new TextEncoder().encode("Content-Encoding: aes128gcm\0"),
		16,
	);
	const nonce = await hkdfExpand(
		prk,
		new TextEncoder().encode("Content-Encoding: nonce\0"),
		12,
	);

	// Single (last) record: append 0x02 delimiter, then AES-128-GCM encrypt.
	const padded = new Uint8Array(plaintext.length + 1);
	padded.set(plaintext, 0);
	padded[plaintext.length] = 0x02;

	const cekKey = await crypto.subtle.importKey(
		"raw",
		cek,
		{ name: "AES-GCM" },
		false,
		["encrypt"],
	);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, padded),
	);

	// Record header: salt(16) || rs(4 BE) || idlen(1) || keyid(asPublicRaw, 65 bytes)
	const header = new Uint8Array(16 + 4 + 1 + 65);
	header.set(salt, 0);
	new DataView(header.buffer).setUint32(16, 4096, false);
	header[20] = 65;
	header.set(asPublicRaw, 21);

	return concatBytes(header, ciphertext);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, data));
}

// Single-block HKDF-Expand. Outputs <= 32 bytes only (sufficient for CEK/nonce/IKM).
async function hkdfExpand(
	prk: Uint8Array,
	info: Uint8Array,
	length: number,
): Promise<Uint8Array> {
	const data = new Uint8Array(info.length + 1);
	data.set(info, 0);
	data[info.length] = 0x01;
	const t = await hmacSha256(prk, data);
	return t.slice(0, length);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const a of arrays) total += a.length;
	const out = new Uint8Array(total);
	let off = 0;
	for (const a of arrays) {
		out.set(a, off);
		off += a.length;
	}
	return out;
}

async function buildVapidJwt(env: Env, endpoint: string): Promise<string> {
	const privateKeyB64Url = (env.PUSH_VAPID_PRIVATE_KEY ?? "").trim();
	const publicKeyB64Url = getPushPublicKey(env);
	const privateKey = await importEcPrivateKey(privateKeyB64Url, publicKeyB64Url);
	const header = { typ: "JWT", alg: "ES256" };
	const now = Math.floor(Date.now() / 1000);
	const claim = {
		aud: new URL(endpoint).origin,
		exp: now + 60 * 60,
		sub: env.PUSH_SUBJECT || "mailto:no-reply@example.com",
	};
	const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
	const sigRaw = new Uint8Array(
		await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			privateKey,
			new TextEncoder().encode(unsigned),
		),
	);
	return `${unsigned}.${b64urlBytes(derToJose(sigRaw, 32))}`;
}

async function importEcPrivateKey(
	privateKeyB64Url: string,
	publicKeyB64Url: string,
): Promise<CryptoKey> {
	const { x, y } = splitVapidPublicKey(publicKeyB64Url);
	const jwk = {
		kty: "EC",
		crv: "P-256",
		d: privateKeyB64Url,
		x,
		y,
		ext: true,
		key_ops: ["sign"],
	};
	return crypto.subtle.importKey(
		"jwk",
		jwk,
		{
			name: "ECDSA",
			namedCurve: "P-256",
		},
		false,
		["sign"],
	);
}

function splitVapidPublicKey(publicKeyB64Url: string): { x: string; y: string } {
	const raw = base64UrlToBytes(publicKeyB64Url);
	// Uncompressed P-256 point: 0x04 || X(32) || Y(32)
	if (raw.length !== 65 || raw[0] !== 0x04) {
		throw new Error("Invalid VAPID public key format");
	}
	const x = bytesToBase64Url(raw.slice(1, 33));
	const y = bytesToBase64Url(raw.slice(33, 65));
	return { x, y };
}

function derToJose(der: Uint8Array, size: number): Uint8Array {
	// Some runtimes already return JOSE-compatible raw signatures (r||s).
	if (der.length === size * 2) return der;
	// ECDSA signature from SubtleCrypto is ASN.1 DER sequence. Web Push JWT needs
	// raw JOSE format (r||s).
	if (der.length < 8 || der[0] !== 0x30) {
		throw new Error("Unexpected DER signature");
	}
	let offset = 2;
	if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
	if (der[offset] !== 0x02) throw new Error("Invalid DER signature (r)");
	const rLen = der[offset + 1];
	const rStart = offset + 2;
	const r = der.slice(rStart, rStart + rLen);
	const sOffset = rStart + rLen;
	if (der[sOffset] !== 0x02) throw new Error("Invalid DER signature (s)");
	const sLen = der[sOffset + 1];
	const sStart = sOffset + 2;
	const s = der.slice(sStart, sStart + sLen);
	const out = new Uint8Array(size * 2);
	out.set(trimAndPad(r, size), 0);
	out.set(trimAndPad(s, size), size);
	return out;
}

function trimAndPad(input: Uint8Array, size: number): Uint8Array {
	let data = input;
	while (data.length > 0 && data[0] === 0x00) data = data.slice(1);
	if (data.length > size) return data.slice(data.length - size);
	if (data.length === size) return data;
	const out = new Uint8Array(size);
	out.set(data, size - data.length);
	return out;
}

function base64UrlToBytes(value: string): Uint8Array {
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const base64 = (value + padding).replaceAll("-", "+").replaceAll("_", "/");
	return Uint8Array.from(atob(base64), (c) => c.codePointAt(0) ?? 0);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCodePoint(b);
	return btoa(bin).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}

async function ensurePushSheet(env: Env, token: string): Promise<void> {
	const exists = await hasPushSheet(env, token);
	if (exists) {
		await writePushHeaders(env, token);
		return;
	}

	const createUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}:batchUpdate`;
	const createRes = await fetch(createUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			requests: [{ addSheet: { properties: { title: PUSH_SHEET } } }],
		}),
	});
	// Duplicate title races are acceptable.
	if (!createRes.ok && createRes.status !== 400) {
		console.warn("Push sheet creation failed:", createRes.status, await createRes.text());
	}
	await writePushHeaders(env, token);
}

async function hasPushSheet(env: Env, token: string): Promise<boolean> {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}?fields=sheets.properties.title`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return false;
	const json = (await res.json()) as {
		sheets?: { properties?: { title?: string } }[];
	};
	const titles = (json.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
	return titles.includes(PUSH_SHEET);
}

async function writePushHeaders(env: Env, token: string): Promise<void> {
	const range = `${PUSH_SHEET}!A1:I1`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ range, majorDimension: "ROWS", values: [PUSH_HEADERS] }),
	});
}

async function readPushRows(env: Env, token: string): Promise<StoredSubscription[]> {
	const range = `${PUSH_SHEET}!A2:I`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return [];
	const body = (await res.json()) as { values?: unknown[][] };
	const values = body.values ?? [];
	return values
		.map((row, i) => {
			const endpoint = toText(row[0]).trim();
			const p256dh = toText(row[1]).trim();
			const auth = toText(row[2]).trim();
			const user = toText(row[3]).trim();
			const role = normalizePushRole(row[4]);
			const deviceLabel = toText(row[5]).trim();
			return { rowIndex: i + 2, endpoint, p256dh, auth, user, role, deviceLabel };
		})
		.filter((row) => row.endpoint && row.p256dh && row.auth);
}

async function appendPushRow(
	env: Env,
	token: string,
	row: [string, string, string, string, PushRole, string, string, string, string],
): Promise<void> {
	// Use explicit row update instead of :append so writes always land on A:I.
	// Google Sheets append can anchor to a shifted table region (e.g. G:N).
	const rows = await readPushRows(env, token);
	const lastRow = rows.reduce((max, r) => Math.max(max, r.rowIndex), 1);
	const nextRow = lastRow + 1;
	const range = `${PUSH_SHEET}!A${nextRow}:I${nextRow}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ range, majorDimension: "ROWS", values: [row] }),
	});
}

async function updatePushRow(
	env: Env,
	token: string,
	rowIndex: number,
	row: [string, string, string, string, PushRole, string, string],
): Promise<void> {
	const range = `${PUSH_SHEET}!A${rowIndex}:I${rowIndex}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	const current = await readPushCreatedAt(env, token, rowIndex);
	const currentLastSentAt = await readPushLastSentAt(env, token, rowIndex);
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			range,
			majorDimension: "ROWS",
			values: [[row[0], row[1], row[2], row[3], row[4], row[5], current || row[6], row[6], currentLastSentAt]],
		}),
	});
}

async function readPushCreatedAt(env: Env, token: string, rowIndex: number): Promise<string> {
	const createdAtRange = `${PUSH_SHEET}!G${rowIndex}`;
	const createdAtUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(createdAtRange)}`;
	const createdAtRes = await fetch(createdAtUrl, { headers: { Authorization: `Bearer ${token}` } });
	if (createdAtRes.ok) {
		const body = (await createdAtRes.json()) as { values?: unknown[][] };
		const createdAt = toText(body.values?.[0]?.[0]);
		if (createdAt) return createdAt;
	}
	// Backward compatibility for rows written before deviceLabel was added.
	const legacyRange = `${PUSH_SHEET}!F${rowIndex}`;
	const legacyUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(legacyRange)}`;
	const res = await fetch(legacyUrl, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return "";
	const body = (await res.json()) as { values?: unknown[][] };
	return toText(body.values?.[0]?.[0]);
}

async function readPushLastSentAt(env: Env, token: string, rowIndex: number): Promise<string> {
	const range = `${PUSH_SHEET}!I${rowIndex}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return "";
	const body = (await res.json()) as { values?: unknown[][] };
	return toText(body.values?.[0]?.[0]);
}

async function updatePushLastSentAt(env: Env, token: string, rowIndex: number, sentAt: string): Promise<void> {
	const range = `${PUSH_SHEET}!I${rowIndex}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ range, majorDimension: "ROWS", values: [[sentAt]] }),
	});
}

async function clearPushRow(env: Env, token: string, rowIndex: number): Promise<void> {
	const range = `${PUSH_SHEET}!A${rowIndex}:I${rowIndex}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			range,
			majorDimension: "ROWS",
			values: [["", "", "", "", "", "", "", "", ""]],
		}),
	});
}

function normalizePushRole(value: unknown): PushRole {
	return value === "parent" ? "parent" : "child";
}
