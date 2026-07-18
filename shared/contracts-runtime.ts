type ValidationOk<T> = { ok: true; value: T };
type ValidationErr = { ok: false; error: string };
type ValidationResult<T> = ValidationOk<T> | ValidationErr;
type ValidationFn = (body: Record<string, unknown>) => ValidationErr | null;

type RuntimeActionRequest = {
  action: SharedActionName;
  user?: string;
  [k: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasOptionalUser(body: Record<string, unknown>): ValidationErr | null {
  if (body.user == null) return null;
  if (!isString(body.user)) return { ok: false, error: 'Invalid user' };
  return null;
}

function missing(field: string): ValidationErr {
  return { ok: false, error: `Invalid ${field}` };
}

function validateUserTask(body: Record<string, unknown>): ValidationErr | null {
  if (!isString(body.user)) return missing('user');
  return isString(body.taskId) ? null : missing('taskId');
}

function validateCreateTask(body: Record<string, unknown>): ValidationErr | null {
  if (!isString(body.user)) return missing('user');
  if (!isString(body.category)) return missing('category');
  if (!isString(body.title)) return missing('title');
  if (!isNumber(body.completeReward)) return missing('completeReward');
  if (body.expiry != null && !isString(body.expiry)) return missing('expiry');
  if (body.role !== 'parent' && body.role !== 'child') return missing('role');
  if (body.role === 'parent' && !isString(body.pin)) return missing('pin');
  return null;
}

function validateUpdateTask(body: Record<string, unknown>): ValidationErr | null {
  if (!isString(body.user)) return missing('user');
  if (!isString(body.taskId)) return missing('taskId');
  if (!isString(body.category)) return missing('category');
  if (!isString(body.title)) return missing('title');
  if (!isNumber(body.completeReward)) return missing('completeReward');
  if (body.expiry != null && !isString(body.expiry)) return missing('expiry');
  return isString(body.pin) ? null : missing('pin');
}

function validateUserTaskPin(body: Record<string, unknown>): ValidationErr | null {
  const err = validateUserTask(body);
  if (err) return err;
  return isString(body.pin) ? null : missing('pin');
}

function validateUserAmountPin(body: Record<string, unknown>): ValidationErr | null {
  if (!isString(body.user)) return missing('user');
  if (!isNumber(body.amount)) return missing('amount');
  if (body.memo != null && !isString(body.memo)) return missing('memo');
  return isString(body.pin) ? null : missing('pin');
}

function validateUserLabelAmountPin(body: Record<string, unknown>): ValidationErr | null {
  if (!isString(body.user)) return missing('user');
  if (!isString(body.label)) return missing('label');
  if (!isNumber(body.amount)) return missing('amount');
  return isString(body.pin) ? null : missing('pin');
}

function validateEndpointWithOptionalUser(body: Record<string, unknown>): ValidationErr | null {
  if (!isString(body.endpoint)) return missing('endpoint');
  return hasOptionalUser(body);
}

function validateInviteCode(body: Record<string, unknown>): ValidationErr | null {
  return isString(body.code) ? null : missing('invite code');
}

function getActionValidator(action: unknown): ValidationFn | null {
  if (!isString(action)) return null;
  return validators[action as SharedActionName] || null;
}

function validateSubscribePush(body: Record<string, unknown>): ValidationErr | null {
  if (!isString(body.user)) return missing('user');
  if (body.role !== 'parent' && body.role !== 'child') return missing('role');
  if (!isString(body.deviceLabel)) return missing('deviceLabel');
  if (!isRecord(body.subscription)) return missing('subscription');
  if (!isString(body.subscription.endpoint)) return missing('subscription.endpoint');
  if (!isRecord(body.subscription.keys)) return missing('subscription.keys');
  if (!isString(body.subscription.keys.p256dh)) return missing('subscription.keys.p256dh');
  return isString(body.subscription.keys.auth) ? null : missing('subscription.keys.auth');
}

const validators: Record<SharedActionName, ValidationFn> = {
  getConfig: () => null,
  getData: (body) => (isString(body.user) ? null : missing('user')),
  verifyPin: (body) => (isString(body.pin) ? null : missing('pin')),
  applyTask: validateUserTask,
  approveTask: validateUserTaskPin,
  rejectTask: validateUserTaskPin,
  withdrawTask: validateUserTask,
  createTask: validateCreateTask,
  updateTask: validateUpdateTask,
  deleteTask: validateUserTaskPin,
  cashout: validateUserAmountPin,
  grantBonus: validateUserLabelAmountPin,
  subscribePush: validateSubscribePush,
  unsubscribePush: validateEndpointWithOptionalUser,
  redeemInvite: validateInviteCode,
};

export function validateActionRequest(input: unknown): ValidationResult<RuntimeActionRequest> {
  if (!isRecord(input)) return { ok: false, error: 'Invalid JSON body' };
  const validate = getActionValidator(input.action);
  if (!validate) {
    if (!isString(input.action)) return { ok: false, error: 'Missing or invalid action' };
    return { ok: false, error: `Unsupported action: ${input.action}` };
  }

  const actionErr = validate(input);
  if (actionErr) return actionErr;
  return { ok: true, value: input as RuntimeActionRequest };
}
