/**
 * 抽出精度テスト用ハーネス（フェーズ1）
 * ─────────────────────────────────────────────────────────────
 * 目的:
 *   Gmail の実メールから「分類・スキル・単価・職種・リモート・氏名/客」を
 *   どれだけ正確に抽出できるかを、人手で採点するためのレビュー用シートを自動生成する。
 *   「そもそも GAS のやり方が正しいか」を数値で確かめるためのテスト。
 *
 * このプロジェクトへの入れ方:
 *   - 1ファイル追加するだけでOK。ただし GAS は全 .gs が同じグローバル名前空間を共有するため、
 *     既存ファイル（Config.gs / Utils.gs 等）との衝突を避けて、本ファイルの名前は全て EE_ で始める。
 *
 * 2つのテストモード（EE_CFG.useExistingPipeline で切替）:
 *   (A) false … 本ファイル内蔵の Gemini 抽出を使う ＝「改善版（最新メールは決定的取得 / 分類+抽出を1回 / スキル正規化）」を検証
 *   (B) true  … あなたの既存サービス（MessageClassifier / JobExtractionService / WorkerExtractionService 等）を使う ＝「現行版」を検証
 *               → EE_extractWithExistingPipeline() の中身を既存関数の呼び出しに差し替える（下部の TODO 参照）
 *   両方を別シートに出して並べれば「現行 vs 改善」の比較になる。
 *
 * 使い方:
 *   1. プロジェクトの設定 → スクリプト プロパティ に登録
 *        GEMINI_API_KEY = （Gemini API キー）         ← モード(A)で必須
 *        GEMINI_MODEL   = gemini-2.0-flash 等           ← 任意
 *        SAMPLE_QUERY   = Gmail検索クエリ（例: label:配信 newer_than:60d） ← 任意
 *        SAMPLE_SIZE    = サンプル件数                  ← 任意（既定 40。6分制限内に収めるため 60 以下推奨）
 *   2. 関数 EE_buildReviewSheet を実行 → 「抽出レビュー」シート生成
 *   3. 各行の「採点:〇〇」列を 正 / 誤 / 欠落 で埋める（プルダウン）
 *        正  = 抽出が正しい / 誤 = 抽出はあるが間違い / 欠落 = 本文にあるのに取れていない
 *        （本文に元々無い項目は空のままでOK）
 *   4. 関数 EE_summarizeReview を実行 → 「集計」シートに項目別の正答率
 */

const EE_CFG = (() => {
  const p = PropertiesService.getScriptProperties();
  return {
    useExistingPipeline: false, // ← true にすると既存サービスでテスト（下部 EE_extractWithExistingPipeline を要編集）
    apiKey: p.getProperty('GEMINI_API_KEY') || '',
    model: p.getProperty('GEMINI_MODEL') || 'gemini-2.0-flash',
    query: p.getProperty('SAMPLE_QUERY') || 'newer_than:30d',
    sampleSize: Number(p.getProperty('SAMPLE_SIZE') || 40),
    bodyLimit: 6000, // モデルへ渡す本文の最大文字数
    bodyShow: 1500,  // シートに表示する本文の先頭文字数（全文は「リンク」列から確認）
  };
})();

const EE_REVIEW_SHEET = '抽出レビュー';
const EE_SUMMARY_SHEET = '集計';
const EE_SCORE_FIELDS = ['分類', 'スキル', '単価', '職種', 'リモート', '氏名/クライアント'];

// ───────────────────────── メイン: レビューシート生成 ─────────────────────────
function EE_buildReviewSheet() {
  if (!EE_CFG.useExistingPipeline && !EE_CFG.apiKey) {
    throw new Error('スクリプト プロパティ GEMINI_API_KEY が未設定です。設定 → スクリプト プロパティ から登録してください。');
  }

  const threads = GmailApp.search(EE_CFG.query, 0, EE_CFG.sampleSize);
  if (!threads.length) {
    throw new Error('対象メールが0件でした。SAMPLE_QUERY を見直してください（例: label:配信 newer_than:60d）。');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(EE_REVIEW_SHEET);
  if (sh) sh.clear(); else sh = ss.insertSheet(EE_REVIEW_SHEET);

  const header = [
    'No', '日付', '差出人', '件名', 'リンク', 'メール本文(先頭)',
    '抽出:分類', '抽出:スキル', '抽出:単価', '抽出:職種', '抽出:リモート', '抽出:氏名/クライアント',
    ...EE_SCORE_FIELDS.map((f) => '採点:' + f),
    'メモ',
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);

  const rows = [];
  threads.forEach((th, i) => {
    const msgs = th.getMessages();
    const m = msgs[msgs.length - 1]; // スレッド内の最新メール（決定的に取得）
    const subject = m.getSubject() || '';
    const fullBody = (m.getPlainBody() || '').slice(0, EE_CFG.bodyLimit);

    let ex, err = '';
    try {
      ex = EE_CFG.useExistingPipeline
        ? EE_extractWithExistingPipeline(subject, fullBody, m)
        : EE_extractStandalone(subject, fullBody);
    } catch (e) {
      ex = { category: 'ERROR', skills: [], salary_min: null, salary_max: null, role: '', remote: '', name: '' };
      err = String(e).slice(0, 300);
    }
    if (!EE_CFG.useExistingPipeline) Utilities.sleep(400); // レート制御

    rows.push([
      i + 1,
      Utilities.formatDate(m.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      m.getFrom(),
      subject,
      th.getPermalink(),
      fullBody.slice(0, EE_CFG.bodyShow),
      ex.category || '',
      (ex.skills || []).join(' / '),
      EE_salaryText(ex),
      ex.role || '',
      ex.remote || '',
      ex.name || '',
      '', '', '', '', '', '', // 採点列（人が埋める）
      err,
    ]);
  });

  sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  const firstScoreCol = header.indexOf('採点:' + EE_SCORE_FIELDS[0]) + 1;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['正', '誤', '欠落'], true).setAllowInvalid(false).build();
  sh.getRange(2, firstScoreCol, rows.length, EE_SCORE_FIELDS.length).setDataValidation(rule);

  sh.setColumnWidth(6, 460);
  sh.getRange(2, 6, rows.length, 1).setWrap(true);
  sh.autoResizeColumns(1, 4);

  SpreadsheetApp.getActiveSpreadsheet()
    .toast(rows.length + ' 件を「' + EE_REVIEW_SHEET + '」に出力しました。採点列（正/誤/欠落）を埋めてください。', '完了', 8);
}

// ───────────────── モード(A): 内蔵 Gemini 抽出（分類 + 項目を1回で / スキル正規化） ─────────────────
function EE_extractStandalone(subject, body) {
  const prompt = [
    'あなたはSES業界のメール解析器です。次のメールを解析し、指定スキーマのJSONのみを返してください（説明・コードフェンス不要）。',
    '',
    '# 手順',
    '1) このメールを「案件」「人材」「その他」のいずれかに分類する。',
    '   - 案件 = 開発案件・募集（クライアントが人を探している）',
    '   - 人材 = エンジニア・要員の紹介（人を提案している）',
    '   - その他 = 上記以外（挨拶・事務連絡・無関係など）',
    '2) 案件 or 人材なら、以下の項目を抽出する。本文に無い項目は null（skills は空配列）。',
    '',
    '# スキル正規化ルール（重要）',
    '   skills は小文字の正規形に統一する。例:',
    '   React/React.js→"react", TypeScript/TS→"typescript", Node.js→"node", JavaScript→"javascript",',
    '   AWS→"aws", GCP→"googlecloud", Azure→"azure", Java→"java", Go/Golang→"go", Python→"python",',
    '   PHP→"php", Ruby→"ruby", Ruby on Rails→"rails", Vue.js→"vue", Next.js→"next",',
    '   Kubernetes/k8s→"kubernetes", PostgreSQL→"postgresql", C#→"c#".',
    '   一覧に無い技術はそのまま小文字化して入れる。',
    '',
    '# 出力スキーマ（このJSONだけを出力）',
    '{',
    '  "category": "案件" | "人材" | "その他",',
    '  "skills": string[],',
    '  "salary_min": number | null,   // 万円・月額前提。"60万"→60、"60〜80万"→min 60',
    '  "salary_max": number | null,',
    '  "role": string,                // 職種（例: フロントエンド / バックエンド / インフラ / PM）。不明は ""',
    '  "remote": "full_remote" | "partial_remote" | "onsite" | null,',
    '  "name": string                 // 人材なら氏名、案件ならクライアント名。不明は ""',
    '}',
    '',
    '# メール',
    '件名: ' + subject,
    '本文:',
    body,
  ].join('\n');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + encodeURIComponent(EE_CFG.model) + ':generateContent?key=' + encodeURIComponent(EE_CFG.apiKey);
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Gemini HTTP ' + code + ': ' + res.getContentText().slice(0, 200));

  const data = JSON.parse(res.getContentText());
  const parts = (((data.candidates || [])[0] || {}).content || {}).parts;
  const joined = (parts || []).map((p) => p.text || '').join('').trim();
  let obj;
  try { obj = JSON.parse(joined); }
  catch (e) { throw new Error('JSON解析失敗: ' + joined.slice(0, 200)); }

  return EE_normalize(obj);
}

// ───────────────── モード(B): 既存パイプラインで抽出 ─────────────────
// ★★ ここを、あなたの既存サービスの呼び出しに差し替えてください ★★
//   例（実際の関数名・引数・戻り値はあなたのコードに合わせて調整）:
//     const cls = MessageClassifier.classify(subject, body);        // → '案件' / '人材' / 'その他'
//     if (cls === '案件') {
//       const j = JobExtractionService.extract(subject, body);      // 既存の案件抽出
//       return EE_normalize({ category: '案件', skills: j.skills, salary_min: j.salaryMin,
//                             salary_max: j.salaryMax, role: j.role, remote: j.remote, name: j.client });
//     }
//     if (cls === '人材') {
//       const w = WorkerExtractionService.extract(subject, body);   // 既存の人材抽出
//       return EE_normalize({ category: '人材', skills: w.skills, salary_min: w.rateMin,
//                             salary_max: w.rateMax, role: w.title, remote: w.remotePref, name: w.name });
//     }
//     return EE_normalize({ category: 'その他' });
function EE_extractWithExistingPipeline(subject, body, message) {
  throw new Error('モード(B)は未配線です。EE_extractWithExistingPipeline() の中身を既存サービスの呼び出しに差し替えてください。');
}

// 抽出結果を採点シート用の共通フォーマットへ寄せる
function EE_normalize(obj) {
  obj = obj || {};
  return {
    category: obj.category || 'その他',
    skills: Array.isArray(obj.skills) ? obj.skills : [],
    salary_min: EE_numOrNull(obj.salary_min),
    salary_max: EE_numOrNull(obj.salary_max),
    role: obj.role || '',
    remote: obj.remote || '',
    name: obj.name || '',
  };
}

function EE_numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function EE_salaryText(ex) {
  if (ex.salary_min == null && ex.salary_max == null) return '';
  if (ex.salary_min != null && ex.salary_max != null) return ex.salary_min + '〜' + ex.salary_max + '万';
  return (ex.salary_min != null ? ex.salary_min : ex.salary_max) + '万';
}

// ───────────────────────── 集計: 項目別の正答率 ─────────────────────────
function EE_summarizeReview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(EE_REVIEW_SHEET);
  if (!sh) throw new Error('「' + EE_REVIEW_SHEET + '」シートがありません。先に EE_buildReviewSheet を実行してください。');

  const values = sh.getDataRange().getValues();
  const header = values[0];
  const dataRows = values.slice(1);

  const out = [['項目', '正', '誤', '欠落', '採点済み', '正答率']];
  EE_SCORE_FIELDS.forEach((f) => {
    const col = header.indexOf('採点:' + f);
    let ok = 0, ng = 0, miss = 0;
    dataRows.forEach((r) => {
      const v = String(r[col] || '').trim();
      if (v === '正') ok++;
      else if (v === '誤') ng++;
      else if (v === '欠落') miss++;
    });
    const scored = ok + ng + miss;
    const acc = scored ? Math.round((ok / scored) * 1000) / 10 : 0;
    out.push([f, ok, ng, miss, scored, scored ? acc + '%' : '—']);
  });

  let sum = ss.getSheetByName(EE_SUMMARY_SHEET);
  if (sum) sum.clear(); else sum = ss.insertSheet(EE_SUMMARY_SHEET);
  sum.getRange(1, 1, out.length, out[0].length).setValues(out);
  sum.getRange(1, 1, 1, out[0].length).setFontWeight('bold');
  sum.autoResizeColumns(1, out[0].length);

  SpreadsheetApp.getActiveSpreadsheet().toast('集計を「' + EE_SUMMARY_SHEET + '」に出力しました。', '完了', 6);
}
