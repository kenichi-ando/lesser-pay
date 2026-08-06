/**
 * User-facing message catalog.
 *
 * Errors thrown here are returned verbatim in the JSON response and rendered
 * by the frontend, so wording matters. Keep this in sync with gas/Code.gs MSG.
 */

import { toText } from "./util";

export const MSG = {
	errPinRequired: "暗証番号を入力してください",
	errPinWrong: "暗証番号が違います",
	errParentPinNotSet: "PARENT_PIN が未設定です",
	errTaskNotFound: "課題が見つかりません",
	errTaskRowNotFound: "該当する課題が見つかりません",
	errTaskIdMissing: "taskId が未指定",
	errAlreadyApplied: "すでに申請中です",
	errAlreadyApproved: "すでに承認済みです",
	errNotAppliedTask: "申請中の課題ではありません (現在: {status})",
	errCannotRejectApproved: "承認済みの課題は訂正依頼できません",
	errTaskAlreadyDeleted: "この課題はすでに削除済みです",
	errTaskTitleMissing: "タスク名を入力してください",
	errTaskTitleTooLong: "タスク名は {max} 文字以内で入力してください",
	errTaskCategoryMissing: "分類を入力してください",
	errTaskCategoryTooLong: "分類は {max} 文字以内で入力してください",
	errInvalidAmount: "金額が不正です",
	errInvalidExpiryDate: "期限の日付形式が不正です",
	errCashoutMemoTooLong: "メモは {max} 文字以内で入力してください",
	errInsufficientBalance: "残高不足です (現在 {total} pt)",
	errBonusLabelMissing: "ボーナスのタイトルを入力してください",
	errBonusLabelTooLong: "タイトルは {max} 文字以内で入力してください",

	notifySubjectApply: "{user}から完了報告",
	notifySubjectRequest: "{user}から新しいタスク提案",
	notifySubjectApprove: "{user}の課題が承認されました",
	notifySubjectReject: "{user}の課題に訂正依頼",
	notifySubjectCashout: "{user}のポイント消費",
	notifySubjectBonus: "{user}にボーナス付与",
	notifySubjectDeadlineReminder: "{user}の期限リマインド ({n}件)",
	notifyBonusBody: "{user} に「{label}」で {amount} pt のボーナスを付与しました。\n残高: {balance} pt",
	notifyApplyBodyHeader: "{user} が「{label}」を完了報告しました。",
	notifyApplyBodySubmit: "提出ポイント: {pt} pt (付与済み)",
	notifyApplyBodyComplete: "完了ポイント: {pt} pt (承認後に付与)",
	notifyApplyBodyFooter: "アプリで承認してください。",
	notifyRequestBody: "{user} が新しいタスク「{label}」を提案しました。\n希望ポイント: {pt} pt\nアプリで確認してください。",
	notifyApproveBody: "{user} の「{label}」が承認されました。\n獲得: {pt} pt\n残高: {balance} pt",
	notifyRequestApprovedBody: "{user} のタスク提案「{label}」が承認されました。\nタスク一覧に追加されました。",
	notifyRejectBody: "{user} の「{label}」が訂正依頼になりました。内容を見直して再提出してください。",
	notifyCashoutBody: "{user} が {amount} pt を使いました。\n残高: {balance} pt",
	notifyDeadlineReminderBody: "{user}の期限が3日以内のタスクが {n} 件あります。",
} as const;

// Render a template like "{name} さん" with the given vars.
export function fmt(tpl: string, vars: Record<string, unknown>): string {
	return tpl.replace(/\{(\w+)\}/g, (_, k) => toText(vars[k]));
}
