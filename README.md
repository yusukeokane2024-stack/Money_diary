# マネーダイアリー

家族やパートナーと共有できる家計簿アプリ (PWA)。依存パッケージなし、Node.js 22.13+ だけで動きます。

```sh
npm start          # http://localhost:3000  (PORT / DB_FILE で変更可)
npm test
```

## 機能
- **ログイン**: メール+パスワード (scrypt)、HttpOnly Cookie セッション
- **共有**: 家計簿ごとにメンバーを招待 (招待コード/リンク、7日間有効)。複数の家計簿を切替可
- **繰り返し**: 毎日/毎週/毎月/毎年・N間隔・終了日。月末は自動で丸め (1/31 → 2/29)。開いた時に今日までの分を自動記録 (冪等)
- **カテゴリ**: 収入/支出別に無制限に追加、親子の階層、並び替え、色・アイコン。使用中のカテゴリは削除すると非表示になり過去データを保持
- **検索 → ジャンプ**: メモ/カテゴリ/金額/期間/種類で検索し、タップでその月へ移動して該当行を強調
- **高速起動**: Service Worker でシェルをキャッシュ、`boot.js` が JS 解析前に API 取得を開始、前回データを localStorage から即描画 (1リクエスト `bootstrap` で全データ取得)、gzip + ETag、ビルド・フレームワーク無し

## 構成
`server/` (http + node:sqlite) / `public/` (ES modules の SPA) / `test/`

## 公開 (デプロイ)
データは SQLite ファイルなので、**永続ディスク (`/data`) が使える**サービスを選んでください。必ず HTTPS で公開します (Cookie の Secure 属性は `X-Forwarded-Proto: https` で自動付与)。

- **Render**: GitHub リポジトリを連携 → New → Blueprint で `render.yaml` を読み込み (永続ディスクは有料プランが必要)
- **Fly.io / VPS など**: `docker build -t money-diary .` → `docker run -p 3000:3000 -v money-data:/data money-diary`

環境変数: `PORT` (既定 3000) / `DB_FILE` (既定 `/data/money.db`)。バックアップは `DB_FILE` (と `-wal` ファイル) をコピーしてください。
