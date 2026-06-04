/* ENGER 運営・管理者マニュアル → Word(.docx) 生成スクリプト（使い捨て） */
const path = require('path');
const fs = require('fs');
const G = 'C:/Users/user/AppData/Roaming/npm/node_modules';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, TableOfContents, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageBreak, PageNumber, Header, Footer, ExternalHyperlink,
} = require(path.join(G, 'docx'));

const JP = '"Yu Gothic", "游ゴシック", "Meiryo", sans-serif';
const NAVY = '0F2440';
const BLUE = '0B5CAB';
const HEAD_FILL = 'D5E8F0';
const ZEBRA = 'F4F7FB';
const CONTENT_W = 9360; // US Letter 1" margins

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] });
}
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, ...opts })] });
}
function bullet(text) {
  return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(text)] });
}
function numbered(text, ref = 'numbers') {
  return new Paragraph({ numbering: { reference: ref, level: 0 }, children: [new TextRun(text)] });
}
function note(text) {
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    shading: { fill: 'FFF7E6', type: ShadingType.CLEAR },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'F0A500', space: 8 } },
    children: [new TextRun({ text, italics: true })],
  });
}

// 表: cols=[{w}], header=[..], rows=[[..]]
function table(colW, header, rows) {
  const mkCell = (txt, isHead, w) => new TableCell({
    borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    shading: { fill: isHead ? HEAD_FILL : 'auto', type: ShadingType.CLEAR },
    children: [new Paragraph({ children: [new TextRun({ text: String(txt ?? ''), bold: !!isHead, size: 19, color: isHead ? NAVY : '222222' })] })],
  });
  const rowEls = [];
  rowEls.push(new TableRow({ tableHeader: true, children: header.map((hh, i) => mkCell(hh, true, colW[i])) }));
  rows.forEach((r, ri) => {
    rowEls.push(new TableRow({
      children: r.map((c, i) => {
        const cell = mkCell(c, false, colW[i]);
        if (ri % 2 === 1) cell.options ? null : null; // zebra below
        return cell;
      }),
    }));
  });
  // zebra striping (rebuild rows with shading)
  const striped = [rowEls[0]];
  rows.forEach((r, ri) => {
    striped.push(new TableRow({
      children: r.map((c, i) => new TableCell({
        borders, width: { size: colW[i], type: WidthType.DXA }, margins: cellMargins,
        shading: { fill: ri % 2 === 1 ? ZEBRA : 'auto', type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text: String(c ?? ''), size: 19, color: '222222' })] })],
      })),
    }));
  });
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: colW, rows: striped });
}

const children = [];

// 表紙
children.push(new Paragraph({ spacing: { before: 2400, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'ENGER', bold: true, size: 72, color: NAVY })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: '運営・管理者マニュアル', bold: true, size: 40, color: BLUE })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: 'LP（enger.jp）／ dx（dx.enger.jp）／ LMS 統合運用ガイド', size: 22, color: '555555' })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: '対象: 運営・管理者（社内スタッフ）', size: 20, color: '777777' })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '最終更新: 2026-05-25', size: 20, color: '777777' })] }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 目次
children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('目次')] }));
children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// 1. 全体構成
children.push(h1('1. 全体構成'));
children.push(p('ENGER は 1つの中央 Supabase を共有する3つのシステムで構成されます。'));
children.push(table([1500, 2200, 3260, 2400],
  ['システム', 'URL', '役割', 'リポジトリ'],
  [
    ['LP', 'enger.jp', 'エンジニア向け：登録・案件探し・スカウト受信', 'morishin1/enger-lp (Astro 5 / Vercel)'],
    ['dx', 'dx.enger.jp', '社内の営業/管理ツール（人材・案件・選考）', 'morishin1/enger-matching (Next.js 16 / Vercel)'],
    ['LMS', '別ドメイン', '教育・学習管理プラットフォーム', 'morishin1/lms (Cloudflare)'],
  ]));
children.push(h2('中央 Supabase'));
children.push(bullet('プロジェクト ref: htglvascsuqkixpmclwr'));
children.push(bullet('public … エンジニアのプロフィール（profiles）。LP が書き込み、dx が読み取り。'));
children.push(bullet('enger … 業務データ（jobs / candidates / proposals / scouts / applications / companies 等）'));
children.push(bullet('lms … 学習管理データ'));
children.push(note('重要: 3システムは同じDBを見ているため、LP で登録すると dx の一覧に反映され、dx で送ったスカウトは LP の受信箱に届く双方向連携が成立しています。'));

// 2. アカウントと権限
children.push(h1('2. アカウントと権限（RBAC）'));
children.push(p('dx のアクセス権は enger.app_users の role で決まります。'));
children.push(table([1500, 2600, 5260],
  ['role', '誰', '見える画面'],
  [
    ['admin', '経営・管理者', '全機能＋経営ダッシュボード（KGI/KPI）、日報管理（カレンダー）、選考全体'],
    ['agent', '営業エージェント・一般職', '営業職能あり→人材/案件/提案/選考。職能なし→業務ホーム'],
    ['client', '求人企業', '企業ポータルのみ（緑テーマ）：自社案件・おすすめ人材・選考・企業プロフィール'],
  ]));
children.push(h2('ログイン方法'));
children.push(bullet('LP（エンジニア）: GitHub / Google / メール（マジックリンク）。新規登録は規約・プライバシー同意が必須。'));
children.push(bullet('dx（社内・企業）: ログイン画面から。Google ログインは同意チェック後に有効化。'));

// 3. dx メニュー
children.push(h1('3. dx 管理画面（dx.enger.jp）メニュー別ガイド'));
children.push(table([2400, 2400, 4560],
  ['ルート', '画面名', '用途'],
  [
    ['/', 'ホーム', 'role別出し分け。admin は経営ダッシュボード＋人材リクエスト'],
    ['/engineers', 'エンジャー登録', 'LP登録者一覧・対応履歴・スカウト・応募ステージ・ポートフォリオ'],
    ['/people', '人材', 'candidates（CSV由来）一覧・詳細'],
    ['/jobs', '案件', 'enger.jobs 一覧（決まりやすい順）'],
    ['/matching', 'マッチング', '案件×人材のマッチング'],
    ['/proposals', '提案', '提案・進捗（ステージ管理）'],
    ['/pipeline', 'パイプライン', '営業パイプライン'],
    ['/meetings', '面談', '面談管理・フォローアップ'],
    ['/progress', '稼働', 'engagements（成約後の稼働管理）'],
    ['/companies', '企業', '企業マスタ'],
    ['/reports', '日報', 'admin:提出カレンダー＋レビュー / 一般職:日報フォーム'],
    ['/inbox', '受信箱', 'LPお問い合わせ（contact_messages）が届く'],
    ['/notifications', '通知', '役割別フィルタ通知'],
    ['/analytics', '分析', '各種統計'],
    ['/billing', '請求', '請求管理'],
    ['/portal/jobs', '自社案件', '企業が案件掲載（管理者承認制）'],
    ['/portal/candidates', 'おすすめ人材', '匿名化マッチ人材（氏名/連絡先は非開示）'],
    ['/portal/selection', '選考管理', '企業側の選考状況'],
    ['/portal/company', '企業プロフィール', 'Mission等。HP URLでAI自動記入'],
  ]));
children.push(h2('admin 経営ダッシュボード'));
children.push(p('「エンジニアが増える → 企業がスカウトする → 売上が上がる」の仕組み化を可視化します。'));
children.push(bullet('成長ファネル: 登録エンジニア → スカウト → 応募 → 面談合格 → 稼働（転換率%）'));
children.push(bullet('登録KPI: エンジニア総数/30日/GitHub連携、企業総数/30日、公開案件数、進行中応募'));
children.push(bullet('エージェント別実績: 提案・スカウト・面談・成約の担当者別集計'));

// 4. LP
children.push(h1('4. LP（enger.jp）エンジニア向け機能'));
children.push(table([2000, 2200, 5160],
  ['ルート', '画面', '機能'],
  [
    ['/signup', '新規登録', '同意フロー。?ref= で紹介コード保持'],
    ['/dashboard', 'ダッシュボード', '市場価値（skills3件以上）・おすすめ案件・スカウト・紹介・応募状況・Xシェア'],
    ['/profile', 'プロフィール編集', 'スキル・希望単価・ポートフォリオ・スキルシート・Qiita連携'],
    ['/jobs', '案件を探す', 'おすすめ順で上位20件・企業名非表示・検索/お気に入り/応募/詳細'],
    ['/scout', 'スカウト受信箱', '営業からのスカウト確認・返信'],
    ['/card', '市場価値シェアカード', 'SNSシェア用（動的OGP）'],
    ['/skills/*', 'スキル別SEO', '集客用'],
    ['/terms 他', '法務ページ', '規約・エンジニア規約・プライバシー・特商法'],
  ]));
children.push(h2('スキル解析の仕組み'));
children.push(bullet('GitHub: 言語/リポジトリ/スター実績から推定（analyzeGithubUser）'));
children.push(bullet('Qiita: ユーザー名から公開APIで記事タグ集計（analyzeQiitaUser）。GitHubと併用'));
children.push(bullet('推定単価（estimatePay）: skills 3件以上のみ表示。FLOOR=45万でガード'));

// 5. 連携フロー
children.push(h1('5. 連携フロー（双方向マッチング）'));
children.push(table([2600, 3200, 3560],
  ['エンジニア(LP)', '中央Supabase', '営業/企業(dx)'],
  [
    ['登録/プロフィール充実', 'public.profiles', '/engineers で閲覧'],
    ['案件を探す/応募', 'enger.applications', '/portal/selection・ステージ管理'],
    ['スカウト受信/返信', 'enger.scouts', '/engineers でスカウト送信'],
    ['案件マッチ(/jobs)', 'enger.jobs', '企業掲載→管理者承認'],
    ['—', 'candidates+profiles', '/portal/candidates（匿名表示）'],
  ]));
children.push(h2('応募ステージ追跡'));
children.push(p('enger.applications の stage で profiles.id（engineer_id）単位に追跡: 応募 → 書類選考 → 面談 → 面談合格 → 稼働 / 見送り'));
children.push(bullet('LP /dashboard でエンジニアに応募状況を表示'));
children.push(bullet('紹介経由の成約（稼働）数は referred_by × stage=稼働 でカウント'));

// 6. 運用作業手順
children.push(h1('6. 運用作業手順'));
children.push(h2('6-1. SQL（DBマイグレーション）の適用'));
children.push(numbered('Supabase ダッシュボード → SQL Editor を開く'));
children.push(numbered('該当の .sql ファイル内容を貼り付けて Run'));
children.push(numbered('すべて冪等。「Success. No rows returned」が正常'));
children.push(numbered('enger を新規参照する場合 Settings→API→Exposed schemas に enger があること'));
children.push(h2('6-2. デプロイ（git push）'));
children.push(p('LP（ローカルブランチが favicon-ogp のため）:', { bold: true }));
children.push(p('cd "...\\enger-lp" && git push origin HEAD:main', { font: 'Consolas', color: BLUE }));
children.push(p('dx:', { bold: true }));
children.push(p('cd "...\\enger-matching" && git push origin main', { font: 'Consolas', color: BLUE }));
children.push(note('Vercel の「Redeploy」は使わない（古いコミットを再ビルドするため）。新しい変更は必ず git push で反映。'));
children.push(h2('6-3. 環境変数'));
children.push(bullet('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY（LP）, NEXT_PUBLIC_*（dx）'));
children.push(bullet('SUPABASE_SERVICE_ROLE_KEY（サーバー専用・絶対に公開しない）'));
children.push(bullet('APIキーは決してコミット・貼り付けしない。Google client secret は再生成しない。'));

// 7. SQL 一覧
children.push(h1('7. SQL ファイル一覧'));
children.push(h2('dx（enger-matching/supabase/）'));
children.push(table([3200, 6160],
  ['ファイル', '内容'],
  [
    ['schema-matching.sql', 'enger コア（companies/candidates/proposals/engagements）'],
    ['accounts / account-functions / sales-roles', 'アカウント・職能・営業ロール'],
    ['staff / daily-reports', 'スタッフ・日報'],
    ['scouts', 'スカウト'],
    ['applications-favorites / applications-stage', '応募・お気に入り・ステージ'],
    ['client-jobs / company-profiles / talent-interest', '企業案件・プロフィール・人材興味'],
    ['contact-messages', 'お問い合わせ受信箱'],
    ['engineer-actions', '対応履歴'],
    ['meetings / engagement-ops / proposals-ops', '面談・稼働・提案運用'],
    ['stats-rpc / notifications / quality 他', '統計RPC・通知・品質・補助列'],
  ]));
children.push(h2('LP（enger-lp/supabase/）'));
children.push(table([3200, 6160],
  ['ファイル', '内容'],
  [
    ['schema.sql', '基本（profiles 等）'],
    ['profiles-manual.sql', 'headline 追加'],
    ['profiles-portfolio.sql', 'portfolio_url / skill_sheet ＋ storage バケット skillsheets'],
    ['referrals.sql', 'referral_code / referred_by（紹介機能）'],
    ['profiles-qiita.sql', 'qiita_id 追加'],
  ]));

// 8. 成長・PR
children.push(h1('8. 成長・PR 施策'));
children.push(bullet('市場価値シェアカード（/card, /dashboard）: 推定単価を画像化しXでシェア→集客'));
children.push(bullet('動的OGP（/og/card.png.ts）: @vercel/og で数値を焼き込み（円は ¥620,000 形式）'));
children.push(bullet('紹介機能: 招待リンク（?ref=）＋報酬ティア。有効な紹介のみカウント（github_id か skills3件以上）'));
children.push(bullet('SEO: スキル別ページ（/skills/*）＋動的 sitemap.xml'));

// 9. 法務
children.push(h1('9. 法務・コンプライアンス'));
children.push(bullet('保有許認可: 有料職業紹介 13-ユ-306955号 / 労働者派遣 般13-305865号。SES（準委任）対応'));
children.push(bullet('会社情報: 設立 2004年11月1日 / 資本金 3,000万円'));
children.push(bullet('法務ページ: 企業規約・エンジニア規約・プライバシー・特商法'));
children.push(bullet('個人情報保護: 登録時に「求人企業への情報共有」の同意フロー実装'));
children.push(bullet('企業への人材表示は必ず匿名化（イニシャル・スキル・単価のみ。氏名/連絡先は非開示）'));
children.push(note('法的判断は専門家確認が必要です。招待報酬の職安法上の扱い・手数料規制等は弁護士レビュー推奨（本書は法的助言ではありません）。'));

// 10. トラブルシューティング
children.push(h1('10. トラブルシューティング'));
children.push(table([3000, 3000, 3360],
  ['症状', '原因', '対処'],
  [
    ['LPの変更が反映されない', 'push漏れ', 'git push origin HEAD:main'],
    ['Vercelが古いコミットをデプロイ', 'Redeployボタン使用', 'git push で新コミット送信'],
    ['「This page couldn\'t load」', '"use server"からconst export', '非関数constはクライアント側で定義'],
    ['Googleログインにsupabase.co表示', '認証先がSupabaseドメイン', '実害なし。Custom Domainで auth.enger.jp 化可'],
    ['薄いプロフィールで高額表示', '推定ロジック', 'skills3件以上にゲート済（FLOOR45万）'],
    ['案件詳細に業務内容が出ない', 'detail/work_location列が空', 'CSV取り込み時に列を埋める'],
    ['メールログインできない', 'プロフィール未充実', '3方式いずれもログイン可。プロフィール編集で充実'],
  ]));

// 11. 鉄則
children.push(h1('11. セキュリティ・運用上の鉄則'));
children.push(numbered('APIキー・サービスロールキーは絶対にコミット/貼り付けしない'));
children.push(numbered('main への push は運営本人が実施（LP: HEAD:main / dx: main）'));
children.push(numbered('企業に見せる人材情報は必ず匿名化'));
children.push(numbered('SQL適用後は必ず動作確認（Successメッセージ→画面反映）'));
children.push(numbered('ユーザーの個人情報を不必要に列挙・出力しない'));

const doc = new Document({
  creator: 'ENGER',
  title: 'ENGER 運営・管理者マニュアル',
  styles: {
    default: { document: { run: { font: JP, size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: JP, color: NAVY },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } } } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 25, bold: true, font: JP, color: BLUE },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
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
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'ENGER 運営・管理者マニュアル', size: 16, color: '999999' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '', size: 16, color: '999999' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '999999' })] })] }) },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(path.join(__dirname, 'ENGER運営マニュアル.docx'), buf);
  console.log('WROTE ENGER運営マニュアル.docx', buf.length, 'bytes');
});
