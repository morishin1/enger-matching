/**
 * 抽出精度テスト用ハーネス（フェーズ1）
 * ─────────────────────────────────────────────────────────────
 * 目的:
 *   Gmail の実メールから Gemini が「分類・スキル・単価・職種・リモート・氏名/客」を
 *   どれだけ正確に抽出できるかを、人手で採点するためのレビュー用シートを自動生成する。
 *   これは「そもそも GAS のやり方が正しいか」を数値で確かめるためのテスト。
 *
 * 使い方:
 *   1. このファイルを GAS プロジェクトに貼り付け（スプレッドシートに紐づくスクリプトとして）
 *   2. プロジェクトの設定 → スクリプト プロパティ に登録
 *        GEMINI_API_KEY = （あなたの Gemini API キー）            ← 必須
 *        GEMINI_MODEL   = gemini-2.0-flash 等                       ← 任意（未設定なら既定値）
 *        SAMPLE_QUERY   = Gmail検索クエリ（例: label:配信 newer_than:60d） ← 任意
 *        SAMPLE_SIZE    = サンプル件数                              ← 任意（既定 40。6分制限内に収めるため 60 以下推奨）
 *   3. 関数 buildReviewSheet を実行 → 「抽出レビュー」シートが生成される
 *   4. 各行の「採点:〇〇」列を 正 / 誤 / 欠落 で埋める（プルダウン）
 *        正  = 抽出が正しい
 *        誤  = 抽出はあるが間違い
 *        欠落 = 本文に情報があるのに抽出できていない（本文に元々無い項目は空のままでOK）
 *   5. 関数 summarizeReview を実行 → 「集計」シートに項目別の正答率が出る
 *
 * 設計メモ:
 *   - スレッド内の最新メールは GmailApp で決定的に取得（LLM呼び出し不要 ＝ 現行の3回目を削減）
 *   - 分類と項目抽出は 1 回の Gemini 呼び出しに統合（JSON出力）
 *   - スキルは抽出時に統制語彙へ正規化（react / typescript / aws ...）
 *   ★ 既存の抽出ロジックでテストしたい場合は extractFromEmail() の中身を差し替える
 */

const CFG = (() => {
  const p = PropertiesService.getScriptProperties();
  return {
    apiKey: p.getProperty('GEMINI_API_KEY') || '',
    model: p.getProperty('GEMINI_MODEL') || 'gemini-2.0-flash',
    query: p.getProperty('SAMPLE_QUERY') || 'newer_than:30d',
    sampleSize: Number(p.getProperty('SAMPLE_SIZE') || 40),
    bodyLimit: 6000,   // モデルへ渡す本文の最大文字数
    bodyShow: 1500,    // シートに表示する本文の先頭文字数（全文は「リンク」から確認）
  };
})();

const REVIEW_SHEET = '抽出レビュー';
const SUMMARY_SHEET = '集計';

// 採点対象の項目（プルダウンを置く列。順序どおりに連続配置される）
const SCORE_FIELDS = ['分類', 'スキル', '単価', '職種', 'リモート', '氏名/クライアント'];

// ───────────────────────── メイン: レビューシート生成 ─────────────────────────
function buildReviewSheet() {
  if (!CFG.apiKey) {
    throw new Error('スクリプト プロパティ GEMINI_API_KEY が未設定です。プロジェクトの設定 → スクリプト プロパティ から登録してください。');
  }

  const threads = GmailApp.search(CFG.query, 0, CFG.sampleSize);
  if (!threads.length) {
    throw new Error('対象メールが0件でした。SAMPLE_QUERY を見直してください（例: label:配信 newer_than:60d）。');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(REVIEW_SHEET);
  if (sh) sh.clear(); else sh = ss.insertSheet(REVIEW_SHEET);

  const header = [
    'No', '日付', '差出人', '件名', 'リンク', 'メール本文(先頭)',
    '抽出:分類', '抽出:スキル', '抽出:単価', '抽出:職種', '抽出:リモート', '抽出:氏名/クライアント',
    ...SCORE_FIELDS.map((f) => '採点:' + f),
    'メモ',
  ];
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  sh.setFrozenRows(1);

  const rows = [];
  threads.forEach((th, i) => {
    const msgs = th.getMessages();
    const m = msgs[msgs.length - 1]; // スレッド内の最新メール（決定的に取得）
    const subject = m.getSubject() || '';
    const fullBody = (m.getPlainBody() || '').slice(0, CFG.bodyLimit);

    let ex, err = '';
    try {
      ex = extractFromEmail(subject, fullBody);
    } catch (e) {
      ex = { category: 'ERROR', skills: [], salary_min: null, salary_max: null, role: '', remote: '', name: '' };
      err = String(e).slice(0, 300);
    }
    Utilities.sleep(400); // レート制御

    rows.push([
      i + 1,
      Utilities.formatDate(m.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      m.getFrom(),
      subject,
      th.getPermalink(),
      fullBody.slice(0, CFG.bodyShow),
      ex.category || '',
      (ex.skills || []).join(' / '),
      salaryText(ex),
      ex.role || '',
      ex.remote || '',
      ex.name || '',
      '', '', '', '', '', '',  // 採点列（人が埋める）
      err,
    ]);
  });

  sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  // 採点列に 正/誤/欠落 のプルダウンを設定
  const firstScoreCol = header.indexOf('採点:' + SCORE_FIELDS[0]) + 1;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['正', '誤', '欠落'], true).setAllowInvalid(false).build();
  sh.getRange(2, firstScoreCol, rows.length, SCORE_FIELDS.length).setDataValidation(rule);

  // 体裁
  sh.setColumnWidth(6, 460);                       // 本文列
  sh.getRange(2, 6, rows.length, 1).setWrap(true);
  sh.autoResizeColumns(1, 4);

  SpreadsheetApp.getActiveSpreadsheet()
    .toast(rows.length + ' 件を「' + REVIEW_SHEET + '」に出力しました。採点列（正/誤/欠落）を埋めてください。', '完了', 8);
}

// ───────────────────────── Gemini 抽出（分類 + 項目を1回で） ─────────────────────────
// ★ 既存の抽出ロジックでテストしたい場合は、この関数の中身を既存関数の呼び出しに差し替える。
//   戻り値の形（{category, skills[], salary_min, salary_max, role, remote, name}）だけ合わせればOK。
function extractFromEmail(subject, body) {
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
    + encodeURIComponent(CFG.model) + ':generateContent?key=' + encodeURIComponent(CFG.apiKey);
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
  const text = (((data.candidates || [])[0] || {}).content || {}).parts;
  const joined = (text || []).map((p) => p.text || '').join('').trim();
  let obj;
  try { obj = JSON.parse(joined); }
  catch (e) { throw new Error('JSON解析失敗: ' + joined.slice(0, 200)); }

  return {
    category: obj.category || 'その他',
    skills: Array.isArray(obj.skills) ? obj.skills : [],
    salary_min: numOrNull(obj.salary_min),
    salary_max: numOrNull(obj.salary_max),
    role: obj.role || '',
    remote: obj.remote || '',
    name: obj.name || '',
  };
}

function numOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function salaryText(ex) {
  if (ex.salary_min == null && ex.salary_max == null) return '';
  if (ex.salary_min != null && ex.salary_max != null) return ex.salary_min + '〜' + ex.salary_max + '万';
  return (ex.salary_min != null ? ex.salary_min : ex.salary_max) + '万';
}

// ───────────────────────── 集計: 項目別の正答率 ─────────────────────────
function summarizeReview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(REVIEW_SHEET);
  if (!sh) throw new Error('「' + REVIEW_SHEET + '」シートがありません。先に buildReviewSheet を実行してください。');

  const values = sh.getDataRange().getValues();
  const header = values[0];
  const dataRows = values.slice(1);

  const out = [['項目', '正', '誤', '欠落', '採点済み', '正答率']];
  SCORE_FIELDS.forEach((f) => {
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

  let sum = ss.getSheetByName(SUMMARY_SHEET);
  if (sum) sum.clear(); else sum = ss.insertSheet(SUMMARY_SHEET);
  sum.getRange(1, 1, out.length, out[0].length).setValues(out);
  sum.getRange(1, 1, 1, out[0].length).setFontWeight('bold');
  sum.autoResizeColumns(1, out[0].length);

  SpreadsheetApp.getActiveSpreadsheet().toast('集計を「' + SUMMARY_SHEET + '」に出力しました。', '完了', 6);
}
