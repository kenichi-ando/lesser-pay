import type { Env } from "./env";
import { getAccessToken, readUserData } from "./api";
import { fetchConfig, labelFor, DEBUG_USER_KEY } from "./config";
import { MSG, fmt } from "./messages";
import { notify } from "./notify";
import { STATUS } from "./schema";

const REMINDER_SHEET = "DeadlineReminders";
const REMINDER_HEADERS = ["date", "user", "taskId", "expiry", "status"] as const;

interface ReminderCandidate {
	taskId: string;
	title: string;
	category: string;
	completeReward: number;
	expiry: string;
	status: string;
}

function consumeReminderError(_error: unknown): void {
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
		consumeReminderError(err);
		return "";
	}
}

function toJstDateParts(source: Date): { y: number; m: number; d: number } {
	const jst = new Date(source.getTime() + 9 * 60 * 60 * 1000);
	return {
		y: jst.getUTCFullYear(),
		m: jst.getUTCMonth() + 1,
		d: jst.getUTCDate(),
	};
}

function toJstDateText(source: Date): string {
	const { y, m, d } = toJstDateParts(source);
	return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

function parseDateOnly(value: string): Date | null {
	if (!value) return null;
	const normalized = value.replaceAll("-", "/").trim();
	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed;
}

function daysUntilExpiryJst(expiryRaw: string, now: Date): number | null {
	const expiry = parseDateOnly(expiryRaw);
	if (!expiry) return null;
	const e = toJstDateParts(expiry);
	const t = toJstDateParts(now);
	const expiryUtc = Date.UTC(e.y, e.m - 1, e.d);
	const todayUtc = Date.UTC(t.y, t.m - 1, t.d);
	return Math.floor((expiryUtc - todayUtc) / (24 * 60 * 60 * 1000));
}

function isDueWithinThreeDaysJst(expiryRaw: string, now: Date): boolean {
	const daysUntil = daysUntilExpiryJst(expiryRaw, now);
	if (daysUntil == null) return false;
	return daysUntil >= 0 && daysUntil <= 3;
}

function isReminderStatus(status: string): boolean {
	// Remind all not-yet-approved tasks.
	return status !== STATUS.APPROVED;
}

function taskLabel(task: ReminderCandidate): string {
	return [task.category, task.title].filter((part) => part && part.length > 0).join(" ");
}

async function hasReminderSheet(env: Env, token: string): Promise<boolean> {
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}?fields=sheets.properties.title`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return false;
	const json = (await res.json()) as {
		sheets?: { properties?: { title?: string } }[];
	};
	const titles = (json.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
	return titles.includes(REMINDER_SHEET);
}

async function writeReminderHeaders(env: Env, token: string): Promise<void> {
	const range = `${REMINDER_SHEET}!A1:E1`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
	await fetch(url, {
		method: "PUT",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ range, majorDimension: "ROWS", values: [REMINDER_HEADERS] }),
	});
}

async function ensureReminderSheet(env: Env, token: string): Promise<void> {
	const exists = await hasReminderSheet(env, token);
	if (exists) return;
	const createUrl = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}:batchUpdate`;
	const createRes = await fetch(createUrl, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			requests: [{ addSheet: { properties: { title: REMINDER_SHEET } } }],
		}),
	});
	// Duplicate title due to race is harmless.
	if (!createRes.ok && createRes.status !== 400) {
		console.warn("Reminder sheet creation failed:", createRes.status, await createRes.text());
	}
	await writeReminderHeaders(env, token);
}

async function readTodayNotifiedTaskIds(env: Env, token: string, todayJst: string): Promise<Set<string>> {
	const range = `${REMINDER_SHEET}!A2:E`;
	const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(range)}`;
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	if (!res.ok) return new Set<string>();
	const body = (await res.json()) as { values?: unknown[][] };
	const rows = body.values ?? [];
	const set = new Set<string>();
	for (const row of rows) {
		const date = toText(row[0]).trim();
		const user = toText(row[1]).trim();
		const taskId = toText(row[2]).trim();
		if (!date || !user || !taskId) continue;
		if (date !== todayJst) continue;
		set.add(`${user}::${taskId}`);
	}
	return set;
}

async function appendReminderLogs(
	env: Env,
	token: string,
	rows: Array<[string, string, string, string, string]>,
): Promise<void> {
	if (rows.length === 0) return;
	const range = `${REMINDER_SHEET}!A:E`;
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
			values: rows,
		}),
	});
	if (!res.ok) {
		console.warn("Reminder append failed:", res.status, await res.text());
	}
}

function buildChildReminderBody(name: string, count: number): string {
	return fmt(MSG.notifyDeadlineReminderBodyChild, { user: name, n: count });
}

function buildParentReminderBody(name: string, count: number): string {
	return fmt(MSG.notifyDeadlineReminderBodyParent, { user: name, n: count });
}

export async function runDeadlineReminders(env: Env, now = new Date()): Promise<void> {
	if (!env.GOOGLE_SHEET_ID) return;
	const token = await getAccessToken(env);
	await ensureReminderSheet(env, token);
	const todayJst = toJstDateText(now);
	const notifiedSet = await readTodayNotifiedTaskIds(env, token, todayJst);
	const cfg = fetchConfig(env);
	const logsToAppend: Array<[string, string, string, string, string]> = [];

	for (const userDef of cfg.users) {
		const user = userDef.key;
		if (!user || user === DEBUG_USER_KEY) continue;
		try {
			const tasksSheet = `Tasks_${user}`;
			const historySheet = `History_${user}`;
			const data = await readUserData(env, tasksSheet, historySheet);
			const candidates = (data.tasks as SharedTask[])
				.filter((task) => isReminderStatus(task.status))
				.filter((task) => isDueWithinThreeDaysJst(toText(task.expiry), now))
				.filter((task) => !notifiedSet.has(`${user}::${toText(task.id)}`))
				.map((task) => ({
					taskId: toText(task.id),
					title: toText(task.title),
					category: toText(task.category),
					completeReward: Number(task.completeReward) || Number(task.points) || 0,
					expiry: toText(task.expiry),
					status: toText(task.status),
				}));

			if (candidates.length === 0) continue;
			const displayName = labelFor(cfg.users, user);
			const subject = fmt(MSG.notifySubjectDeadlineReminder, { user: displayName, n: candidates.length });
			const childBody = buildChildReminderBody(displayName, candidates.length);
			const parentBody = buildParentReminderBody(displayName, candidates.length);
			await notify(env, subject, childBody, "child", user);
			await notify(env, subject, parentBody, "parent");
			for (const task of candidates) {
				logsToAppend.push([todayJst, user, task.taskId, task.expiry, task.status]);
				notifiedSet.add(`${user}::${task.taskId}`);
			}
		} catch (err) {
			console.warn(`Deadline reminder skipped for user=${user}:`, err);
		}
	}

	await appendReminderLogs(env, token, logsToAppend);
}
