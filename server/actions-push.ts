import type { Env } from "./env";
import {
  normalizePushSubscription,
  removePushSubscription,
  upsertPushSubscription,
} from "./push";

export async function handleSubscribePush(
  env: Env,
  user: string,
  subscription: unknown,
  role: unknown,
  deviceLabel: unknown,
) {
  await upsertPushSubscription(env, user, normalizePushSubscription(subscription), role, deviceLabel);
  return { subscribed: true };
}

export async function handleUnsubscribePush(env: Env, endpoint: unknown) {
  await removePushSubscription(env, endpoint);
  return { unsubscribed: true };
}
