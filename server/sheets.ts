/**
 * Shared Google Sheets helpers for ensuring tabs exist with headers,
 * and for keeping numeric columns from inheriting date format.
 */
import type { Env } from "./env";
import { colLetter } from "./schema";

const sheetIdCache = new Map<string, number>();
const numberFormatReady = new Set<string>();

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
	return (await getSheetId(env, token, title)) != null;
}

async function getSheetId(env: Env, token: string, title: string): Promise<number | null> {
	const cached = sheetIdCache.get(title);
	if (cached != null) return cached;

	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}?fields=sheets.properties(sheetId,title)`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return null;
	const json = (await res.json()) as {
		sheets?: { properties?: { sheetId?: number; title?: string } }[];
	};
	for (const sheet of json.sheets ?? []) {
		const sheetTitle = sheet.properties?.title;
		const sheetId = sheet.properties?.sheetId;
		if (sheetTitle && sheetId != null) sheetIdCache.set(sheetTitle, sheetId);
	}
	return sheetIdCache.get(title) ?? null;
}

// Force NUMBER format on [startCol, endCol) (0-based, header row skipped).
// Adjacent expiry/datetime columns are date-formatted; new rows inherit that
// unless we pin reward columns to numbers. Otherwise 2000 displays as 1905/06/22.
export async function ensureColumnNumberFormat(
	env: Env,
	token: string,
	title: string,
	startColumnIndex: number,
	endColumnIndex: number,
): Promise<void> {
	const cacheKey = `${title}:${startColumnIndex}:${endColumnIndex}`;
	if (numberFormatReady.has(cacheKey)) return;

	const sheetId = await getSheetId(env, token, title);
	if (sheetId == null) return;

	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}:batchUpdate`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			requests: [
				{
					repeatCell: {
						range: {
							sheetId,
							startRowIndex: 1,
							startColumnIndex,
							endColumnIndex,
						},
						cell: {
							userEnteredFormat: {
								numberFormat: { type: "NUMBER", pattern: "0" },
							},
						},
						fields: "userEnteredFormat.numberFormat",
					},
				},
			],
		}),
	});
	if (!res.ok) {
		console.warn(
			`Number format failed (${title}):`,
			res.status,
			await res.text(),
		);
		return;
	}
	numberFormatReady.add(cacheKey);
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
