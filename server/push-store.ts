/**
 * PushSubscriptions sheet persistence (Google Sheets).
 */
import type { Env } from "./env";
import { ensureSheet } from "./sheets";
import { toText } from "./util";

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

export type PushRole = "child" | "parent";

export interface StoredSubscription {
	rowIndex: number;
	endpoint: string;
	p256dh: string;
	auth: string;
	user: string;
	role: PushRole;
	deviceLabel: string;
	createdAt: string;
	lastSentAt: string;
}

export function normalizePushRole(value: unknown): PushRole {
	return value === "parent" ? "parent" : "child";
}

export async function ensurePushSheet(env: Env, token: string): Promise<void> {
	await ensureSheet(env, token, PUSH_SHEET, PUSH_HEADERS);
}

export async function readPushRows(env: Env, token: string): Promise<StoredSubscription[]> {
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
			const createdAt = toText(row[6]).trim();
			const lastSentAt = toText(row[8]).trim();
			return {
				rowIndex: i + 2,
				endpoint,
				p256dh,
				auth,
				user,
				role,
				deviceLabel,
				createdAt,
				lastSentAt,
			};
		})
		.filter((row) => row.endpoint && row.p256dh && row.auth);
}

export async function appendPushRow(
	env: Env,
	token: string,
	existingRows: StoredSubscription[],
	row: [string, string, string, string, PushRole, string, string, string, string],
): Promise<void> {
	// Use explicit row update instead of :append so writes always land on A:I.
	// Google Sheets append can anchor to a shifted table region (e.g. G:N).
	const lastRow = existingRows.reduce((max, r) => Math.max(max, r.rowIndex), 1);
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

export async function updatePushRow(
	env: Env,
	token: string,
	existing: StoredSubscription,
	row: [string, string, string, string, PushRole, string, string],
): Promise<void> {
	const range = `${PUSH_SHEET}!A${existing.rowIndex}:I${existing.rowIndex}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	const createdAt = existing.createdAt || row[6];
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			range,
			majorDimension: "ROWS",
			values: [[row[0], row[1], row[2], row[3], row[4], row[5], createdAt, row[6], existing.lastSentAt]],
		}),
	});
}

export async function updatePushLastSentAt(
	env: Env,
	token: string,
	rowIndex: number,
	sentAt: string,
): Promise<void> {
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

export async function clearPushRow(env: Env, token: string, rowIndex: number): Promise<void> {
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
