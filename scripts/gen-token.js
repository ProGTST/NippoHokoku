// ビルド時に環境変数 UPDATE_TOKEN から src/update-token.js を生成する。
// 生成される src/update-token.js は .gitignore 済み（git に平文トークンを残さない）。
// dist / dist:portable / publish の前段（npm run gen-token -- --require）で自動実行される。
//
// --require 指定時（配布ビルド）は UPDATE_TOKEN 未設定ならエラー終了してビルドを止める。
// 空トークンのまま配布すると、その版を入れた全端末で自動更新が失敗し、以後の更新も届かなく
// なるため（手作業での再配布が必要になる）。単体の `npm run gen-token` は警告のみで続行する。
const fs = require('fs');
const path = require('path');

const token = process.env.UPDATE_TOKEN || '';
const required = process.argv.includes('--require');
const outPath = path.join(__dirname, '..', 'src', 'update-token.js');

if (!token) {
  if (required) {
    console.error(
      '\x1b[31m[gen-token] エラー: 環境変数 UPDATE_TOKEN が未設定です。\n' +
        '  配布ビルド（dist / dist:portable / publish）はトークン無しでは作成できません\n' +
        '  （private リポジトリの自動更新が失敗する配布物になるため）。\n' +
        '  UPDATE_TOKEN を設定して再実行してください（リリース手順.md §2.2）。\x1b[0m'
    );
    process.exit(1);
  }
  console.warn(
    '\x1b[33m[gen-token] 警告: 環境変数 UPDATE_TOKEN が未設定です。\n' +
      '  認証トークン無しで生成します（private リポジトリの自動更新は失敗します）。\n' +
      '  配布ビルドでは UPDATE_TOKEN を設定してください。\x1b[0m'
  );
}

const body =
  '// 自動生成ファイル（scripts/gen-token.js）。編集・コミット禁止。\n' +
  'module.exports = { UPDATE_TOKEN: ' +
  JSON.stringify(token) +
  ' };\n';

fs.writeFileSync(outPath, body, 'utf8');
console.log(
  `[gen-token] src/update-token.js を生成しました（token: ${token ? '有り' : 'なし'}）。`
);
