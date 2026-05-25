/* ENGER エージェント操作マニュアル → Word(.docx) 生成（使い捨て） */
const path = require('path');
const fs = require('fs');
const G = 'C:/Users/user/AppData/Roaming/npm/node_modules';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, TableOfContents, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageBreak, PageNumber, Header, Footer,
} = require(path.join(G, 'docx'));

const JP = '"Yu Gothic", "游ゴシック", "Meiryo", sans-serif';
const NAVY = '0F2440';
const BLUE = '0095D9';
const HEAD_FILL = 'D5EEFB';
const ZEBRA = 'F4FAFE';
const STEP_FILL = '0095D9';
const CONTENT_W = 9360;

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };

const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const p = (t, opts = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, ...opts })] });
const bullet = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(t)] });
const numbered = (t) => new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun(t)] });

// 手順ステップ（番号バッジ風）
function step(n, title, body) {
  const out = [];
  out.push(new Paragraph({
    spacing: { before: 160, after: 40 },
    shading: { fill: 'EAF6FD', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: STEP_FILL, space: 10 } },
    children: [new TextRun({ text: `STEP ${n}  `, bold: true, color: STEP_FILL, size: 22 }), new TextRun({ text: title, bold: true, size: 24, color: NAVY })],
  }));
  for (const b of body) out.push(new Paragraph({ spacing: { after: 60 }, indent: { left: 240 }, children: [new TextRun({ text: b, size: 21 })] }));
  return out;
}

function note(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    shading: { fill: 'FFF7E6', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'F0A500', space: 8 } },
    children: [new TextRun({ text: text, italics: true, size: 20 })],
  });
}
function tip(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    shading: { fill: 'ECFDF3', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: '12B76A', space: 8 } },
    children: [new TextRun({ text: text, size: 20 })],
  });
}

function table(colW, header, rows) {
  const headRow = new TableRow({ tableHeader: true, children: header.map((hh, i) => new TableCell({
    borders, width: { size: colW[i], type: WidthType.DXA }, margins: cellMargins,
    shading: { fill: HEAD_FILL, type: ShadingType.CLEAR },
    children: [new Paragraph({ children: [new TextRun({ text: String(hh), bold: true, size: 19, color: NAVY })] })],
  })) });
  const bodyRows = rows.map((r, ri) => new TableRow({ children: r.map((c, i) => new TableCell({
    borders, width: { size: colW[i], type: WidthType.DXA }, margins: cellMargins,
    shading: { fill: ri % 2 === 1 ? ZEBRA : 'auto', type: ShadingType.CLEAR },
    children: [new Paragraph({ children: [new TextRun({ text: String(c ?? ''), size: 19, color: '222222' })] })],
  })) }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: colW, rows: [headRow, ...bodyRows] });
}

const children = [];

// 表紙
children.push(new Paragraph({ spacing: { before: 2200, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'ENGER', bold: true, size: 72, color: NAVY })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'エージェント操作マニュアル', bold: true, size: 40, color: BLUE })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'ログイン → CSVアップロード → マッチング → 提案 → 成約まで', size: 22, color: '555555' })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'dx.enger.jp ／ 営業エージェント向け', size: 20, color: '777777' })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '最終更新: 2026-05-25', size: 20, color: '777777' })] }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 目次
children.push(h1('目次'));
children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// はじめに
children.push(h1('はじめに — このツールでやること'));
children.push(p('ENGER（dx.enger.jp）は、案件と人材をマッチングして「提案 → 面談 → クロージング → 稼働（成約）」まで進める営業支援ツールです。あなたの基本の流れは次の通りです。'));
children.push(table([900, 8460],
  ['順番', 'やること'],
  [
    ['1', 'ログインする（管理者から受け取ったメール＋仮パスワード）'],
    ['2', '人材・案件を CSV でアップロードする（ここがスタート）'],
    ['3', 'マッチングで「案件 × 人材」のペアを選ぶ'],
    ['4', '提案する（2人1組：提案者＋パートナー）'],
    ['5', '面談・打合せを記録し、クロージングする'],
    ['6', '稼働（成約）にして、日報を書く'],
  ]));
children.push(tip('ポイント：迷ったら「ダッシュボード（ホーム）」に戻ると、今日やるべきことが上から順に出ています。'));

// 1. ログイン
children.push(h1('1. ログイン'));
children.push(...step(1, 'dx.enger.jp を開く', ['ブラウザ（Chrome 推奨）で https://dx.enger.jp を開きます。']));
children.push(...step(2, 'メールとパスワードを入力', [
  '「利用規約・プライバシーポリシーに同意します」にチェックを入れます。',
  '管理者から受け取った「メールアドレス」と「仮パスワード」を入力し、「メールでログイン →」を押します。',
  'Google アカウントで登録された場合は「Google でログイン」を押します。',
]));
children.push(...step(3, '初回ログイン後にパスワードを変更', ['仮パスワードのままにせず、早めにご自身のパスワードへ変更してください。']));
children.push(note('パスワードを忘れた／ログインできないときは、自分で再設定せず管理者に「パスワード再発行」を依頼してください（管理者が新しい仮パスワードを発行します）。'));

// 2. 画面の見方
children.push(h1('2. 画面の見方'));
children.push(p('左サイドバーが主なメニューです。あなたの職能設定により表示が変わります。'));
children.push(table([2200, 7160],
  ['メニュー', '何をする場所か'],
  [
    ['ダッシュボード', '今日やるべきこと・あなたのKPI・クロージングペアの一覧'],
    ['マッチング', '案件と人材を突き合わせてペアを作り、提案ボードに送る'],
    ['案件', '案件の一覧・CSV取込・企業担当の設定'],
    ['人材', '人材（候補者）の一覧・CSV取込'],
    ['提案管理', '提案を「未対応→提案中→面談調整→クロージング中→面談合格」で管理'],
    ['稼働管理', '成約後の稼働を管理'],
    ['打合せ記録', '商談・面談のメモとフォロー'],
    ['日報', '1日の振り返りを記録'],
  ]));

// 3. CSVアップロード（スタート）
children.push(h1('3. CSVで人材・案件をアップロードする（スタート地点）'));
children.push(p('ここから始めます。Excel などで作った CSV を取り込むと、人材や案件が一覧に入ります。', { bold: true }));

children.push(h2('3-1. テンプレートをダウンロード'));
children.push(...step(1, '「人材」または「案件」ページを開く', ['人材を登録するなら「人材」、案件なら「案件」をサイドバーから開きます。']));
children.push(...step(2, '「テンプレ」ボタンを押す', ['画面上部の「テンプレ」ボタンを押すと、見本入りの CSV ファイルがダウンロードされます。これを Excel で開いて編集します。']));

children.push(h2('3-2. CSV に記入する（列の意味）'));
children.push(p('人材テンプレートの列：', { bold: true }));
children.push(table([2200, 7160],
  ['列', '内容'],
  [
    ['氏名', '必須。候補者の名前'],
    ['職種', '例：バックエンドエンジニア'],
    ['所属区分 / 所属', 'フリーランス・自社・パートナー等'],
    ['スキル', '「/」区切りで複数可（例：Java/Spring/AWS）。※重要'],
    ['希望単価', '例：70（万円）。※重要'],
    ['稼働開始 / 勤務地 / 経験 / ステータス', '任意。わかる範囲で'],
  ]));
children.push(p('案件テンプレートの列：', { bold: true }));
children.push(table([2200, 7160],
  ['列', '内容'],
  [
    ['案件名', '必須'],
    ['クライアント名', '企業名。※重要'],
    ['募集職種', '例：フロントエンドエンジニア'],
    ['必要スキル', '「/」区切り（例：React/TypeScript/AWS）。※重要'],
    ['単価下限 / 単価上限', '例：70 / 90（万円）。※重要'],
    ['リモート可否 / 勤務地 / 稼働開始希望日 / ステータス', '任意'],
  ]));
children.push(tip('「スキル」「単価」（案件は「クライアント名」も）が入っていると、後のマッチングの精度が大きく上がります。なるべく埋めましょう。'));

children.push(h2('3-3. アップロードして取り込む'));
children.push(...step(1, '「CSV取込」ボタンを押す', ['画面上部の「CSV取込」を押し、編集した CSV ファイルを選びます。']));
children.push(...step(2, 'プレビューで内容を確認', [
  '取り込み前に「CSV取込プレビュー / 検証」が表示されます。',
  '「取込不可（✗）」の行（氏名・案件名がない等）は自動で除外されます。',
  '「スキル空」などの警告も確認できます。',
]));
children.push(...step(3, '取り込み方法を選ぶ', [
  '「重要データ完備の N 件のみ取込（推奨）」… スキル・単価（案件はクライアントも）が揃った行だけ。質を担保したいとき。',
  '「取込可能な N 件を取込」… 不可を除いた全件。',
  '「正常 N 件のみ」… 警告も無い行だけ。',
]));
children.push(...step(4, '取込完了', ['「N 件を取り込みました」と出れば成功。人材／案件の一覧に反映されます。']));
children.push(note('文字化けする場合は、CSV を「UTF-8」で保存し直してください（テンプレートは UTF-8 です）。'));

// 4. マッチング
children.push(h1('4. マッチング（案件 × 人材）'));
children.push(...step(1, '「マッチング」を開く', ['案件と人材のスコア付きの組み合わせが表示されます。']));
children.push(...step(2, '良いペアを選んで「提案ボードに記録」', ['マッチ度の高いペアを選び、提案ボードへ送ります。これで「提案」が1件作られます。']));
children.push(tip('案件に「企業担当」が設定されていると、その担当者が提案の“クロージング担当のデフォルト”に自動で入ります。'));

// 5. 提案（2人1組）
children.push(h1('5. 提案する（2人1組）'));
children.push(p('提案は必ず「2人1組」で進めます。抜け漏れを防ぐためです。', { bold: true }));
children.push(...step(1, '「提案管理」を開き、カードの「編集」を押す', ['作成された提案がカンバン（未対応 → 提案中 → …）に並びます。']));
children.push(...step(2, '提案者とパートナーを選ぶ', [
  '「提案者」＝あなた（提案を出した人）。',
  '「パートナー」＝一緒に進める相棒を選びます（インサイド／アウトサイドの区分は関係なく、誰でも選べます）。',
]));
children.push(...step(3, 'クロージング担当を決める', [
  '初期値は「案件企業の担当者（開拓した人・その企業と話したことがある人）」が入ります。',
  '基本はその人がクロージングしますが、ペアで相談して別の人に変更できます（提案者・パートナー・他メンバーから選択）。',
]));
children.push(...step(4, '「保存」を押す', ['カードに「提案 ○○ / 組 ○○ / CL ○○」が表示されます。']));
children.push(note('企業担当が未設定の案件は「案件管理で企業担当を設定すると既定になります」と表示されます。先に案件の企業担当を決めておくとスムーズです。'));

// 6. 面談・打合せ・クロージング
children.push(h1('6. 面談・打合せ・クロージング'));
children.push(bullet('提案カードの「編集」で、架電進捗・面談予定日・面談ステータスを記録します。'));
children.push(bullet('商談・打合せの内容は「打合せ記録」に残します（フォロー期限やネガ反応も管理できます）。'));
children.push(bullet('カンバンの「← →」でステージを進めます：提案中 → 面談調整 → クロージング中 → 面談合格。'));
children.push(bullet('見送り（失注）になったら、必ず「失注理由」を選んで記録します（分析の必須項目です）。'));

// 7. 稼働化・日報
children.push(h1('7. 稼働（成約）と日報'));
children.push(...step(1, '面談合格 → 「稼働化」', ['「面談合格」になったカードの「稼働化 →」を押すと、稼働管理へ移ります（売上に計上）。']));
children.push(...step(2, '日報を書く', ['「日報」から1日の振り返りを記録します。ダッシュボードに未提出アラートが出たら忘れずに。']));

// 8. 困ったとき
children.push(h1('8. 困ったとき（FAQ）'));
children.push(table([3400, 5960],
  ['こんなとき', 'どうする'],
  [
    ['ログインできない／パスワードを忘れた', '管理者に「パスワード再発行」を依頼（新しい仮パスワードが発行されます）'],
    ['CSVが文字化けする', 'UTF-8 で保存し直す。まずテンプレートをDLして使う'],
    ['取り込んだのに件数が少ない', '「重要データ完備のみ」を選ぶと、スキル・単価が未記入の行は除外されます'],
    ['提案のクロージング担当が空', '案件に「企業担当」を設定する／カードで担当を選ぶ'],
    ['画面が見つからない', 'サイドバーの表示は職能設定で変わります。必要な職能の付与を管理者に依頼'],
    ['同じ案件×人材を二重提案した', '同一組み合わせは自動でまとめられます（重複作成されません）'],
  ]));
children.push(note('セキュリティ：パスワードやログイン情報を他人と共有しないでください。アカウントの追加・権限変更は管理者のみが行えます。'));

const doc = new Document({
  creator: 'ENGER',
  title: 'ENGER エージェント操作マニュアル',
  styles: {
    default: { document: { run: { font: JP, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: JP, color: NAVY },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: JP, color: BLUE },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 640, hanging: 320 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 640, hanging: 320 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'ENGER エージェント操作マニュアル', size: 16, color: '999999' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '999999' })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, 'ENGERエージェント操作マニュアル.docx'), buf);
  console.log('WROTE ENGERエージェント操作マニュアル.docx', buf.length, 'bytes');
});
