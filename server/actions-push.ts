import type { Env } from "./env";
import {
  normalizePushSubscription,
  removePushSubscription,
  upsertPushSubscription,
} from "./push";

async function savePushSubscription(
  env: Env,
  user: string,
  subscription: unknown,
  role: unknown,
  deviceLabel: unknown,
): Promise<void> {
  const normalized = normalizePushSubscription(subscription);
  await upsertPushSubscription(env, user, normalized, role, deviceLabel);
}

export async function handleSubscribePush(
  env: Env,
  user: string,
  subscription: unknown,
  role: unknown,
  deviceLabel: unknown,
) {
  await savePushSubscription(env, user, subscription, role, deviceLabel);
  return { subscribed: true };
}

export async function handleUnsubscribePush(env: Env, endpoint: unknown) {
  await removePushSubscription(env, endpoint);
  return { unsubscribed: true };
}
