'use strict';

// 更新内容のお知らせ（ヘッダーのベルマークで表示）。新しいバージョンを先頭に追加する。
// 各項目は利用者が感じやすい変化・便利になった点を優先し、10〜40 文字程度で簡潔に書く。
// type は表示ラベルの種類: 'new'＝新機能 / 'improve'＝改善 / 'fix'＝不具合修正。
// リリース時（npm version で版数を上げるとき）に、そのバージョンの項目をここへ追加すること。
// renderer.js から参照できるよう window に公開する（型は types/globals.d.ts の Window.RELEASE_NOTES）。
window.RELEASE_NOTES = [
  {
    version: '0.1.24',
    date: '2026-11-27',
    items: [
      { type: 'improve', text: 'マウスホイールで作業時間を15分ずつ増減できるように' },
      { type: 'improve', text: '一括変更・個別変更の作業時間も15分単位のボタンで増減' },
      { type: 'improve', text: '一括コピー・一括変更の日付もカレンダーで選べるように' },
      { type: 'improve', text: '一覧の年月もカレンダーで選べるように' },
      { type: 'new', text: '一括コピーの範囲指定で「営業日のみ」登録できるように' },
      { type: 'improve', text: '未来の日付は黄色の背景で「予定時間」と表示' }
    ]
  },
  {
    version: '0.1.23',
    date: '2026-11-27',
    items: [
      { type: 'improve', text: '日付はボタンからカレンダーで選べるように' },
      { type: 'fix', text: '日付欄を押すと文字が青く浮き出る不具合を修正' }
    ]
  },
  {
    version: '0.1.22',
    date: '2026-11-27',
    items: [
      { type: 'new', text: 'ベルマークから更新内容を確認できるように' },
      { type: 'new', text: '日付の左右の◀▶で1日ずつ移動できるように' },
      { type: 'new', text: '案件コード横のボタンでその案件に絞り込み' },
      { type: 'improve', text: '新規登録の作業時間に「8時間−その日の合計」を自動入力' },
      { type: 'improve', text: '作業時間を15分（0.25）単位のボタンで増減' },
      { type: 'improve', text: '日付欄に曜日を表示（土曜は青、日曜・祝日は赤）' },
      { type: 'improve', text: '担当者一覧が入力するだけで即座に絞り込まれるように' },
      { type: 'improve', text: '作業時間が0〜24の範囲外なら登録前にお知らせ' },
      { type: 'fix', text: 'マウスホイールで作業時間が変わってしまう問題を修正' },
      { type: 'fix', text: '更新に失敗したときに再試行できない問題を修正' }
    ]
  },
  {
    version: '0.1.21',
    date: '2026-11-26',
    items: [
      { type: 'new', text: '担当者一覧を部門・未所属で絞り込めるように' },
      { type: 'improve', text: '担当者一覧の長い名前もドラッグで確認できるように' },
      { type: 'improve', text: 'ログイン切れでも入力中の日報登録を残すように' },
      { type: 'improve', text: 'ブラウザ版で日報システムの障害を分かりやすく表示' },
      { type: 'fix', text: '確認画面で「キャンセル」+Enterが実行される不具合を修正' },
      { type: 'fix', text: '作業時間がちょうど8時間でも「未満」になる不具合を修正' },
      { type: 'fix', text: '参照のみ表示で案件コード列がずれる不具合を修正' }
    ]
  },
  {
    version: '0.1.20',
    date: '2026-11-26',
    items: [
      { type: 'new', text: 'タスクトレイの「更新を確認」から更新できるように' },
      { type: 'new', text: 'ブラウザ版でも新しいバージョンをお知らせ' },
      { type: 'improve', text: '横スクロールしても日付と合計時間が見えるように' },
      { type: 'improve', text: '横スクロールしても案件コード列を固定表示' },
      { type: 'improve', text: '作業件数を日付行の右端に表示' }
    ]
  },
  {
    version: '0.1.19',
    date: '2026-11-26',
    items: [
      { type: 'new', text: '日付ごとの見出し行で合計時間と進捗を表示' },
      { type: 'new', text: '合計時間を8時間基準の色付きゲージで表示' },
      { type: 'new', text: '「入力チェック」で入力漏れ・時間不足を確認' },
      { type: 'improve', text: '非稼働（休暇）の行をグレーで表示' },
      { type: 'improve', text: '日付行のクリックでその日の日報をまとめて選択' },
      { type: 'improve', text: '一括処理の進み具合と失敗した日報を表示' },
      { type: 'fix', text: '登録ボタンの二度押しによる重複登録を防止' }
    ]
  },
  {
    version: '0.1.18',
    date: '2026-07-29',
    items: [{ type: 'improve', text: 'ブラウザ表示でも自動でログインできるように' }]
  },
  {
    version: '0.1.17',
    date: '2026-07-21',
    items: [
      { type: 'new', text: 'ⓘボタンで案件コードの設定基準を確認できるように' },
      { type: 'fix', text: '起動時の更新確認エラーを表示しないように' }
    ]
  },
  {
    version: '0.1.16',
    date: '2026-07-16',
    items: [{ type: 'fix', text: '自動更新が失敗することがある不具合を修正' }]
  },
  {
    version: '0.1.15',
    date: '2026-07-16',
    items: [{ type: 'new', text: '日報登録画面の◀▶で前後の日報へ移動できるように' }]
  },
  {
    version: '0.1.14',
    date: '2026-07-16',
    items: [{ type: 'new', text: '新しいバージョンへ自動で更新できるように' }]
  },
  {
    version: '0.1.13',
    date: '2026-07-15',
    items: [{ type: 'improve', text: '画面の文言を分かりやすく修正' }]
  },
  {
    version: '0.1.12',
    date: '2026-07-15',
    items: [
      { type: 'fix', text: 'サインアウト時に元の日報画面が見えないように修正' },
      { type: 'fix', text: 'ブラウザ表示の不具合を修正' }
    ]
  },
  {
    version: '0.1.11',
    date: '2026-07-15',
    items: [{ type: 'improve', text: '自動認証できないときユーザーIDでログイン可能に' }]
  },
  {
    version: '0.1.10',
    date: '2026-07-15',
    items: [{ type: 'improve', text: 'Microsoftのログイン情報から本人を自動で判定' }]
  },
  {
    version: '0.1.9',
    date: '2026-07-14',
    items: [
      { type: 'new', text: 'ブラウザでも日報を入力できるように（ブラウザ表示）' },
      { type: 'improve', text: 'ログインした本人の担当者を自動で表示' }
    ]
  },
  {
    version: '0.1.8',
    date: '2026-07-14',
    items: [
      { type: 'new', text: '選択した日報の内容をまとめて変更（一括変更）' },
      { type: 'new', text: '選択した日報を1画面で個別に編集（個別変更）' },
      { type: 'fix', text: 'Shiftキーでの範囲選択の不具合を修正' }
    ]
  },
  {
    version: '0.1.7',
    date: '2026-07-10',
    items: [{ type: 'improve', text: 'コピー登録を緑色の表示で分かりやすく' }]
  },
  {
    version: '0.1.6',
    date: '2026-07-10',
    items: [{ type: 'improve', text: 'ログイン画面からも更新できるように' }]
  },
  {
    version: '0.1.5',
    date: '2026-07-09',
    items: [
      { type: 'improve', text: '日報を元にしたコピー登録をしやすく改善' },
      { type: 'improve', text: '一覧で見切れた文字をドラッグで確認できるように' }
    ]
  },
  {
    version: '0.1.4',
    date: '2026-07-09',
    items: [
      { type: 'new', text: '一覧を月ごとに表示し、◀▶で月を切り替え' },
      { type: 'new', text: '案件コード・取引先名などで一覧を絞り込み' },
      { type: 'new', text: '「担当変更」で他の担当者の日報を表示' }
    ]
  },
  {
    version: '0.1.3',
    date: '2026-07-08',
    items: [{ type: 'fix', text: '確認画面のあと入力できなくなる不具合を修正' }]
  },
  {
    version: '0.1.2',
    date: '2026-07-07',
    items: [{ type: 'fix', text: '更新の確認画面が何度も出る不具合を修正' }]
  },
  {
    version: '0.1.1',
    date: '2026-07-07',
    items: [{ type: 'improve', text: '自動更新の動作を確認するための版' }]
  },
  {
    version: '0.1.0',
    date: '2026-07-07',
    items: [
      { type: 'new', text: '日報の一覧・登録・修正・削除ができる専用アプリ' },
      { type: 'new', text: '日報をコピーして別の日に登録（コピー登録）' },
      { type: 'new', text: '選択した日報をまとめてコピー・削除' },
      { type: 'new', text: 'Ctrl・Shiftキーで複数の日報を選択' }
    ]
  }
];
