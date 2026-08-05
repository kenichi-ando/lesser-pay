# LesserPay (レサペイ)

家庭向けポイント管理アプリです。  
この README は「初めて運用する人が、同じ構成を立ち上げるための手順書」です。  
技術仕様や内部設計は [`ARCHITECTURE.md`](./ARCHITECTURE.md) を参照してください。

## 1. リポジトリを取得する

```bash
git clone <repo-url>
cd lesser-pay
```

## 2. 事前に用意するもの

- Cloudflare アカウント
- Google アカウント
- Node.js 18 以上
- 家族で使う Google スプレッドシート 1つ

Cloudflare へログイン:

```bash
npx wrangler login
```

## 3. スプレッドシートを準備する

1つのスプレッドシートを作成し、子どもごとに以下 2 タブを作成します。

- `Tasks_<key>` 例: `Tasks_Light`
- `History_<key>` 例: `History_Light`

`Tasks_<key>` は A〜H 列で以下の順番にしてください:

- A: ID
- B: Status
- C: Category
- D: Title
- E: SubmitReward
- F: CompleteReward
- G: Expiry (`YYYY/MM/DD`)
- H: UpdatedAt (`YYYY/MM/DD HH:mm`)

`History_<key>` は A〜C 列で以下の順番にしてください:

- A: Date
- B: Content
- C: Points

ヘッダ行 (1行目) の文字は自由です。列順だけ合わせてください。

## 4. Google Service Account を作成する

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. 「Google Sheets API」を有効化
3. Service Account を作成し、JSON キーをダウンロード
4. JSON 内の `client_email` を、上記スプレッドシートへ「編集者」で共有

## 5. Secret を登録する（必須 / 任意）

まず `npm install` を実行します。

```bash
npm install
```

### 必須 Secret

```bash
npx wrangler secret put GOOGLE_CLIENT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put GOOGLE_SHEET_ID
npx wrangler secret put INVITE_CODE
npx wrangler secret put API_TOKEN
npx wrangler secret put PARENT_PIN
npx wrangler secret put USERS
```

### 任意 Secret

```bash
# Debugユーザー表示切替: 1=有効, 0/未設定=無効
npx wrangler secret put DEBUG

# 通知を使う場合のみ（VAPID）
npx wrangler secret put PUSH_VAPID_PUBLIC_KEY
npx wrangler secret put PUSH_VAPID_PRIVATE_KEY
npx wrangler secret put PUSH_SUBJECT
```

`USERS` は `key:label` のカンマ区切りです（例: `Light:ライト, Tiara:ティアラ`）。
`DEBUG` は `1` のときだけ `Debug User` を追加表示します。

## 6. デプロイする

```bash
npm run deploy
```

デプロイ後に表示される `https://<worker-name>.<account>.workers.dev` がアプリ URL です。

## 7. 招待コードとトークンを作る

- `INVITE_CODE`: 家族に渡す 6 文字コード (`A-Z0-9`)
- `API_TOKEN`: API 用の長いトークン（目安 43 文字）

生成例:

```bash
LC_ALL=C tr -dc 'A-Z0-9' </dev/urandom | head -c 6 ; echo
LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 43 ; echo
```

## 8. 通知を使う場合（任意）

通知を有効化する場合のみ、VAPID キーを生成し、上の「任意 Secret」に登録します。

```bash
npx web-push generate-vapid-keys
npm run deploy
```

## 9. 家族端末の初期設定

各端末で:

1. アプリ URL を開く
2. PWA としてホーム画面に追加（特に iOS は必須）
3. ホーム画面アイコンから起動
4. 招待コード (6文字) を入力
5. 必要なら通知を ON

## 10. 日常運用

- 親: タスク追加、承認、ポイント消費、ボーナス付与
- 子: タスク提案、完了報告
- 期限超過タスク: 1日ごとに完了ポイントが10%ずつ減少し、10日超過で一覧から非表示
- ユーザー追加/改名時:
  - `Tasks_<key>` / `History_<key>` タブを追加
  - `USERS` secret を更新
  - `npm run deploy`

## 11. よく使う運用コマンド

```bash
# Secret 更新
npx wrangler secret put USERS
npx wrangler secret put INVITE_CODE
npx wrangler secret put API_TOKEN

# 再デプロイ
npm run deploy

# ログ確認
npx wrangler tail
```

## 12. トラブル時の確認ポイント

- スプレッドシートのタブ名が `Tasks_<key>` / `History_<key>` と完全一致しているか
- Service Account の `client_email` に編集権限を付けたか
- `GOOGLE_SHEET_ID` が正しいか
- 家族がホーム画面アイコンから起動しているか（iOS 通知の重要条件）

---

実装詳細・データモデル・通知の内部仕様は [`ARCHITECTURE.md`](./ARCHITECTURE.md) に集約しています。
