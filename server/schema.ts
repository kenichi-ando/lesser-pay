/**
 * Spreadsheet schema constants.
 *
 * The Worker reads sheet ranges from row 2 down (`A2:…`), so the header row
 * is purely cosmetic — it isn't validated, and you can label it however you
 * like in the spreadsheet UI. We only need column ORDER to match this file.
 */

// Sheet naming. Spreadsheet tab names are case-sensitive, so the casing here
// must match the actual tab names exactly (e.g. "Tasks_Light", "History_Light").
export const SHEET_PREFIX = {
	TASKS: "Tasks_",
	HISTORY: "History_",
} as const;

// Task statuses written into the STATUS column. Anything else (including
// blank) is treated as PENDING.
export const STATUS = {
	PENDING: "Pending",
	REQUESTED: "Requested",
	SUBMITTED: "Submitted",
	RETURNED: "Returned",
	APPROVED: "Approved",
	DELETED: "Deleted",
} as const;

function consumeSchemaError(_error: unknown): void {
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
		consumeSchemaError(err);
		return "";
	}
}

// Read a raw STATUS cell value. Blank → PENDING.
export function normalizeStatus(raw: unknown): string {
	const s = toText(raw);
	return s || STATUS.PENDING;
}

// Task sheet schema. Order = column index. The strings here are TypeScript
// keys (used as `TASK_COL.STATUS` etc.); they have nothing to do with what
// the spreadsheet header row says.
export const TASK_SCHEMA = [
	"ID",
	"STATUS",
	"CATEGORY",
	"TITLE",
	"SUBMIT_REWARD",
	"COMPLETE_REWARD",
	"EXPIRY",
] as const;
export const TASK_COL = Object.fromEntries(TASK_SCHEMA.map((k, i) => [k, i])) as Record<
	(typeof TASK_SCHEMA)[number],
	number
>;
export const TASK_COL_COUNT = TASK_SCHEMA.length;
export const TASK_LAST_COL_LETTER = colLetter(TASK_COL_COUNT);

// History sheet schema.
export const HISTORY_SCHEMA = ["DATE", "CONTENT", "POINTS"] as const;
export const HISTORY_COL = Object.fromEntries(
	HISTORY_SCHEMA.map((k, i) => [k, i]),
) as Record<(typeof HISTORY_SCHEMA)[number], number>;
export const HISTORY_COL_COUNT = HISTORY_SCHEMA.length;
export const HISTORY_LAST_COL_LETTER = colLetter(HISTORY_COL_COUNT);

// Emoji-prefixed history content labels used in HISTORY.CONTENT.
// Older rows that still carry localized status suffixes render as-is —
// we don't rewrite history. New rows use these prefixes.
export const HISTORY_LABEL = {
	SUBMIT_PREFIX: "📩 ",
	APPROVE_PREFIX: "✅ ",
	WITHDRAW_PREFIX: "↩️ ",
	BONUS_PREFIX: "🎁 ",
	CASHOUT: "💸 ポイント消費",
} as const;

// Column index (1-based) → column letter (A, B, ..., Z, AA, ...).
// Lives here because schema constants depend on it; reused in index.ts.
export function colLetter(col: number): string {
	let s = "";
	let n = col;
	while (n > 0) {
		const r = (n - 1) % 26;
		s = String.fromCodePoint(65 + r) + s;
		n = Math.floor((n - 1) / 26);
	}
	return s;
}
