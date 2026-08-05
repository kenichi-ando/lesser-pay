import type { Env } from "./env";
import { SHEET_PREFIX, STATUS, TASK_COL, HISTORY_LABEL, normalizeStatus } from "./schema";
import { MSG, fmt } from "./messages";
import {
  appendHistoryRow,
  appendTaskRow,
  casTaskStatus,
  findTaskRow,
  getAccessToken,
  readHistoryRows,
  updateTaskRow,
} from "./api";
import { checkPin, fetchConfig, labelFor } from "./config";
import { notify } from "./notify";
import {
  HttpError,
  formatDateTime,
  generateTaskId,
  rewardWithLatePenalty,
  shouldHideExpiredTask,
  toNumber,
} from "./util";

const TASK_TITLE_MAX_LEN = 80;
const TASK_CATEGORY_MAX_LEN = 40;

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
  displayName: string,
  body: string,
): Promise<void> {
  await notify(env, fmt(MSG.notifySubjectApply, { user: displayName }), body, "parent");
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

async function notifyRequest(env: Env, user: string, displayName: string, taskLabel: string, pt: number) {
  const subject = fmt(MSG.notifySubjectRequest, { user: displayName });
  const body = fmt(MSG.notifyRequestBody, { user: displayName, label: taskLabel, pt });
  await notify(env, subject, body, "parent");
}

function parseTaskInput(input: {
  category: unknown;
  title: unknown;
  completeReward: unknown;
  expiry?: unknown;
}): { category: string; title: string; completeReward: number; expiry: string } {
  const category = toTextCell(input.category).trim();
  const title = toTextCell(input.title).trim();
  if (!title) throw new HttpError(400, MSG.errTaskTitleMissing);
  if (!category) throw new HttpError(400, MSG.errTaskCategoryMissing);
  if (title.length > TASK_TITLE_MAX_LEN) {
    throw new HttpError(400, fmt(MSG.errTaskTitleTooLong, { max: TASK_TITLE_MAX_LEN }));
  }
  if (category.length > TASK_CATEGORY_MAX_LEN) {
    throw new HttpError(400, fmt(MSG.errTaskCategoryTooLong, { max: TASK_CATEGORY_MAX_LEN }));
  }
  const completeReward = Number(input.completeReward);
  if (!Number.isFinite(completeReward) || completeReward <= 0) {
    throw new HttpError(400, MSG.errInvalidAmount);
  }
  const expiryRaw = toTextCell(input.expiry).trim();
  const expiry = normalizeExpiry(expiryRaw);
  return { category, title, completeReward, expiry };
}

function normalizeExpiry(raw: string): string {
  if (!raw) return "";
  const normalized = raw.replaceAll("-", "/");
  const dateOnly = normalized.slice(0, 10);
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateOnly)) {
    throw new HttpError(400, MSG.errInvalidExpiryDate);
  }
  const parsed = new Date(dateOnly);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, MSG.errInvalidExpiryDate);
  }
  return dateOnly;
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
  if (currentStatus === STATUS.DELETED) throw new HttpError(409, MSG.errTaskAlreadyDeleted);

  const submitReward = toNumber(row[TASK_COL.SUBMIT_REWARD]);
  const completeReward = rewardWithLatePenalty(
    toNumber(row[TASK_COL.COMPLETE_REWARD]),
    row[TASK_COL.EXPIRY],
    new Date(),
  );
  if (shouldHideExpiredTask(row[TASK_COL.EXPIRY], new Date())) {
    throw new HttpError(409, MSG.errExpired);
  }
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
  await notifyApply(env, displayName, notifyBody);

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
  if (currentStatus === STATUS.DELETED) throw new HttpError(409, MSG.errTaskAlreadyDeleted);
  if (currentStatus === STATUS.REQUESTED) {
    await casTaskStatus(env, token, tasksSheet, rowIndex, currentStatus, STATUS.PENDING);
    const displayName = resolveDisplayName(env, user);
    const taskLabel = taskLabelFromRow(row);
    await notifyChild(
      env,
      user,
      fmt(MSG.notifySubjectApprove, { user: displayName }),
      fmt(MSG.notifyRequestApprovedBody, { user: displayName, label: taskLabel }),
    );
    return { taskId, status: STATUS.PENDING };
  }
  if (currentStatus !== STATUS.SUBMITTED) {
    throw new HttpError(409, fmt(MSG.errNotAppliedTask, { status: currentStatus }));
  }

  const taskLabel = taskLabelFromRow(row);
  const points = rewardWithLatePenalty(
    toNumber(row[TASK_COL.COMPLETE_REWARD]),
    row[TASK_COL.EXPIRY],
    row[TASK_COL.UPDATED_AT],
  );
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

export async function handleCreateTask(
  env: Env,
  user: string,
  input: { category: unknown; title: unknown; completeReward: unknown; expiry?: unknown; role: unknown; pin: unknown },
) {
  const role = input.role === "parent" ? "parent" : "child";
  if (role === "parent") checkPin(env, input.pin);
  const parsed = parseTaskInput(input);
  const status = role === "parent" ? STATUS.PENDING : STATUS.REQUESTED;
  const now = formatDateTime(new Date());
  const task: SharedTask = {
    id: generateTaskId(),
    status,
    category: parsed.category,
    title: parsed.title,
    submitReward: 0,
    completeReward: parsed.completeReward,
    points: parsed.completeReward,
    expiry: parsed.expiry,
    updatedAt: now,
  };
  const token = await getAccessToken(env);
  const tasksSheet = taskSheetFor(user);
  await appendTaskRow(env, token, tasksSheet, [
    task.id,
    task.status,
    task.category,
    task.title,
    task.submitReward,
    task.completeReward,
    task.expiry,
    task.updatedAt,
  ]);
  if (role === "child") {
    const displayName = resolveDisplayName(env, user);
    await notifyRequest(env, user, displayName, composeTaskLabel(task.category, task.title), task.completeReward);
  }
  return { task };
}

export async function handleUpdateTask(
  env: Env,
  user: string,
  taskId: string,
  input: { category: unknown; title: unknown; completeReward: unknown; expiry?: unknown; pin: unknown },
) {
  checkPin(env, input.pin);
  if (!taskId) throw new HttpError(400, MSG.errTaskIdMissing);
  const parsed = parseTaskInput(input);
  const token = await getAccessToken(env);
  const tasksSheet = taskSheetFor(user);
  const { row, rowIndex } = await findTaskRow(env, token, tasksSheet, taskId);
  const currentStatus = normalizeStatus(row[TASK_COL.STATUS]);
  if (currentStatus === STATUS.DELETED) throw new HttpError(409, MSG.errTaskAlreadyDeleted);
  const now = formatDateTime(new Date());
  await updateTaskRow(env, token, tasksSheet, rowIndex, {
    [TASK_COL.CATEGORY]: parsed.category,
    [TASK_COL.TITLE]: parsed.title,
    [TASK_COL.COMPLETE_REWARD]: parsed.completeReward,
    [TASK_COL.SUBMIT_REWARD]: 0,
    [TASK_COL.EXPIRY]: parsed.expiry,
    [TASK_COL.UPDATED_AT]: now,
  });
  return {
    taskId,
    task: {
      id: toTextCell(row[TASK_COL.ID]),
      status: currentStatus,
      category: parsed.category,
      title: parsed.title,
      submitReward: 0,
      completeReward: parsed.completeReward,
      points: parsed.completeReward,
      expiry: parsed.expiry,
      updatedAt: now,
    },
  };
}

export async function handleDeleteTask(
  env: Env,
  user: string,
  taskId: string,
  pin: unknown,
) {
  checkPin(env, pin);
  if (!taskId) throw new HttpError(400, MSG.errTaskIdMissing);
  const token = await getAccessToken(env);
  const tasksSheet = taskSheetFor(user);
  const { rowIndex, row } = await findTaskRow(env, token, tasksSheet, taskId);
  const currentStatus = normalizeStatus(row[TASK_COL.STATUS]);
  if (currentStatus === STATUS.DELETED) {
    throw new HttpError(409, MSG.errTaskAlreadyDeleted);
  }
  await casTaskStatus(env, token, tasksSheet, rowIndex, currentStatus, STATUS.DELETED);
  return { taskId, deleted: true as const };
}
