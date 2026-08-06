/**
 * Sheets API v4 wrapper + Google OAuth (service account JWT → access token).
 *
 * Pure I/O — no business rules. Higher layers (config, actions) compose these.
 */

import type { Env } from "./env";
import {
	HISTORY_COL,
	HISTORY_LAST_COL_LETTER,
	STATUS,
	TASK_COL,
	TASK_LAST_COL_LETTER,
	colLetter,
	normalizeStatus,
} from "./schema";
import { MSG, fmt } from "./messages";
import {
	HttpError,
	b64url,
	b64urlBytes,
	formatDateTime,
	generateTaskId,
	nonEmpty,
	toDateString,
	toDateTimeString,
	rewardWithLatePenalty,
	toNumber,
	toText,
} from "./util";

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// ---------------------------------------------------------------------------
// OAuth — Service Account JWT → access_token
// ---------------------------------------------------------------------------

export async function getAccessToken(env: Env): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const header = { alg: "RS256", typ: "JWT" };
	const claim = {
		iss: env.GOOGLE_CLIENT_EMAIL,
		scope: SCOPE,
		aud: "https://oauth2.googleapis.com/token",
		exp: now + 3600,
		iat: now,
	};
	const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
	const key = await importPrivateKey(env.GOOGLE_PRIVATE_KEY);
	const sigBuf = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key,
		new TextEncoder().encode(unsigned),
	);
	const sig = b64urlBytes(new Uint8Array(sigBuf));
	const jwt = `${unsigned}.${sig}`;

	const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
			assertion: jwt,
		}),
	});
	if (!tokenRes.ok) {
		throw new HttpError(
			502,
			`Google token fetch failed: ${tokenRes.status} ${await tokenRes.text()}`,
		);
	}
	const { access_token } = (await tokenRes.json()) as { access_token: string };
	return access_token;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const normalized = pem.replaceAll(String.raw`\n`, "\n");
	const b64 = normalized
		.replace("-----BEGIN PRIVATE KEY-----", "")
		.replace("-----END PRIVATE KEY-----", "")
		.replace(/\s+/g, "");
	const der = Uint8Array.from(atob(b64), (c) => c.codePointAt(0) ?? 0);
	return crypto.subtle.importKey(
		"pkcs8",
		der.buffer as ArrayBuffer,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["sign"],
	);
}

// ---------------------------------------------------------------------------
// Sheets API helpers
// ---------------------------------------------------------------------------

interface ValueUpdate {
	range: string;
	value: string;
}

type WritableValue = string | number;

// Read both task + history sheets in one round trip. Auto-fills missing
// ID / STATUS in the task rows (writing back to the sheet) and returns the
// shaped JSON the frontend expects.
export async function readUserData(
	env: Env,
	tasksSheet: string,
	historySheet: string,
): Promise<{
	tasks: ReturnType<typeof shapeTasks>;
	history: ReturnType<typeof shapeHistory>;
}> {
	const token = await getAccessToken(env);

	const tasksRange = `${tasksSheet}!A2:${TASK_LAST_COL_LETTER}`;
	const historyRange = `${historySheet}!A2:${HISTORY_LAST_COL_LETTER}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values:batchGet?ranges=${encodeURIComponent(tasksRange)}&ranges=${encodeURIComponent(historyRange)}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		throw new HttpError(
			404,
			`Sheets not found: ${tasksSheet} / ${historySheet} (${res.status})`,
		);
	}
	const { valueRanges } = (await res.json()) as {
		valueRanges: { range: string; values?: unknown[][] }[];
	};
	const taskRows = (valueRanges[0]?.values ?? []) as unknown[][];
	const historyRows = (valueRanges[1]?.values ?? []) as unknown[][];

	const updates = collectAutoFillUpdates(taskRows, tasksSheet);
	if (updates.length > 0) {
		await batchUpdateValues(env, token, updates);
	}

	return {
		tasks: shapeTasks(taskRows),
		history: shapeHistory(historyRows),
	};
}

// Row has TITLE but no ID → assign a fresh id; no STATUS → set to PENDING.
function collectAutoFillUpdates(rows: unknown[][], tasksSheet: string): ValueUpdate[] {
	const updates: ValueUpdate[] = [];
	for (let i = 0; i < rows.length; i++) {
		const r = rows[i];
		if (!r) continue;
		const hasTitle = nonEmpty(r[TASK_COL.TITLE]);
		const hasId = nonEmpty(r[TASK_COL.ID]);
		const hasStatus = nonEmpty(r[TASK_COL.STATUS]);
		const hasUpdatedAt = nonEmpty(r[TASK_COL.UPDATED_AT]);
		if (!hasTitle) continue;

		const sheetRow = i + 2; // rows start at A2
		const now = formatDateTime(new Date());

		if (!hasId) {
			const id = generateTaskId();
			r[TASK_COL.ID] = id;
			updates.push({
				range: `${tasksSheet}!${colLetter(TASK_COL.ID + 1)}${sheetRow}`,
				value: id,
			});
		}
		if (!hasStatus) {
			r[TASK_COL.STATUS] = STATUS.PENDING;
			updates.push({
				range: `${tasksSheet}!${colLetter(TASK_COL.STATUS + 1)}${sheetRow}`,
				value: STATUS.PENDING,
			});
		}
		if (!hasUpdatedAt) {
			r[TASK_COL.UPDATED_AT] = now;
			updates.push({
				range: `${tasksSheet}!${colLetter(TASK_COL.UPDATED_AT + 1)}${sheetRow}`,
				value: now,
			});
		}
	}
	return updates;
}

async function batchUpdateValues(env: Env, token: string, updates: ValueUpdate[]) {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values:batchUpdate`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			valueInputOption: "USER_ENTERED",
			data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
		}),
	});
	if (!res.ok) {
		throw new HttpError(502, `batchUpdate failed: ${res.status} ${await res.text()}`);
	}
}

export async function findTaskRow(
	env: Env,
	token: string,
	tasksSheet: string,
	taskId: string,
): Promise<{ row: unknown[]; rowIndex: number }> {
	const range = `${tasksSheet}!A2:${TASK_LAST_COL_LETTER}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		throw new HttpError(404, MSG.errTaskNotFound);
	}
	const { values = [] } = (await res.json()) as { values?: unknown[][] };
	if (values.length === 0) throw new HttpError(404, MSG.errTaskNotFound);

	for (let i = 0; i < values.length; i++) {
		const r = values[i];
		if (toText(r[TASK_COL.ID]) === toText(taskId)) {
			return { row: r, rowIndex: i + 2 };
		}
	}
	throw new HttpError(404, MSG.errTaskRowNotFound);
}

// Compare-and-swap on a task row's STATUS. Re-reads the cell right before
// writing and aborts if it changed since `findTaskRow` saw it — the optimistic
// locking primitive used by every state-changing handler.
export async function casTaskStatus(
	env: Env,
	token: string,
	tasksSheet: string,
	rowIndex: number,
	expected: string,
	next: string,
): Promise<void> {
	const cell = `${tasksSheet}!${colLetter(TASK_COL.STATUS + 1)}${rowIndex}`;
	const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(cell)}?valueRenderOption=UNFORMATTED_VALUE`;
	const readRes = await fetch(readUrl, { headers: { Authorization: `Bearer ${token}` } });
	if (!readRes.ok) {
		throw new HttpError(502, `STATUS read failed: ${readRes.status}`);
	}
	const { values: cellValues } = (await readRes.json()) as { values?: unknown[][] };
	const current = normalizeStatus(cellValues?.[0]?.[0]);
	if (current !== expected) {
		throw new HttpError(409, fmt(MSG.errNotAppliedTask, { status: current }));
	}

	const updatedAtCell = `${tasksSheet}!${colLetter(TASK_COL.UPDATED_AT + 1)}${rowIndex}`;
	const now = formatDateTime(new Date());
	const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values:batchUpdate`;
	const writeRes = await fetch(writeUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			valueInputOption: "USER_ENTERED",
			data: [
				{
					range: cell,
					values: [[next]],
				},
				{
					range: updatedAtCell,
					values: [[now]],
				},
			],
		}),
	});
	if (!writeRes.ok) {
		throw new HttpError(502, `STATUS write failed: ${writeRes.status} ${await writeRes.text()}`);
	}
}

// Read every history row of a user. Used by cashout to compute the balance.
export async function readHistoryRows(
	env: Env,
	token: string,
	historySheet: string,
): Promise<{ date: string; content: string; points: number }[]> {
	const range = `${historySheet}!A2:${HISTORY_LAST_COL_LETTER}`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) {
		throw new HttpError(404, `History sheet not found: ${historySheet} (${res.status})`);
	}
	const { values = [] } = (await res.json()) as { values?: unknown[][] };
	return shapeHistory(values);
}

export async function appendHistoryRow(
	env: Env,
	token: string,
	historySheet: string,
	row: (string | number)[],
): Promise<void> {
	const range = `${historySheet}!A:${HISTORY_LAST_COL_LETTER}`;
	// RAW (vs USER_ENTERED): keep the date column as a literal "yyyy/MM/dd HH:mm"
	// string. With USER_ENTERED, Sheets parses it as a date and stores a serial
	// number, which then renders as "46160.4166…" unless the column is formatted
	// as a date — leaking spreadsheet semantics into the UI.
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			range,
			majorDimension: "ROWS",
			values: [row],
		}),
	});
	if (!res.ok) {
		throw new HttpError(502, `History append failed: ${res.status} ${await res.text()}`);
	}
}

export async function appendTaskRow(
	env: Env,
	token: string,
	tasksSheet: string,
	row: WritableValue[],
): Promise<void> {
	// Use explicit row update instead of :append so writes always land on A:G.
	// Google Sheets append can anchor to a shifted table region (e.g. F:L).
	const readRange = `${tasksSheet}!A2:${TASK_LAST_COL_LETTER}`;
	const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(readRange)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
	const readRes = await fetch(readUrl, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!readRes.ok) {
		throw new HttpError(404, `Task sheet not found: ${tasksSheet} (${readRes.status})`);
	}
	const readBody = (await readRes.json()) as { values?: unknown[][] };
	const values = readBody.values ?? [];
	const nextRow = values.length + 2;
	const writeRange = `${tasksSheet}!A${nextRow}:${TASK_LAST_COL_LETTER}${nextRow}`;
	const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`;
	const writeRes = await fetch(writeUrl, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			range: writeRange,
			majorDimension: "ROWS",
			values: [row],
		}),
	});
	if (!writeRes.ok) {
		throw new HttpError(502, `Task append failed: ${writeRes.status} ${await writeRes.text()}`);
	}
}

export async function updateTaskRow(
	env: Env,
	token: string,
	tasksSheet: string,
	rowIndex: number,
	values: Partial<Record<number, WritableValue>>,
): Promise<void> {
	const updates = Object.entries(values).map(([index, value]) => ({
		range: `${tasksSheet}!${colLetter(Number(index) + 1)}${rowIndex}`,
		values: [[value]],
	}));
	if (updates.length === 0) return;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values:batchUpdate`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			valueInputOption: "USER_ENTERED",
			data: updates,
		}),
	});
	if (!res.ok) {
		throw new HttpError(502, `Task update failed: ${res.status} ${await res.text()}`);
	}
}

// ---------------------------------------------------------------------------
// Shaping — sheet rows → JSON shape the frontend expects
// ---------------------------------------------------------------------------

function shapeTasks(rows: unknown[][]) {
	const now = new Date();
	return rows
		.filter((r) => nonEmpty(r[TASK_COL.ID]) && nonEmpty(r[TASK_COL.TITLE]))
		.filter((r) => {
			const status = normalizeStatus(r[TASK_COL.STATUS]);
			if (status === STATUS.DELETED) return false;
			return true;
		})
		.map((r) => {
			const status = normalizeStatus(r[TASK_COL.STATUS]);
			const baseCompleteReward = toNumber(r[TASK_COL.COMPLETE_REWARD]);
			const rewardReference =
				status === STATUS.SUBMITTED ? r[TASK_COL.UPDATED_AT] : now;
			const completeReward =
				status === STATUS.APPROVED
					? baseCompleteReward
					: rewardWithLatePenalty(baseCompleteReward, r[TASK_COL.EXPIRY], rewardReference);
			return ({
			id: toText(r[TASK_COL.ID]),
			status,
			category: toText(r[TASK_COL.CATEGORY]),
			title: toText(r[TASK_COL.TITLE]),
			submitReward: toNumber(r[TASK_COL.SUBMIT_REWARD]),
			completeReward,
			points: completeReward, // back-compat: legacy `points`
			expiry: toDateString(r[TASK_COL.EXPIRY]),
			updatedAt: toDateTimeString(r[TASK_COL.UPDATED_AT]),
			});
		});
}

function shapeHistory(rows: unknown[][]) {
	return rows
		.filter(
			(r) =>
				nonEmpty(r[HISTORY_COL.DATE]) ||
				nonEmpty(r[HISTORY_COL.CONTENT]) ||
				nonEmpty(r[HISTORY_COL.POINTS]),
		)
		.map((r) => ({
			date: toDateTimeString(r[HISTORY_COL.DATE]),
			content: toText(r[HISTORY_COL.CONTENT]),
			points: toNumber(r[HISTORY_COL.POINTS]),
		}));
}
