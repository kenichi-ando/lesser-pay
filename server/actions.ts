/**
 * Action handlers + dispatch table.
 *
 * Each handler is a pure async function with explicit args; the ACTIONS
 * registry adapts the request shape to those args. Mirrors gas/Code.gs.
 */

import type { Env } from "./env";
import { SHEET_PREFIX, STATUS } from "./schema";
import { readUserData } from "./api";
import { checkPin, fetchConfig } from "./config";
import { getPushPublicKey, pushEnabled } from "./push";
import { handleSubscribePush, handleUnsubscribePush } from "./actions-push";
import {
	handleApplyTask,
	handleApproveTask,
	handleCreateTask,
	handleDeleteTask,
	handleRejectTask,
	handleUpdateTask,
	handleWithdrawTask,
} from "./actions-tasks";
import { handleCashout, handleGrantBonus } from "./actions-finance";

type ServerActionName = Exclude<SharedActionName, "redeemInvite">;
type AnyActionPayload = SharedActionPayloadMap[SharedActionName];

export type ActionRequest = Partial<AnyActionPayload> & {
	action?: SharedActionName;
	user?: string;
	[k: string]: unknown;
};

interface ActionDef {
	requireUser: boolean;
	handler: (req: ActionRequest, env: Env) => Promise<unknown>;
}

function actionDef(requireUser: boolean, handler: ActionDef["handler"]): ActionDef {
	return { requireUser, handler };
}

function userAction(handler: ActionDef["handler"]): ActionDef {
	return actionDef(true, handler);
}

function openAction(handler: ActionDef["handler"]): ActionDef {
	return actionDef(false, handler);
}

function asUser(req: ActionRequest): string {
	return req.user as string;
}

function asTaskId(req: ActionRequest): string {
	return req.taskId as string;
}

export const ACTIONS: Record<ServerActionName, ActionDef> = {
	getConfig: openAction((_req, env) => handleGetConfig(env)),
	getData: userAction((req, env) => handleGetData(env, asUser(req))),
	verifyPin: openAction((req, env) => handleVerifyPin(env, req.pin)),
	applyTask: userAction((req, env) => handleApplyTask(env, asUser(req), asTaskId(req))),
	approveTask: userAction((req, env) =>
		handleApproveTask(env, asUser(req), asTaskId(req), req.pin)),
	rejectTask: userAction((req, env) =>
		handleRejectTask(env, asUser(req), asTaskId(req), req.pin)),
	withdrawTask: userAction((req, env) => handleWithdrawTask(env, asUser(req), asTaskId(req))),
	createTask: userAction((req, env) =>
		handleCreateTask(env, asUser(req), {
			category: req.category,
			title: req.title,
			completeReward: req.completeReward,
			expiry: req.expiry,
			role: req.role,
			pin: req.pin,
		})),
	updateTask: userAction((req, env) =>
		handleUpdateTask(env, asUser(req), asTaskId(req), {
			category: req.category,
			title: req.title,
			completeReward: req.completeReward,
			expiry: req.expiry,
			pin: req.pin,
		})),
	deleteTask: userAction((req, env) =>
		handleDeleteTask(env, asUser(req), asTaskId(req), req.pin)),
	cashout: userAction((req, env) => handleCashout(env, asUser(req), req.amount, req.memo, req.pin)),
	grantBonus: userAction((req, env) =>
		handleGrantBonus(env, asUser(req), req.label, req.amount, req.pin)),
	subscribePush: userAction((req, env) =>
		handleSubscribePush(env, asUser(req), req.subscription, req.role, req.deviceLabel)),
	unsubscribePush: openAction((req, env) => handleUnsubscribePush(env, req.endpoint)),
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleGetConfig(env: Env) {
	const cfg = fetchConfig(env);
	return {
		users: cfg.users,
		status: STATUS,
		push: {
			enabled: pushEnabled(env),
			publicKey: getPushPublicKey(env),
		},
	};
}

async function handleGetData(env: Env, user: string) {
	const tasksSheet = SHEET_PREFIX.TASKS + user;
	const historySheet = SHEET_PREFIX.HISTORY + user;
	return readUserData(env, tasksSheet, historySheet);
}

async function handleVerifyPin(env: Env, pin: unknown) {
	checkPin(env, pin);
	return { verified: true };
}
