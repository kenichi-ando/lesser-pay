/**
 * Shared Google Sheets helpers for ensuring tabs exist with headers.
 */
import type { Env } from "./env";
import { colLetter } from "./schema";

export async function ensureSheet(
	env: Env,
	token: string,
	title: string,
	headers: readonly string[],
): Promise<void> {
	if (await hasSheet(env, token, title)) return;

	const createUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}:batchUpdate`;
	const createRes = await fetch(createUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			requests: [{ addSheet: { properties: { title } } }],
		}),
	});
	// Duplicate title races are acceptable.
	if (!createRes.ok && createRes.status !== 400) {
		console.warn(`Sheet creation failed (${title}):`, createRes.status, await createRes.text());
	}
	await writeSheetHeaders(env, token, title, headers);
}

async function hasSheet(env: Env, token: string, title: string): Promise<boolean> {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}?fields=sheets.properties.title`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return false;
	const json = (await res.json()) as {
		sheets?: { properties?: { title?: string } }[];
	};
	const titles = (json.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
	return titles.includes(title);
}

async function writeSheetHeaders(
	env: Env,
	token: string,
	title: string,
	headers: readonly string[],
): Promise<void> {
	const lastCol = colLetter(headers.length);
	const range = `${title}!A1:${lastCol}1`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ range, majorDimension: "ROWS", values: [headers] }),
	});
}
