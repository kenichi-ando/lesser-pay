/**
 * Shared helpers for action handlers (display names, child notifications).
 */
import type { Env } from "./env";
import { fetchConfig, labelFor } from "./config";
import { notify } from "./push";

export async function resolveDisplayName(env: Env, user: string): Promise<string> {
	const cfg = await fetchConfig(env);
	return labelFor(cfg.users, user);
}

export async function notifyChild(
	env: Env,
	user: string,
	subject: string,
	body: string,
): Promise<void> {
	await notify(env, subject, body, "child", user);
}
