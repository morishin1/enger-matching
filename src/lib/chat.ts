import { unstable_cache } from "next/cache";
import { engerClient, engerAdmin, publicAdmin, authAdmin, dbConfigured } from "@/lib/supabase";

export type ChatRole = "company" | "freelance" | "agent";

/** チャット読み取り用クライアント。
 *  社内(dx)の閲覧は service role を優先し、未設定時のみ anon にフォールバックする。
 *  ※ anon は RLS の select ポリシー（chat.sql の `using (true)`）が本番に適用されていないと
 *    0件になり「ENGERフリーランスのチャットが見えない」事故になる。サーバ専用関数なので
 *    service role で確実に読む（proposal_memos の取得と同じ方針）。 */
function chatReader() {
  try { return engerAdmin(); } catch { return engerClient(); }
}

export type ChatThread = {
  id: string;
  scout_id: string | null;
  engineer_id: string;
  engineer_name: string | null;
  engineer_initials: string | null; // 表示用イニシャル（姓名から導出）
  company: string | null;
  company_email: string | null;
  agent: string | null;
  job_no: number | null;
  job_title: string | null;
  subject: string | null;
  status: string;
  memo: string | null;            // 担当者の手入力メモ
  last_message_at: string;
  created_at: string;
};

// 日本語（ひらがな/カタカナ/漢字）を含むか。Google等のローマ字表示名と区別するために使う。
const JA_RE = /[\u3041-\u30ff\u3400-\u9fff\uf900-\ufaff\uff66-\uff9f\u3005\u3006]/;
const hasJa = (s?: string | null) => JA_RE.test(String(s ?? ""));

// プロフィールのスキーマ差異を吸収するため、氏名・フリガナ・イニシャルの候補キーを順に探す。
//   （外部連携で列名が異なる/未登録のケースに対応。select("*") で全列を取得して JS 側で吸収する。）
const NAME_KEYS = ["name_kanji", "kanji_name", "kanji", "real_name", "full_name", "fullname", "氏名", "name", "display_name"];
// 漢字専用の姓/名カラム（last_name_kanji 等）を最優先で拾う。ローマ字の last_name 等しか無い場合のみ
// それらにフォールバックする（順序が優先順位）。enger-lp の登録フォームは *_kanji に保存する。
const SEI_KEYS = ["last_name_kanji", "lastname_kanji", "family_name_kanji", "sei_kanji", "last_name", "family_name", "name_sei", "sei", "lastname", "姓"];
const MEI_KEYS = ["first_name_kanji", "firstname_kanji", "given_name_kanji", "mei_kanji", "first_name", "given_name", "name_mei", "mei", "firstname", "名"];
const KANA_KEYS = ["furigana", "name_kana", "kana", "yomi", "yomigana", "ruby", "kana_name", "name_ruby", "ruby_name", "name_furigana", "furigana_name", "phonetic", "name_phonetic", "フリガナ", "ふりがな"];
const KANA_SEI_KEYS = ["last_name_furigana", "lastname_furigana", "family_name_furigana", "last_furigana", "kana_sei", "sei_kana", "furigana_sei", "sei_furigana", "last_name_kana", "lastname_kana", "family_name_kana", "family_kana", "last_kana"];
const KANA_MEI_KEYS = ["first_name_furigana", "firstname_furigana", "given_name_furigana", "first_furigana", "kana_mei", "mei_kana", "furigana_mei", "mei_furigana", "first_name_kana", "firstname_kana", "given_name_kana", "given_kana", "first_kana"];
// 自動生成イニシャル（initial_auto 等）を最優先で拾う。
const INITIAL_KEYS = ["initial_auto", "initials_auto", "auto_initial", "auto_initials", "initials", "initial", "name_initials", "name_initial", "initial_name", "イニシャル"];

const pick = (row: any, keys: string[]): string => {
  for (const k of keys) { const v = row?.[k]; if (v != null && String(v).trim()) return String(v).trim(); }
  return "";
};
const joinName = (a: string, b: string) => [a, b].filter(Boolean).join(" ").trim();

// カタカナ/ひらがなの先頭1文字からローマ字イニシャル（例「フジモト」→F・「ハルト」→H）。
const KANA_INIT: Record<string, string> = {
  ア: "A", イ: "I", ウ: "U", エ: "E", オ: "O",
  カ: "K", キ: "K", ク: "K", ケ: "K", コ: "K", ガ: "G", ギ: "G", グ: "G", ゲ: "G", ゴ: "G",
  サ: "S", シ: "S", ス: "S", セ: "S", ソ: "S", ザ: "Z", ジ: "J", ズ: "Z", ゼ: "Z", ゾ: "Z",
  タ: "T", チ: "C", ツ: "T", テ: "T", ト: "T", ダ: "D", ヂ: "J", ヅ: "Z", デ: "D", ド: "D",
  ナ: "N", ニ: "N", ヌ: "N", ネ: "N", ノ: "N",
  ハ: "H", ヒ: "H", フ: "F", ヘ: "H", ホ: "H", バ: "B", ビ: "B", ブ: "B", ベ: "B", ボ: "B", パ: "P", ピ: "P", プ: "P", ペ: "P", ポ: "P",
  マ: "M", ミ: "M", ム: "M", メ: "M", モ: "M",
  ヤ: "Y", ユ: "Y", ヨ: "Y",
  ラ: "R", リ: "R", ル: "R", レ: "R", ロ: "R",
  ワ: "W", ヲ: "O", ン: "N",
};
const kanaToInitial = (seg: string): string => {
  let c = (seg || "").trim()[0] ?? "";
  if (!c) return "";
  const code = c.charCodeAt(0);
  if (code >= 0x3041 && code <= 0x3096) c = String.fromCharCode(code + 0x60); // ひらがな→カタカナ
  return KANA_INIT[c] ?? "";
};
const initialsFromKana = (kana: string): string | null => {
  const parts = String(kana ?? "").split(/[\s　・]+/).filter(Boolean);
  const letters = parts.map(kanaToInitial).filter(Boolean);
  return letters.length ? letters.join("") : null;
};

// 姓名からイニシャルを作る（例「藤本 太郎」→「藤本」「Taro Yamada」→「T.Y」）。フリガナ/明示イニシャルが無い時の最終手段。
function initialsOf(name: string | null | undefined): string | null {
  const s = String(name ?? "").trim();
  if (!s) return null;
  // 英字名は各単語の頭文字。日本語名は姓（最初の空白前 or 先頭2文字）。
  if (/^[A-Za-z][A-Za-z.\s'-]*$/.test(s)) {
    const parts = s.split(/\s+/).filter(Boolean);
    return parts.map((p) => p[0]?.toUpperCase()).filter(Boolean).join(".") || null;
  }
  const head = s.split(/\s+|　/)[0] ?? s;
  return head.slice(0, 4);
}

// プロフィール1行から「氏名（漢字優先）」と「イニシャル（プロフィール自動生成→フリガナ→氏名の順）」を導出。
function deriveNameInitials(row: any): { name: string; initials: string | null } {
  // 1) 氏名：姓+名（漢字）を優先。無ければ単一フィールドのうち日本語を含むものを優先し、最後にローマ字表示名へフォールバック。
  const seiMei = joinName(pick(row, SEI_KEYS), pick(row, MEI_KEYS));
  const singles = NAME_KEYS.map((k) => String(row?.[k] ?? "").trim()).filter(Boolean);
  const jaSingle = singles.find(hasJa) ?? "";
  const name = (hasJa(seiMei) ? seiMei : "") || jaSingle || seiMei || singles[0] || "";
  // 2) フリガナ（カナ）：姓カナ+名カナ→単一カナ欄。
  const kana = joinName(pick(row, KANA_SEI_KEYS), pick(row, KANA_MEI_KEYS)) || pick(row, KANA_KEYS);
  // 3) イニシャル：プロフィールの自動生成値→フリガナから→氏名から。
  const initials = pick(row, INITIAL_KEYS) || initialsFromKana(kana) || initialsOf(name);
  return { name, initials: initials || null };
}

export type ResolvedName = { name: string; initials: string | null };

/** engineer_id（profiles.id か email）から ENGERフリーランスの氏名・イニシャルを解決して Map で返す。
 *  外部連携（Google等）でフリガナ未登録/ローマ字のケースでも、漢字氏名やプロフィール自動生成イニシャルを
 *  拾えるよう、profiles の全列を取得して候補キーから吸収する（サーバ専用・対象は表示中スレッドの人材のみ）。 */
async function resolveEngineerNames(ids: string[]): Promise<Map<string, ResolvedName>> {
  const out = new Map<string, ResolvedName>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (uniq.length === 0) return out;
  let pub: ReturnType<typeof publicAdmin>;
  try { pub = publicAdmin(); } catch { return out; }
  const uuidLike = uniq.filter((v) => /^[0-9a-f-]{32,36}$/i.test(v));
  const emailLike = uniq.filter((v) => v.includes("@"));
  const put = (key: string | null | undefined, row: any) => {
    if (!key) return;
    const d = deriveNameInitials(row);
    if (d.name) out.set(String(key), d);
  };
  try {
    if (uuidLike.length) {
      // select("*") で列名差異を吸収（未知のフリガナ/イニシャル列も拾う）。失敗時は最小列にフォールバック。
      let r: any = await pub.from("profiles").select("*").in("id", uuidLike);
      if (r.error) r = await pub.from("profiles").select("id, display_name, name").in("id", uuidLike);
      for (const p of (r.data ?? []) as any[]) put(p.id, p);
    }
  } catch { /* noop */ }
  try {
    if (emailLike.length) {
      let r: any = await pub.from("profiles").select("*").in("email", emailLike);
      if (r.error) r = await pub.from("profiles").select("email, display_name, name").in("email", emailLike);
      for (const p of (r.data ?? []) as any[]) put(p.email, p);
    }
  } catch { /* noop */ }
  return out;
}

/** 【①の別アプローチ】public.profiles に登録名が無い（Google表示名しか入っていない）人材向けに、
 *  auth.users の user_metadata から「姓＋名（漢字）」を補完する。
 *  ・フリーランス側のプロフィール編集で 姓名/フリガナ/イニシャル を user_metadata に保存しているケースを拾う。
 *  ・Google の full_name（アカウント名）に倒れないよう、明示の「姓＋名」(SEI/MEI)が日本語の時だけ採用する。
 *  ・admin API は id 単位の取得のため、profiles 解決で日本語氏名が取れなかった id だけを対象に上限付きで照会する。 */
async function augmentNamesFromAuth(map: Map<string, ResolvedName>, ids: string[]): Promise<void> {
  const need = Array.from(new Set(ids.filter((v) => /^[0-9a-f-]{32,36}$/i.test(String(v ?? "")))))
    .filter((id) => !hasJa(map.get(id)?.name ?? "")); // profiles で日本語氏名が取れた人は対象外
  if (need.length === 0) return;
  let auth: ReturnType<typeof authAdmin>;
  try { auth = authAdmin(); } catch { return; }
  const targets = need.slice(0, 60); // 照会上限（一覧で多すぎる往復を避ける）
  await Promise.all(targets.map(async (id) => {
    try {
      const r: any = await auth.auth.admin.getUserById(id);
      const meta = r?.data?.user?.user_metadata ?? null;
      if (!meta) return;
      // 明示の「姓＋名」が日本語の時だけ採用（Google の full_name/name には倒さない）。
      const seiMei = joinName(pick(meta, SEI_KEYS), pick(meta, MEI_KEYS));
      if (!hasJa(seiMei)) return;
      const kana = joinName(pick(meta, KANA_SEI_KEYS), pick(meta, KANA_MEI_KEYS)) || pick(meta, KANA_KEYS);
      const initials = pick(meta, INITIAL_KEYS) || initialsFromKana(kana) || initialsOf(seiMei);
      map.set(id, { name: seiMei, initials: initials || null });
    } catch { /* 個別の照会失敗は無視 */ }
  }));
}

export type EngineerSearchName = { name: string; kana: string; initials: string | null; regInitial: string | null; sei: string; mei: string };

/** 新規スレッドの相手（フリーランス）検索用に、氏名(漢字)・フリガナ(カナ)・イニシャルを id 別に解決。
 *  列名差異（フリガナ/イニシャルの未知列）を吸収するため profiles を select("*") で取得し、
 *  候補キーから氏名・カナ・イニシャルを導出する（サーバ専用・対象は渡された id のみ）。 */
export async function resolveEngineerSearch(ids: string[]): Promise<Map<string, EngineerSearchName>> {
  const out = new Map<string, EngineerSearchName>();
  const uuidLike = Array.from(new Set(ids.filter((v) => /^[0-9a-f-]{32,36}$/i.test(String(v ?? "")))));
  if (uuidLike.length === 0) return out;
  let pub: ReturnType<typeof publicAdmin>;
  try { pub = publicAdmin(); } catch { return out; }
  // 大量 IN を避けるため 200 件ずつに分割して取得。
  for (let i = 0; i < uuidLike.length; i += 200) {
    const chunk = uuidLike.slice(i, i + 200);
    try {
      let r: any = await pub.from("profiles").select("*").in("id", chunk);
      if (r.error) r = await pub.from("profiles").select("id, display_name, name").in("id", chunk);
      for (const p of (r.data ?? []) as any[]) {
        const d = deriveNameInitials(p);
        const kana = joinName(pick(p, KANA_SEI_KEYS), pick(p, KANA_MEI_KEYS)) || pick(p, KANA_KEYS);
        // 「プロフィールに明示登録されたイニシャル」のみ（姓・カナ由来の自動値は含めない）。①で別枠表示する。
        const regInitial = pick(p, INITIAL_KEYS) || null;
        // 姓/名（漢字）を個別に保持（表示名の「姓名（姓）（イニシャル）」整形に使う）。
        const sei = pick(p, SEI_KEYS);
        const mei = pick(p, MEI_KEYS);
        if (p?.id) out.set(String(p.id), { name: d.name, kana, initials: d.initials, regInitial, sei, mei });
      }
    } catch { /* 取得失敗チャンクはスキップ（残りは続行） */ }
  }
  return out;
}

export type EngineerProfileName = { kanji: string; kana: string; initials: string };

/** フリーランス詳細モーダル用：プロフィール登録の「姓名(漢字)」「フリガナ」「イニシャル」を id 別に解決。
 *  ・未入力の項目は空文字（モーダルでは空欄表示）。display_name/ローマ字へはフォールバックしない。
 *  ・列名差異を吸収するため profiles を select("*") で取得し候補キーから導出（サーバ専用・渡された id のみ）。 */
export async function resolveEngineerProfileNames(ids: string[]): Promise<Map<string, EngineerProfileName>> {
  const out = new Map<string, EngineerProfileName>();
  const uuidLike = Array.from(new Set(ids.filter((v) => /^[0-9a-f-]{32,36}$/i.test(String(v ?? "")))));
  if (uuidLike.length === 0) return out;
  let pub: ReturnType<typeof publicAdmin>;
  try { pub = publicAdmin(); } catch { return out; }
  // 1) profiles からライブの 漢字氏名／フリガナ／イニシャル を解決。
  for (let i = 0; i < uuidLike.length; i += 200) {
    const chunk = uuidLike.slice(i, i + 200);
    try {
      const r: any = await pub.from("profiles").select("*").in("id", chunk);
      if (r.error) continue;
      for (const p of (r.data ?? []) as any[]) {
        // 漢字氏名：姓+名（漢字）優先。無ければ単一氏名欄のうち日本語を含むものだけ採用（ローマ字 display_name は除外）。
        const kanji = joinName(pick(p, SEI_KEYS), pick(p, MEI_KEYS))
          || (NAME_KEYS.map((k) => String(p?.[k] ?? "").trim()).find(hasJa) ?? "");
        const kana = joinName(pick(p, KANA_SEI_KEYS), pick(p, KANA_MEI_KEYS)) || pick(p, KANA_KEYS);
        // イニシャル：プロフィール登録値→フリガナから導出。氏名からは生成しない（未登録は空欄のまま）。
        const initials = pick(p, INITIAL_KEYS) || initialsFromKana(kana) || "";
        if (p?.id) out.set(String(p.id), { kanji, kana, initials });
      }
    } catch { /* 取得失敗チャンクはスキップ */ }
  }
  // 2) #241：ログアウト等で profiles の漢字氏名が一時的に空になっても「直近に保存された氏名」を維持する。
  //    ・ライブで日本語の漢字氏名が取れた id → スナップショットを upsert（変更時のみ）＝最後に確認できた氏名を保存。
  //    ・取れなかった id → 保存済みスナップショットがあればそれを表示に採用（人材IDへ化けるのを防ぐ）。
  await applyNameSnapshots(out, uuidLike);
  return out;
}

/** #241：漢字氏名のスナップショット（enger.freelance_name_snapshots）を適用する。
 *  ライブ解決で日本語の漢字氏名が取れた id は最新値を保存（変更時のみ upsert）。取れなかった id は
 *  保存済みの値にフォールバック。テーブル未作成(未マイグレ)等の失敗時は何もしない（従来動作のまま）。
 *  ※ 引数 out をその場で書き換える（フォールバック反映）。 */
async function applyNameSnapshots(out: Map<string, EngineerProfileName>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  let admin: ReturnType<typeof engerAdmin>;
  try { admin = engerAdmin(); } catch { return; }
  // 既存スナップショットを取得（200件ずつ）。テーブル未作成等で失敗したら何もしない。
  const snap = new Map<string, { kanji: string; kana: string; initials: string }>();
  try {
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const r: any = await admin.from("freelance_name_snapshots").select("engineer_id, kanji, kana, initials").in("engineer_id", chunk);
      if (r.error) return; // 未マイグレ等 → フォールバックも保存もしない（従来動作）
      for (const s of (r.data ?? []) as any[]) {
        snap.set(String(s.engineer_id), { kanji: String(s.kanji ?? ""), kana: String(s.kana ?? ""), initials: String(s.initials ?? "") });
      }
    }
  } catch { return; }
  const now = new Date().toISOString();
  const toUpsert: { engineer_id: string; kanji: string; kana: string; initials: string; updated_at: string }[] = [];
  for (const id of ids) {
    const live = out.get(id);
    const liveKanji = (live?.kanji ?? "").trim();
    if (hasJa(liveKanji)) {
      // ライブで日本語氏名が取れた＝現に正しい氏名。スナップショットと差があれば更新（最新を保存）。
      const kana = live?.kana ?? "";
      const initials = live?.initials ?? "";
      const s = snap.get(id);
      if (!s || s.kanji !== liveKanji || s.kana !== kana || s.initials !== initials) {
        toUpsert.push({ engineer_id: id, kanji: liveKanji, kana, initials, updated_at: now });
      }
    } else {
      // ライブで取れない（ログアウト等）→ 保存済みの日本語氏名があれば、それを表示に採用。
      const s = snap.get(id);
      if (s && hasJa(s.kanji)) out.set(id, { kanji: s.kanji, kana: s.kana, initials: s.initials });
    }
  }
  // 変更分のみまとめて保存（人材数ぶんの無駄な書き込みを避ける）。失敗は表示に影響させない。
  if (toUpsert.length) {
    try { await admin.from("freelance_name_snapshots").upsert(toUpsert, { onConflict: "engineer_id" }); } catch { /* noop */ }
  }
}

/** スレッドのスナップショット名と解決名から、表示すべき氏名を選ぶ（漢字＝日本語を最優先）。
 *  外部連携で作成時のスナップショットがローマ字(例「M F」)でも、プロフィールの漢字氏名があればそちらを表示する。 */
function chooseDisplayName(resolved: ResolvedName | undefined, snapshot: string | null | undefined): { name: string | null; initials: string | null } {
  const r = resolved?.name?.trim() ?? "";
  const s = String(snapshot ?? "").trim();
  // 日本語を含む名前を最優先（解決名→スナップショット）。どちらも無ければローマ字を解決名→スナップの順で。
  const name = (hasJa(r) ? r : "") || (hasJa(s) ? s : "") || r || s || null;
  // イニシャル：選んだ名前が解決名ならプロフィール由来イニシャルを優先、それ以外は氏名から導出。
  const initials = (name && name === r ? (resolved?.initials ?? initialsOf(name)) : initialsOf(name));
  return { name, initials };
}

export type ChatMessage = {
  id: string;
  thread_id: string;
  sender_role: ChatRole;
  sender_id: string | null;
  sender_name: string | null;
  body: string;
  created_at: string;
};

export type ChatRead = {
  thread_id: string;
  participant_role: ChatRole;
  participant_id: string;
  last_read_at: string;
};

const THREAD_COLS =
  "id, scout_id, engineer_id, engineer_name, company, company_email, agent, job_no, job_title, subject, status, memo, last_message_at, created_at";
const MSG_COLS = "id, thread_id, sender_role, sender_id, sender_name, body, created_at";

/** 一覧用：スレッド＋最新メッセージのプレビュー＋（自分=agent から見た）未読件数。 */
export type ChatThreadListItem = ChatThread & {
  last_body: string | null;
  last_role: ChatRole | null;
  message_count: number;
  unread: number; // agent から見た未読（自分以外の発言で last_read_at より新しいもの）
};

/**
 * dx（営業）向けにスレッド一覧を取得する。
 * agentId（メール）を渡すと、その担当の最終既読を基準に未読数を計算する。
 */
export async function listChatThreads(agentId?: string | null): Promise<ChatThreadListItem[]> {
  if (!dbConfigured) return [];
  try {
    const sb = chatReader();
    let tr: any = await sb.from("chat_threads").select(THREAD_COLS).order("last_message_at", { ascending: false }).limit(300);
    if (tr.error && /memo|column/i.test(tr.error.message ?? "")) {
      tr = await sb.from("chat_threads").select(THREAD_COLS.replace(", memo", "")).order("last_message_at", { ascending: false }).limit(300);
    }
    const threads = tr.data as any[] | null;
    if (tr.error || !threads?.length) return [];
    const ids = threads.map((t: any) => t.id);
    // ENGERフリーランスの姓名を解決（スナップショットが空でも表示できるように）。
    const engIds = threads.map((t: any) => String(t.engineer_id ?? ""));
    const nameMap = await resolveEngineerNames(engIds);
    // ①別アプローチ：profiles に登録名が無い人は auth.users の user_metadata から姓名を補完。
    await augmentNamesFromAuth(nameMap, engIds);

    // 対象スレッドのメッセージをまとめて取得し、JS で最新＆未読を集計する。
    const { data: msgs } = await sb
      .from("chat_messages")
      .select("thread_id, sender_role, sender_name, body, created_at")
      .in("thread_id", ids)
      .order("created_at", { ascending: false })
      .limit(5000);
    // agent の最終既読。
    const { data: reads } = await sb
      .from("chat_reads")
      .select("thread_id, last_read_at")
      .eq("participant_role", "agent")
      .eq("participant_id", agentId ?? "")
      .in("thread_id", ids);
    const readAt = new Map<string, string>();
    for (const r of (reads ?? []) as any[]) readAt.set(r.thread_id, r.last_read_at);

    // 担当メモはスタッフ専用テーブル(chat_thread_memos・service roleのみ)から取得。
    //   人材(enger.jp/anon)には grant されていないため漏れない。未作成環境は t.memo にフォールバック。
    const memoMap = new Map<string, string>();
    try {
      const mr: any = await sb.from("chat_thread_memos").select("thread_id, memo").in("thread_id", ids);
      for (const r of (mr.data ?? []) as any[]) if (r.memo != null) memoMap.set(r.thread_id, r.memo);
    } catch { /* テーブル未作成は無視 */ }

    const last = new Map<string, any>();
    const count = new Map<string, number>();
    const unread = new Map<string, number>();
    for (const m of (msgs ?? []) as any[]) {
      // msgs は created_at 降順なので、最初に出会ったものが最新。
      if (!last.has(m.thread_id)) last.set(m.thread_id, m);
      count.set(m.thread_id, (count.get(m.thread_id) ?? 0) + 1);
      const ra = readAt.get(m.thread_id);
      if (m.sender_role !== "agent" && (!ra || m.created_at > ra)) {
        unread.set(m.thread_id, (unread.get(m.thread_id) ?? 0) + 1);
      }
    }

    return (threads as any[]).map((t) => {
      const { name, initials } = chooseDisplayName(nameMap.get(String(t.engineer_id ?? "")), t.engineer_name);
      return {
        ...t,
        engineer_name: name,
        engineer_initials: initials,
        memo: memoMap.get(t.id) ?? t.memo ?? null,
        last_body: last.get(t.id)?.body ?? null,
        last_role: (last.get(t.id)?.sender_role ?? null) as ChatRole | null,
        message_count: count.get(t.id) ?? 0,
        unread: unread.get(t.id) ?? 0,
      };
    });
  } catch {
    return [];
  }
}

/** スレッド詳細（本体＋全メッセージ＋参加者ごとの既読）。 */
export async function getChatThread(
  id: string,
): Promise<{ thread: ChatThread; messages: ChatMessage[]; reads: ChatRead[] } | null> {
  if (!dbConfigured) return null;
  try {
    const sb = chatReader();
    let tr: any = await sb.from("chat_threads").select(THREAD_COLS).eq("id", id).maybeSingle();
    if (tr.error && /memo|column/i.test(tr.error.message ?? "")) {
      tr = await sb.from("chat_threads").select(THREAD_COLS.replace(", memo", "")).eq("id", id).maybeSingle();
    }
    const thread = tr.data;
    if (tr.error || !thread) return null;
    const [{ data: messages }, { data: reads }] = await Promise.all([
      sb.from("chat_messages").select(MSG_COLS).eq("thread_id", id).order("created_at", { ascending: true }).limit(2000),
      sb.from("chat_reads").select("thread_id, participant_role, participant_id, last_read_at").eq("thread_id", id),
    ]);
    const nameMap = await resolveEngineerNames([String(thread.engineer_id ?? "")]);
    // ①別アプローチ：profiles に登録名が無い人は auth.users の user_metadata から姓名を補完。
    await augmentNamesFromAuth(nameMap, [String(thread.engineer_id ?? "")]);
    const { name, initials } = chooseDisplayName(nameMap.get(String(thread.engineer_id ?? "")), thread.engineer_name);
    // 担当メモはスタッフ専用テーブルから取得（人材には grant されていないため漏れない）。
    let memo = thread.memo ?? null;
    try {
      const mr: any = await sb.from("chat_thread_memos").select("memo").eq("thread_id", id).maybeSingle();
      if (!mr.error && mr.data) memo = mr.data.memo ?? null;
    } catch { /* テーブル未作成は無視 */ }
    return {
      thread: { ...thread, engineer_name: name, engineer_initials: initials, memo } as ChatThread,
      messages: (messages ?? []) as ChatMessage[],
      reads: (reads ?? []) as ChatRead[],
    };
  } catch {
    return null;
  }
}

/** 担当(agent)から見た全スレッドの未読合計（ナビのバッジ用）。 */
export async function agentUnreadTotal(agentId?: string | null): Promise<number> {
  const list = await listChatThreads(agentId);
  return list.reduce((n, t) => n + t.unread, 0);
}

/** 担当(agent)に「未読の受信（フリーランス/企業）メッセージ」が1件でもあるか。
 *  サイドバーのドット表示用。一覧生成より軽量に（直近の非agentメッセージのみを既読時刻と突合）。 */
export async function agentHasUnread(agentId?: string | null): Promise<boolean> {
  const id = String(agentId ?? "").trim();
  if (!dbConfigured || !id) return false;
  try {
    const sb = chatReader();
    // 担当の既読（thread_id → last_read_at）。
    const rr: any = await sb.from("chat_reads")
      .select("thread_id, last_read_at").eq("participant_role", "agent").eq("participant_id", id);
    const readAt = new Map<string, string>();
    for (const r of (rr.data ?? []) as any[]) readAt.set(r.thread_id, r.last_read_at);
    // 直近の非agentメッセージ（受信）を新しい順に取得し、既読より新しいものが1件でもあれば未読あり。
    const mr: any = await sb.from("chat_messages")
      .select("thread_id, created_at, sender_role")
      .neq("sender_role", "agent")
      .order("created_at", { ascending: false })
      .limit(800);
    for (const m of (mr.data ?? []) as any[]) {
      const ra = readAt.get(m.thread_id);
      if (!ra || m.created_at > ra) return true;
    }
    return false;
  } catch { return false; }
}

// 未読有無を 30秒キャッシュ（email 別）。全ページのレイアウトから呼ばれるため、毎遷移での再集計を避ける。
const _cachedAgentHasUnread = unstable_cache(
  async (email: string) => agentHasUnread(email),
  ["agent-chat-unread"],
  { revalidate: 30, tags: ["sidebar-counts"] },
);
/** サイドバーのドット用：担当(email)に未読の受信チャットがあるか（30秒キャッシュ）。 */
export function agentHasUnreadCached(email?: string | null): Promise<boolean> {
  const key = String(email ?? "").toLowerCase().trim();
  if (!key) return Promise.resolve(false);
  return _cachedAgentHasUnread(key);
}

/** 担当(agent)の未読受信メッセージ「件数」。サイドバー「チャット」の数字バッジ用（④）。
 *  agentHasUnread と同じ軽量手法（既読時刻より新しい非agentメッセージ）で件数を数える。 */
export async function agentUnreadCount(agentId?: string | null): Promise<number> {
  const id = String(agentId ?? "").trim();
  if (!dbConfigured || !id) return 0;
  try {
    const sb = chatReader();
    const rr: any = await sb.from("chat_reads")
      .select("thread_id, last_read_at").eq("participant_role", "agent").eq("participant_id", id);
    const readAt = new Map<string, string>();
    for (const r of (rr.data ?? []) as any[]) readAt.set(r.thread_id, r.last_read_at);
    const mr: any = await sb.from("chat_messages")
      .select("thread_id, created_at, sender_role")
      .neq("sender_role", "agent")
      .order("created_at", { ascending: false })
      .limit(2000);
    let n = 0;
    for (const m of (mr.data ?? []) as any[]) {
      const ra = readAt.get(m.thread_id);
      if (!ra || m.created_at > ra) n++;
    }
    return n;
  } catch { return 0; }
}

const _cachedAgentUnreadCount = unstable_cache(
  async (email: string) => agentUnreadCount(email),
  ["agent-chat-unread-count"],
  { revalidate: 30, tags: ["sidebar-counts"] },
);
/** サイドバーの数字バッジ用：担当(email)の未読受信チャット件数（30秒キャッシュ）。 */
export function agentUnreadCountCached(email?: string | null): Promise<number> {
  const key = String(email ?? "").toLowerCase().trim();
  if (!key) return Promise.resolve(0);
  return _cachedAgentUnreadCount(key);
}

/** LP登録一覧（エンジニア）向け：engineer_id ごとのチャット状態。
 *   unread    … 自分(agent)が未読のフリーランス発言数（>0 なら未読バッジ）。
 *   unreplied … スレッドの最新発言が freelance（＝担当が未返信）なら true。
 *   threadId  … 最新スレッド（/chat?t= で開く）。
 */
export type EngineerChatStatus = { threadId: string; unread: number; unreplied: boolean };
export async function listEngineerChatStatus(agentId?: string | null): Promise<Record<string, EngineerChatStatus>> {
  if (!dbConfigured) return {};
  try {
    const sb = chatReader();
    const { data: threads, error } = await sb
      .from("chat_threads")
      .select("id, engineer_id, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(500);
    if (error || !threads?.length) return {};
    const ids = threads.map((t: any) => t.id);
    const [{ data: msgs }, { data: reads }] = await Promise.all([
      sb.from("chat_messages").select("thread_id, sender_role, created_at").in("thread_id", ids).order("created_at", { ascending: false }).limit(5000),
      sb.from("chat_reads").select("thread_id, last_read_at").eq("participant_role", "agent").eq("participant_id", agentId ?? "").in("thread_id", ids),
    ]);
    const readAt = new Map<string, string>();
    for (const r of (reads ?? []) as any[]) readAt.set(r.thread_id, r.last_read_at);
    const lastByThread = new Map<string, any>();
    const unreadByThread = new Map<string, number>();
    for (const m of (msgs ?? []) as any[]) {
      if (!lastByThread.has(m.thread_id)) lastByThread.set(m.thread_id, m); // created_at 降順なので最初=最新
      const ra = readAt.get(m.thread_id);
      if (m.sender_role === "freelance" && (!ra || m.created_at > ra)) {
        unreadByThread.set(m.thread_id, (unreadByThread.get(m.thread_id) ?? 0) + 1);
      }
    }
    const out: Record<string, EngineerChatStatus> = {};
    for (const t of threads as any[]) {
      const unread = unreadByThread.get(t.id) ?? 0;
      const unreplied = lastByThread.get(t.id)?.sender_role === "freelance";
      const cur = out[t.engineer_id];
      if (!cur) out[t.engineer_id] = { threadId: t.id, unread, unreplied }; // threads は最新順 → 先頭が代表スレッド
      else { cur.unread += unread; cur.unreplied = cur.unreplied || unreplied; }
    }
    return out;
  } catch {
    return {};
  }
}

