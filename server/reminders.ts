/**
 * Daily deadline reminders (cron). Best-effort Push only — no send log sheet.
 */
import type { Env } from "./env";
import { readUserData } from "./api";
import { fetchConfig, labelFor, DEBUG_USER_KEY } from "./config";
import { MSG, fmt } from "./messages";
import { notify } from "./push";
import { SHEET_PREFIX, STATUS } from "./schema";
import { toJstDateParts, toText } from "./util";

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

export async function runDeadlineReminders(env: Env, now = new Date()): Promise<void> {
	if (!env.GOOGLE_SHEET_ID) return;
	const cfg = await fetchConfig(env);

	for (const userDef of cfg.users) {
		const user = userDef.key;
		if (!user || user === DEBUG_USER_KEY) continue;
		try {
			const tasksSheet = `${SHEET_PREFIX.TASKS}${user}`;
			const historySheet = `${SHEET_PREFIX.HISTORY}${user}`;
			const data = await readUserData(env, tasksSheet, historySheet);
			const count = (data.tasks as SharedTask[]).filter(
				(task) =>
					isReminderStatus(task.status) && isDueWithinThreeDaysJst(toText(task.expiry), now),
			).length;

			if (count === 0) continue;
			const displayName = labelFor(cfg.users, user);
			const subject = fmt(MSG.notifySubjectDeadlineReminder, { user: displayName, n: count });
			const body = fmt(MSG.notifyDeadlineReminderBody, { user: displayName, n: count });
			await notify(env, subject, body, "child", user);
			await notify(env, subject, body, "parent");
		} catch (err) {
			console.warn(`Deadline reminder skipped for user=${user}:`, err);
		}
	}
}
