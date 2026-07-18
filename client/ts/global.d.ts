/// <reference path="../../shared/contracts.d.ts" />

type LPTaskStatus = SharedTaskStatus;

type LPUser = SharedUser;

type LPTask = Omit<Partial<SharedTask>, 'id' | 'status'> & {
  id: string | number;
  status: LPTaskStatus;
};

type LPHistoryItem = Omit<Partial<SharedHistoryItem>, 'points'> & {
  points?: number | string | null;
};

type LPPushConfig = SharedPushConfig;

interface LPAppState {
  user: string | null;
  serverUsers: LPUser[];
  parentMode: boolean;
  parentPin: string | null;
  needsUserSelection: boolean;
  userSelectionClosable: boolean;
  selectionReturnState: {
    user: string | null;
    parentMode: boolean;
    parentPin: string | null;
  } | null;
  pendingParentSwitchToast: boolean;
  pushConfig: LPPushConfig;
  tasks: LPTask[];
  history: LPHistoryItem[];
  loading: boolean;
  booted: boolean;
  activeTab: 'tasks' | 'history';
}

interface LPStorageKeys {
  user: string;
  parentPin: string;
  parentMode: string;
  apiToken: string;
  pushPromptDismissed: string;
  submittedSnapshot: string;
}

interface LPConfig {
  STORAGE_KEYS: LPStorageKeys;
  INVITE_CODE_LENGTH: number;
  INVITE_CODE_PATTERN: RegExp;
  API_URL: string;
  CACHE_TTL_SEC: number;
}

interface LPStoreApi {
  getUser: () => string | null;
  setUser: (user: string) => void;
  clearUser: () => void;
  getParentPin: () => string | null;
  setParentPin: (pin: string) => void;
  clearParentPin: () => void;
  getParentMode: () => boolean;
  enableParentMode: () => void;
  disableParentMode: () => void;
  clearParentMode: () => void;
  getApiToken: () => string | null;
  setApiToken: (token: string) => void;
  clearApiToken: () => void;
  getPushPromptDismissed: () => boolean;
  setPushPromptDismissed: () => void;
  clearPushPromptDismissed: () => void;
  getSubmittedSnapshot: (user: string) => string[];
  setSubmittedSnapshot: (user: string, ids: string[]) => void;
}

type LPTranslator = (key: string, vars?: Record<string, string | number>) => string;
type LPStatusMap = Record<string, string>;
type LPBusyTarget = HTMLElement | HTMLElement[] | null;
type LPBusyOptions = { label?: string; labelNode?: HTMLElement };
type LPWithBusy = <T>(target: LPBusyTarget, options: LPBusyOptions, action: () => Promise<T>) => Promise<T>;

interface LPRuntime {
  render: () => void;
  renderTabs: () => void;
}

interface LPElements {
  userLabel: HTMLElement;
  userPopover: HTMLElement;
  userPopoverList: HTMLElement;
  userSelectScreen: HTMLElement;
  userSelectList: HTMLElement;
  userSelectCloseBtn: HTMLElement;
  cashoutBtn: HTMLElement;
  bonusBtn: HTMLElement;
  taskUpsertOpenBtn: HTMLElement;
  tabTasks: HTMLElement;
  tabHistory: HTMLElement;
  tabTasksBadge: HTMLElement;
  panelTasks: HTMLElement;
  panelHistory: HTMLElement;
  balance: HTMLElement;
  tasksList: HTMLElement;
  historyList: HTMLElement;
  parentModal: HTMLElement;
  parentPin: HTMLInputElement;
  parentSubmit: HTMLElement;
  parentCancel: HTMLElement;
  parentError: HTMLElement;
  cashoutModal: HTMLElement;
  cashoutAmount: HTMLInputElement;
  cashoutMemo: HTMLInputElement;
  cashoutSubmit: HTMLElement;
  cashoutCancel: HTMLElement;
  cashoutError: HTMLElement;
  cashoutBalance: HTMLElement;
  bonusModal: HTMLElement;
  bonusLabel: HTMLInputElement;
  bonusAmount: HTMLInputElement;
  bonusSubmit: HTMLElement;
  bonusCancel: HTMLElement;
  bonusError: HTMLElement;
  taskUpsertModal: HTMLElement;
  taskUpsertTitle: HTMLElement;
  taskUpsertDesc: HTMLElement;
  taskCategorySelect: HTMLSelectElement;
  taskCategoryCustom: HTMLInputElement;
  taskTitleInput: HTMLInputElement;
  taskPointsInput: HTMLInputElement;
  taskUpsertSubmit: HTMLElement;
  taskUpsertCancel: HTMLElement;
  taskUpsertError: HTMLElement;
  settingsModal: HTMLElement;
  settingsClose: HTMLElement | null;
  settingsPushRow: HTMLButtonElement | null;
  settingsPushToggle: HTMLElement | null;
  settingsSoundRow: HTMLElement | null;
  settingsSoundToggle: HTMLElement | null;
  pullIndicator: HTMLElement;
  toast: HTMLElement;
}

interface LPI18nApi {
  tr: LPTranslator;
  applyI18n: (root?: ParentNode) => void;
}

interface LPUtilsApi {
  escapeHtml: (value: unknown) => string;
  parseDate: (source: unknown) => Date | null;
  formatDate: (source: unknown) => string;
  isExpired: (source: unknown) => boolean;
  withBusy: LPWithBusy;
}

interface LPSoundController {
  unlock: () => void;
  play: (key: string) => void;
  isMuted: () => boolean;
  setMuted: (value: boolean) => void;
  toggleMuted: () => boolean;
}

interface LPControllerActionsApi {
  toast: (message: string, kind?: string) => void;
  onTaskAction: (event: Event) => Promise<void>;
  openCashoutModal: () => void;
  submitCashout: () => Promise<void>;
  openBonusModal: () => void;
  submitBonus: () => Promise<void>;
  openTaskUpsertModal: () => void;
  submitTaskUpsert: () => Promise<void>;
  celebrateRemoteApprovals: () => void;
}

interface LPControllerDataApi {
  api: <A extends SharedActionName>(
    action: A,
    payload?: Partial<SharedActionPayloadMap[A]>
  ) => Promise<SharedApiSuccess<A>>;
  bootstrap: () => Promise<void>;
  loadData: (force: boolean) => Promise<void>;
  renderLocked: () => void;
  refreshServerConfig: () => Promise<void>;
  clearDataCache: () => void;
  refreshPushSubscriptionRole: () => Promise<void>;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
  isPushEnabled: () => boolean;
  isPushSupported: () => boolean;
  pushPermission: () => NotificationPermission | 'unsupported';
}

interface LPControllerApi {
  labelOf: (key: string) => string;
  toggleUserPopover: () => void;
  closeUserPopover: () => void;
  closeUserSelectionWithoutChanges: () => void;
  submitParentLogin: () => Promise<void>;
  closeParentModal: () => void;
  openCashoutModal: () => void;
  submitCashout: () => Promise<void>;
  openBonusModal: () => void;
  submitBonus: () => Promise<void>;
  openTaskUpsertModal: () => void;
  submitTaskUpsert: () => Promise<void>;
  loadData: (force: boolean) => Promise<void>;
  bootstrap: () => Promise<void>;
  onTaskAction: (event: Event) => Promise<void>;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
  isPushEnabled: () => boolean;
  isPushSupported: () => boolean;
  pushPermission: () => NotificationPermission | 'unsupported';
}

interface LPControllerDeps {
  CONFIG: LPConfig;
  store: LPStoreApi;
  state: LPAppState;
  els: LPElements;
  tr: LPTranslator;
  escapeHtml: (value: unknown) => string;
  runtime: LPRuntime;
  withBusy: LPWithBusy;
  getStatus: () => LPStatusMap;
  setStatus: (status: LPStatusMap) => void;
  openSettings: () => void;
}

interface LPControllerDataDeps {
  CONFIG: LPConfig;
  store: LPStoreApi;
  state: LPAppState;
  tr: LPTranslator;
  runtime: LPRuntime;
  getStatus: () => LPStatusMap;
  setStatus: (status: LPStatusMap) => void;
  reconcileActiveUser: () => void;
  userKeys: () => string[];
  showUserSelection: (options: {
    closable: boolean;
    keepSession?: boolean;
    returnState?: LPAppState['selectionReturnState'];
  }) => void;
  openParentModal: () => void;
  tryAutoLoginParent: () => Promise<boolean>;
  toast: (message: string, kind?: string) => void;
  onTasksApproved: (ids: Array<string | number>) => void;
  withBusy: LPWithBusy;
}

interface LPRendererDeps {
  state: LPAppState;
  els: LPElements;
  tr: LPTranslator;
  getStatus: () => LPStatusMap;
  escapeHtml: (value: unknown) => string;
  formatDate: (source: unknown) => string;
  isExpired: (source: unknown) => boolean;
  onTaskAction: (event: Event) => Promise<void>;
  labelOf: (key: string) => string;
}

interface LPRendererApi {
  render: () => void;
  renderTabs: () => void;
  renderBalance: () => void;
  renderTasks: () => void;
  renderHistory: () => void;
}

interface Window {
  webkitAudioContext?: { new (): AudioContext };
  LESSERPAY_CONFIG: LPConfig;
  LESSERPAY_STRINGS: Record<string, unknown>;
  LESSERPAY_I18N: { create: (strings?: Record<string, unknown>) => LPI18nApi };
  LESSERPAY_STORE: { create: (storageKeys: LPStorageKeys) => LPStoreApi };
  LESSERPAY_UTILS: { create: (options: { tr: LPTranslator }) => LPUtilsApi };
  LESSERPAY_SOUND?: LPSoundController;
  LESSERPAY_CONTROLLER_DATA: { create: (deps: LPControllerDataDeps) => LPControllerDataApi };
  LESSERPAY_CONTROLLER_ACTIONS: {
    create: (deps: {
      state: Pick<LPAppState, "parentPin" | "tasks" | "history" | "parentMode" | "user">;
      els: Pick<
        LPElements,
        "toast" | "cashoutAmount" | "cashoutMemo" | "cashoutBalance" | "cashoutError" | "cashoutModal" | "cashoutSubmit" | "bonusLabel" | "bonusAmount" | "bonusError" | "bonusModal" | "bonusSubmit" | "taskUpsertModal" | "taskUpsertTitle" | "taskUpsertDesc" | "taskCategorySelect" | "taskCategoryCustom" | "taskTitleInput" | "taskPointsInput" | "taskUpsertSubmit" | "taskUpsertError"
      >;
      tr: LPTranslator;
      withBusy: (target: LPBusyTarget, options: { label: string; labelNode?: HTMLElement }, action: () => Promise<void>) => Promise<void>;
      api: (action: SharedActionName, payload: Record<string, string | number | null>) => Promise<unknown>;
      clearDataCache: () => void;
      loadData: (force: boolean) => Promise<void>;
      isParentMode: () => boolean;
    }) => LPControllerActionsApi;
  };
  LESSERPAY_CONTROLLER: { create: (deps: LPControllerDeps) => LPControllerApi };
  LESSERPAY_RENDER: { create: (deps: LPRendererDeps) => LPRendererApi };
}

interface Navigator {
  standalone?: boolean;
}
