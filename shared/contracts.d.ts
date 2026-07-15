type SharedTaskStatus = 'Pending' | 'Submitted' | 'Approved' | 'Returned';

interface SharedTask {
  id: string;
  status: SharedTaskStatus;
  category: string;
  title: string;
  submitReward: number;
  completeReward: number;
  points: number;
  minutes: number;
  expiry: string;
}

interface SharedHistoryItem {
  date: string;
  content: string;
  points: number;
}

interface SharedUser {
  key: string;
  label: string;
}

interface SharedPushConfig {
  enabled: boolean;
  publicKey: string;
}

interface SharedActionPayloadMap {
  getConfig: { user?: string };
  getData: { user: string };
  verifyPin: { pin: string; user?: string };
  applyTask: { user: string; taskId: string };
  approveTask: { user: string; taskId: string; pin: string };
  rejectTask: { user: string; taskId: string; pin: string };
  withdrawTask: { user: string; taskId: string };
  cashout: { user: string; amount: number; pin: string };
  grantBonus: { user: string; label: string; amount: number; pin: string };
  subscribePush: {
    user: string;
    role: 'parent' | 'child';
    deviceLabel: string;
    subscription: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };
  };
  unsubscribePush: { endpoint: string; user?: string };
  redeemInvite: { code: string };
}

type SharedActionName = keyof SharedActionPayloadMap;

interface SharedApiOkResponseMap {
  getConfig: {
    users: SharedUser[];
    status: Record<string, SharedTaskStatus>;
    push: SharedPushConfig;
  };
  getData: {
    tasks: SharedTask[];
    history: SharedHistoryItem[];
  };
  verifyPin: { verified: true };
  applyTask: { taskId: string; status: SharedTaskStatus; history?: SharedHistoryItem };
  approveTask: { taskId: string; status: SharedTaskStatus; points: number; history: SharedHistoryItem };
  rejectTask: { taskId: string; status: SharedTaskStatus };
  withdrawTask: { taskId: string; status: SharedTaskStatus; history: SharedHistoryItem };
  cashout: { amount: number; balance: number; history: SharedHistoryItem };
  grantBonus: { amount: number; balance: number; history: SharedHistoryItem };
  subscribePush: { subscribed: true };
  unsubscribePush: { unsubscribed: true };
  redeemInvite: { apiToken: string };
}

type SharedApiSuccess<A extends SharedActionName> = { ok: true } & SharedApiOkResponseMap[A];
type SharedApiFailure = { ok: false; error: string };
