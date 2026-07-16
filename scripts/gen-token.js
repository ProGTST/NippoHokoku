// ビルド時に環境変数 UPDATE_TOKEN から src/update-token.js を生成する。
// 生成される src/update-token.js は .gitignore 済み（git に平文トークンを残さない）。
// dist / dist:portable / publish の前段（npm run gen-token）で自動実行される。
const fs = require('fs');
const path = require('path');

const token = process.env.UPDATE_TOKEN || '';
const outPath = path.join(__dirname, '..', 'src', 'update-token.js');

if (!token) {
  console.warn(
    '\x1b[33m[gen-token] 警告: 環境変数 UPDATE_TOKEN が未設定です。\n' +
      '  認証トークン無しでビルドします（private リポジトリの自動更新は失敗します）。\n' +
      '  配布ビルドでは UPDATE_TOKEN を設定してください。\x1b[0m'
  );
}

const body =
  '// 自動生成ファイル（scripts/gen-token.js）。編集・コミット禁止。\n' +
  'module.exports = { UPDATE_TOKEN: ' +
  JSON.stringify(token) +
  ' };\n';

fs.writeFileSync(outPath, body, 'utf8');
console.log(`[gen-token] src/update-token.js を生成しました（token: ${token ? '有り' : 'なし'}）。`);
