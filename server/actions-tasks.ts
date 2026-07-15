import type { Env } from "./env";
import { SHEET_PREFIX, STATUS, TASK_COL, HISTORY_LABEL, normalizeStatus } from "./schema";
import { MSG, fmt } from "./messages";
import {
  appendHistoryRow,
  casTaskStatus,
  findTaskRow,
  getAccessToken,
  readHistoryRows,
} from "./api";
import { DEBUG_USER_KEY, checkPin, fetchConfig, labelFor } from "./config";
import { notify } from "./notify";
import { HttpError, formatDateTime, isExpired, toNumber } from "./util";

function toTextCell(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function composeTaskLabel(category: string, title: string): string {
  return [category, title].filter((s) => s && s.length > 0).join(" ");
}

function taskLabelFromRow(row: unknown[]): string {
  const category = toTextCell(row[TASK_COL.CATEGORY]);
  const title = toTextCell(row[TASK_COL.TITLE]);
  return composeTaskLabel(category, title);
}

function resolveDisplayName(env: Env, user: string): string {
  const cfg = fetchConfig(env);
  return labelFor(cfg.users, user);
}

function taskSheetFor(user: string): string {
  return SHEET_PREFIX.TASKS + user;
}

function historySheetFor(user: string): string {
  return SHEET_PREFIX.HISTORY + user;
}

async function notifyChild(
  env: Env,
  user: string,
  subject: string,
  body: string,
): Promise<void> {
  await notify(env, subject, body, "child", user);
}

async function notifyApply(
  env: Env,
  user: string,
  displayName: string,
  body: string,
): Promise<void> {
  if (user !== DEBUG_USER_KEY) {
    await notify(env, fmt(MSG.notifySubjectApply, { user: displayName }), body, "parent");
    return;
  }
  const debugEndpoint = String(env.DEBUG_ENDPOINT ?? "").trim();
  if (!debugEndpoint) return;
  await notify(
    env,
    `[DEBUG] ${fmt(MSG.notifySubjectApply, { user: displayName })}`,
    body,
    "parent",
    undefined,
    debugEndpoint,
  );
}

function buildApplyNotifyBody(
  displayName: string,
  p: { taskLabel: string; completeReward: number; submitReward: number },
): string {
  const lines = [
    fmt(MSG.notifyApplyBodyHeader, { user: displayName, label: p.taskLabel }),
    ...(p.submitReward > 0 ? [fmt(MSG.notifyApplyBodySubmit, { pt: p.submitReward })] : []),
    fmt(MSG.notifyApplyBodyComplete, { pt: p.completeReward }),
    "",
    MSG.notifyApplyBodyFooter,
  ];
  return lines.join("\n");
}

export async function handleApplyTask(env: Env, user: string, taskId: string) {
  if (!taskId) throw new HttpError(400, MSG.errTaskIdMissing);

  const token = await getAccessToken(env);
  const tasksSheet = taskSheetFor(user);
  const historySheet = historySheetFor(user);
  const { row, rowIndex } = await findTaskRow(env, token, tasksSheet, taskId);

  const currentStatus = normalizeStatus(row[TASK_COL.STATUS]);
  if (currentStatus === STATUS.SUBMITTED) throw new HttpError(409, MSG.errAlreadyApplied);
  if (currentStatus === STATUS.APPROVED) throw new HttpError(409, MSG.errAlreadyApproved);

  const expiry = row[TASK_COL.EXPIRY];
  if (isExpired(expiry)) throw new HttpError(409, MSG.errExpired);

  const submitReward = toNumber(row[TASK_COL.SUBMIT_REWARD]);
  const completeReward = toNumber(row[TASK_COL.COMPLETE_REWARD]);
  const taskLabel = taskLabelFromRow(row);
  const isFirstSubmit = currentStatus !== STATUS.RETURNED;

  const historyDate = formatDateTime(new Date());
  let history: { date: string; content: string; points: number } | null = null;
  if (isFirstSubmit && submitReward > 0) {
    const historyContent = HISTORY_LABEL.SUBMIT_PREFIX + taskLabel;
    await appendHistoryRow(env, token, historySheet, [historyDate, historyContent, submitReward]);
    history = { date: historyDate, content: historyContent, points: submitReward };
  }

  await casTaskStatus(env, token, tasksSheet, rowIndex, currentStatus, STATUS.SUBMITTED);

  const displayName = resolveDisplayName(env, user);
  const notifyBody = buildApplyNotifyBody(displayName, {
    taskLabel,
    completeReward,
    submitReward: isFirstSubmit ? submitReward : 0,
  });
  await notifyApply(env, user, displayName, notifyBody);

  return { taskId, status: STATUS.SUBMITTED, history };
}

export async function handleApproveTask(env: Env, user: string, taskId: string, pin: unknown) {
  checkPin(env, pin);
  if (!taskId) throw new HttpError(400, MSG.errTaskIdMissing);

  const token = await getAccessToken(env);
  const tasksSheet = taskSheetFor(user);
  const historySheet = historySheetFor(user);
  const { row, rowIndex } = await findTaskRow(env, token, tasksSheet, taskId);

  const currentStatus = normalizeStatus(row[TASK_COL.STATUS]);
  if (currentStatus === STATUS.APPROVED) throw new HttpError(409, MSG.errAlreadyApproved);
  if (currentStatus !== STATUS.SUBMITTED) {
    throw new HttpError(409, fmt(MSG.errNotAppliedTask, { status: currentStatus }));
  }

  const taskLabel = taskLabelFromRow(row);
  const points = toNumber(row[TASK_COL.COMPLETE_REWARD]);
  const content = HISTORY_LABEL.APPROVE_PREFIX + taskLabel;

  const rows = await readHistoryRows(env, token, historySheet);
  const total = rows.reduce((s, h) => s + (toNumber(h.points) || 0), 0);
  const historyDate = formatDateTime(new Date());
  await appendHistoryRow(env, token, historySheet, [historyDate, content, points]);
  await casTaskStatus(env, token, tasksSheet, rowIndex, currentStatus, STATUS.APPROVED);
  const balance = total + points;

  const displayName = resolveDisplayName(env, user);
  await notifyChild(
    env,
    user,
    fmt(MSG.notifySubjectApprove, { user: displayName }),
    fmt(MSG.notifyApproveBody, { user: displayName, label: taskLabel, pt: points, balance }),
  );

  return {
    taskId,
    status: STATUS.APPROVED,
    points,
    history: { date: historyDate, content, points },
  };
}

export async function handleRejectTask(
  env: Env,
  user: string,
  taskId: string,
  pin: unknown,
) {
  checkPin(env, pin);
  if (!taskId) throw new HttpError(400, MSG.errTaskIdMissing);

  const token = await getAccessToken(env);
  const tasksSheet = taskSheetFor(user);
  const { row, rowIndex } = await findTaskRow(env, token, tasksSheet, taskId);
  const currentStatus = normalizeStatus(row[TASK_COL.STATUS]);
  if (currentStatus === STATUS.APPROVED) {
    throw new HttpError(409, MSG.errCannotRejectApproved);
  }

  await casTaskStatus(env, token, tasksSheet, rowIndex, currentStatus, STATUS.RETURNED);
  const displayName = resolveDisplayName(env, user);
  const taskLabel = taskLabelFromRow(row);
  await notifyChild(
    env,
    user,
    fmt(MSG.notifySubjectReject, { user: displayName }),
    fmt(MSG.notifyRejectBody, { user: displayName, label: taskLabel }),
  );

  return { taskId, status: STATUS.RETURNED };
}

export async function handleWithdrawTask(env: Env, user: string, taskId: string) {
  if (!taskId) throw new HttpError(400, MSG.errTaskIdMissing);

  const token = await getAccessToken(env);
  const tasksSheet = taskSheetFor(user);
  const historySheet = historySheetFor(user);
  const { row, rowIndex } = await findTaskRow(env, token, tasksSheet, taskId);
  const currentStatus = normalizeStatus(row[TASK_COL.STATUS]);
  if (currentStatus !== STATUS.SUBMITTED) {
    throw new HttpError(409, fmt(MSG.errNotAppliedTask, { status: currentStatus }));
  }

  const submitReward = toNumber(row[TASK_COL.SUBMIT_REWARD]);
  const taskLabel = taskLabelFromRow(row);
  const historyDate = formatDateTime(new Date());
  const historyPoints = submitReward > 0 ? -submitReward : 0;
  const historyContent = HISTORY_LABEL.WITHDRAW_PREFIX + taskLabel;
  await appendHistoryRow(env, token, historySheet, [historyDate, historyContent, historyPoints]);
  await casTaskStatus(env, token, tasksSheet, rowIndex, currentStatus, STATUS.PENDING);

  return {
    taskId,
    status: STATUS.PENDING,
    history: { date: historyDate, content: historyContent, points: historyPoints },
  };
}
