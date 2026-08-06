/**
 * Small, framework-free helpers. No external dependencies.
 */

// Error type carrying an HTTP status code. Thrown from anywhere; caught by the
// top-level dispatch in index.ts and converted to a JSON response.
export class HttpError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

export function isValidUser(user: unknown): user is string {
	return typeof user === "string" && user.length > 0 && user.length <= 50;
}

export function nonEmpty(v: unknown): boolean {
	return v != null && v !== "";
}

export function toText(v: unknown): string {
	if (v == null) return "";
	if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
	if (typeof v === "bigint" || typeof v === "symbol") return String(v);
	if (v instanceof Date) return String(v);
	try {
		const json = JSON.stringify(v);
		return json ?? "";
	} catch {
		return "";
	}
}

// Constant-time string compare to avoid leaking length-based timing.
export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a.codePointAt(i) ?? 0) ^ (b.codePointAt(i) ?? 0);
	return diff === 0;
}

export function toNumber(v: unknown): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

// Expiry / date cells: pass through "yyyy/MM/dd" as-is. Sheets returns date
// cells as formatted strings because we request
// dateTimeRenderOption=FORMATTED_STRING when reading.
export function toDateString(v: unknown): string {
	if (v == null || v === "") return "";
	return toText(v);
}

export function toDateTimeString(v: unknown): string {
	if (v == null || v === "") return "";
	// Pre-fix history rows were appended with valueInputOption=USER_ENTERED, so
	// Sheets coerced "yyyy/MM/dd HH:mm" into a serial number (days since
	// 1899/12/30). Decode those rows on read so the UI stays clean. New rows
	// are written RAW and arrive here as strings, hitting the early return.
	if (typeof v === "number" && Number.isFinite(v)) {
		const epoch = Date.UTC(1899, 11, 30); // Sheets epoch in UTC ms
		const ms = epoch + v * 86400 * 1000;
		return formatDateTime(new Date(ms));
	}
	return toText(v);
}

function parseDateLike(v: unknown): Date | null {
	if (v == null || v === "") return null;
	if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
	if (typeof v === "number") {
		const asDate = new Date(v);
		return Number.isNaN(asDate.getTime()) ? null : asDate;
	}
	if (typeof v !== "string") return null;
	const normalized = v.replaceAll("-", "/");
	const parsed = new Date(normalized);
	if (!Number.isNaN(parsed.getTime())) return parsed;
	const fallback = new Date(v);
	return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function toJstDateParts(source: Date): { y: number; m: number; d: number } {
	const jst = new Date(source.getTime() + 9 * 60 * 60 * 1000);
	return {
		y: jst.getUTCFullYear(),
		m: jst.getUTCMonth() + 1,
		d: jst.getUTCDate(),
	};
}

// Returns overdue days in JST date units.
// 0 means on-time or future, 1.. means late by N full days.
export function overdueDaysJst(expiryRaw: unknown, referenceRaw: unknown = new Date()): number | null {
	const expiry = parseDateLike(expiryRaw);
	const reference = parseDateLike(referenceRaw);
	if (!expiry || !reference) return null;
	const e = toJstDateParts(expiry);
	const r = toJstDateParts(reference);
	const expiryUtc = Date.UTC(e.y, e.m - 1, e.d);
	const referenceUtc = Date.UTC(r.y, r.m - 1, r.d);
	const diffDays = Math.floor((referenceUtc - expiryUtc) / (24 * 60 * 60 * 1000));
	return Math.max(diffDays, 0);
}

export function applyLatePenalty(basePoints: number, overdueDays: number): number {
	const base = Number.isFinite(basePoints) ? Math.max(0, Math.floor(basePoints)) : 0;
	if (base <= 0) return 0;
	if (overdueDays <= 0) return base;
	if (overdueDays >= 10) return 0;
	return Math.max(0, Math.floor((base * (10 - overdueDays)) / 10));
}

export function rewardWithLatePenalty(
	basePoints: number,
	expiryRaw: unknown,
	referenceRaw: unknown = new Date(),
): number {
	const overdue = overdueDaysJst(expiryRaw, referenceRaw);
	if (overdue == null) return Number.isFinite(basePoints) ? Math.max(0, Math.floor(basePoints)) : 0;
	return applyLatePenalty(basePoints, overdue);
}

export function shouldHideExpiredTask(expiryRaw: unknown, referenceRaw: unknown = new Date()): boolean {
	const overdue = overdueDaysJst(expiryRaw, referenceRaw);
	return overdue != null && overdue >= 10;
}

// "yyyy/MM/dd HH:mm" in Asia/Tokyo, matching gas/Code.gs formatDateTime.
export function formatDateTime(d: Date): string {
	const tokyo = new Date(d.getTime() + 9 * 3600 * 1000);
	const yyyy = tokyo.getUTCFullYear();
	const mm = String(tokyo.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(tokyo.getUTCDate()).padStart(2, "0");
	const hh = String(tokyo.getUTCHours()).padStart(2, "0");
	const mi = String(tokyo.getUTCMinutes()).padStart(2, "0");
	return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
}

export function generateTaskId(): string {
	const ts = Date.now().toString();
	const randomBytes = crypto.getRandomValues(new Uint8Array(3));
	const randomValue = (randomBytes[0] << 16) | (randomBytes[1] << 8) | randomBytes[2];
	const rand = randomValue.toString(36).padStart(4, "0").slice(0, 4);
	return `T${ts}_${rand}`;
}

export function b64url(s: string): string {
	return b64urlBytes(new TextEncoder().encode(s));
}

export function b64urlBytes(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCodePoint(b);
	return btoa(bin).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}
