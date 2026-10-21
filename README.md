# マネーダイアリー

家族やパートナーと共有できる家計簿アプリ (PWA)。Firebase (Hosting / Authentication / Firestore) で動きます。

## 機能
- **ログイン**: メール+パスワード (Firebase Authentication)
- **共有**: 家計簿ごとに招待コード/リンクで家族を招待 (7日間有効)。複数の家計簿を切替可。**相手の記録がリアルタイムに反映**されます
- **繰り返し**: 毎日/毎週/毎月/毎年・N間隔・終了日。月末は自動で丸め (1/31 → 2/29)。開いたときに今日までの分を自動記録
- **カテゴリ**: 収入/支出別に無制限に追加、親子の階層、並び替え、色・アイコン (線画アイコン34種から選択)。使用中のカテゴリは削除すると非表示になり過去データを保持
- **リスト / カレンダー表示**: カレンダーは日ごとの収入・支出を表示し、日付をタップするとその日の記録を確認・追加できます (表示形式は記憶されます)
- **検索 → ジャンプ**: メモ/カテゴリ/金額/期間/種類で全期間を検索し、タップでその月へ移動して該当行を強調
- **高速起動 / オフライン**: 前回の画面を localStorage から即描画 → Firebase を後読み。Service Worker で画面部品をキャッシュ、Firestore のオフライン永続化でオフラインでも記録でき、つながると自動同期

## 公開手順 (Firebase)
1. [Firebase コンソール](https://console.firebase.google.com/) でプロジェクトを作成
2. **Authentication** → ログイン方法 → **メール/パスワード** を有効化
3. **Firestore Database** → データベースを作成 (本番モード / リージョンは `asia-northeast1` など)
4. プロジェクトの設定 → マイアプリ → **ウェブアプリ**を追加し、表示される `firebaseConfig` を `src/firebase-config.js` に貼り付け
5. `.firebaserc` の `YOUR-FIREBASE-PROJECT-ID` をプロジェクト ID に書き換え
6. デプロイ
   ```sh
   npm install
   npx firebase login
   npm run deploy     # build → Hosting と Firestore ルールを公開
   ```
   Windows なら `deploy.bat` をダブルクリックするだけでも同じことができます。
   公開 URL は `https://<プロジェクトID>.web.app` です。

### 自動公開 (GitHub Actions)
`master` に更新が入るたびに、テスト → 公開が自動で走ります。最初に1回だけ設定してください。
1. Firebase コンソール → プロジェクトの設定 → **サービス アカウント** → **新しい秘密鍵を生成** (JSON ファイルがダウンロードされます)
2. GitHub のリポジトリ → Settings → Secrets and variables → Actions → **New repository secret**
   - Name: `FIREBASE_SERVICE_ACCOUNT` / Secret: JSON ファイルの中身をそのまま貼り付け
3. Actions タブ → Deploy to Firebase → **Run workflow**

秘密鍵は第三者に見せないでください (リポジトリにコミットしない・チャットに貼らない)。

### 料金
Spark (無料) プランの範囲で動きます。家族数人での利用なら通常は無料枠に収まります (Firestore 読み取り 5万/日・書き込み 2万/日)。

### 注意
- 新規登録はだれでもできます (自分の家計簿を作るだけで、他人の家計簿は招待コードがない限り見られません)。登録を制限したい場合は Firebase コンソールの Authentication 設定で調整してください。
- パスワード再設定メール・メール認証は未実装です。

## 開発
```sh
npm install
npm run dev        # エミュレータ起動 → http://127.0.0.1:5000/?emulator=1
npm test           # 単体テスト + セキュリティルールのテスト (エミュレータ使用・Java が必要)
npm run test:e2e   # 実ブラウザ(Playwright)での通しテスト (2ユーザーの共有まで)
```

## 構成
- `src/app.js` 画面 (最初に描画される。約28KB) / `src/data.js` Firebase とのやりとり (後から読み込み)
- `src/lib/` 繰り返しの日付計算・検索 (純粋関数)
- `firestore.rules` **データ保護の要**。メンバーだけが読み書きでき、招待コードがなければ参加できない
- `build.mjs` esbuild でバンドル → `dist/`

## データ構造
```
users/{uid}/memberships/{bookId}         自分が参加している家計簿の一覧
books/{bookId}                           家計簿 (name, ownerId)
books/{bookId}/members/{uid}             メンバー (role: owner | member)
books/{bookId}/categories/{id}           カテゴリ (parentId で階層)
books/{bookId}/transactions/{id}         収支
books/{bookId}/recurrings/{id}           繰り返し設定 (nextN: 次に作る回)
invites/{code}                           招待コード (bookId, expiresAt)
```
