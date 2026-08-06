import type { Env } from "./env";
import { SHEET_PREFIX, HISTORY_LABEL } from "./schema";
import { MSG, fmt } from "./messages";
import { appendHistoryRow, getAccessToken, readHistoryRows } from "./api";
import { checkPin } from "./config";
import { notifyChild, resolveDisplayName } from "./actions-helpers";
import { HttpError, formatDateTime, toNumber, toText } from "./util";

const BONUS_LABEL_MAX_LEN = 80;
const CASHOUT_MEMO_MAX_LEN = 80;

async function readBalance(env: Env, token: string, historySheet: string): Promise<number> {
  const rows = await readHistoryRows(env, token, historySheet);
  return rows.reduce((s, h) => s + (toNumber(h.points) || 0), 0);
}

async function appendHistoryAndBuild(
  env: Env,
  token: string,
  historySheet: string,
  content: string,
  points: number,
): Promise<{ date: string; content: string; points: number }> {
  const historyDate = formatDateTime(new Date());
  await appendHistoryRow(env, token, historySheet, [historyDate, content, points]);
  return { date: historyDate, content, points };
}

function parsePositiveAmount(amount: unknown): number {
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new HttpError(400, MSG.errInvalidAmount);
  return amt;
}

export async function handleCashout(
  env: Env,
  user: string,
  amount: unknown,
  memoRaw: unknown,
  pin: unknown,
) {
  await checkPin(env, pin);
  const amt = parsePositiveAmount(amount);
  const memo = toText(memoRaw).trim();
  if (memo.length > CASHOUT_MEMO_MAX_LEN) {
    throw new HttpError(400, fmt(MSG.errCashoutMemoTooLong, { max: CASHOUT_MEMO_MAX_LEN }));
  }

  const token = await getAccessToken(env);
  const historySheet = SHEET_PREFIX.HISTORY + user;
  const total = await readBalance(env, token, historySheet);
  if (amt > total) {
    throw new HttpError(409, fmt(MSG.errInsufficientBalance, { total }));
  }
  const history = await appendHistoryAndBuild(
    env,
    token,
    historySheet,
    memo ? `${HISTORY_LABEL.CASHOUT}: ${memo}` : HISTORY_LABEL.CASHOUT,
    -amt,
  );
  const balance = total - amt;

  const displayName = await resolveDisplayName(env, user);
  await notifyChild(
    env,
    user,
    fmt(MSG.notifySubjectCashout, { user: displayName }),
    fmt(MSG.notifyCashoutBody, { user: displayName, amount: amt, balance }),
  );

  return {
    amount: amt,
    balance,
    history,
  };
}

export async function handleGrantBonus(
  env: Env,
  user: string,
  labelRaw: unknown,
  amount: unknown,
  pin: unknown,
) {
  await checkPin(env, pin);
  const amt = parsePositiveAmount(amount);
  const label = toText(labelRaw).trim();
  if (!label) throw new HttpError(400, MSG.errBonusLabelMissing);
  if (label.length > BONUS_LABEL_MAX_LEN) {
    throw new HttpError(400, fmt(MSG.errBonusLabelTooLong, { max: BONUS_LABEL_MAX_LEN }));
  }

  const token = await getAccessToken(env);
  const historySheet = SHEET_PREFIX.HISTORY + user;
  const total = await readBalance(env, token, historySheet);
  const historyContent = HISTORY_LABEL.BONUS_PREFIX + label;
  const history = await appendHistoryAndBuild(
    env,
    token,
    historySheet,
    historyContent,
    amt,
  );
  const balance = total + amt;

  const displayName = await resolveDisplayName(env, user);
  await notifyChild(
    env,
    user,
    fmt(MSG.notifySubjectBonus, { user: displayName }),
    fmt(MSG.notifyBonusBody, { user: displayName, label, amount: amt, balance }),
  );

  return {
    amount: amt,
    balance,
    history,
  };
}
