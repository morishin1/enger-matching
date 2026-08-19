// 人材ID・案件IDの表示ラベルと、検索窓に打たれた「ID」の読み取り。
//
// 表記は一覧（PeopleTable / JobsTable / EntityTable）にそろえる。
//   人材ID … P-17013  （candidates.candidate_no を5桁ゼロ埋め）
//   案件ID … No.45509 （jobs.job_no を5桁ゼロ埋め）
//   企業ID … C-00001  （companies.company_no。ラベルは lib/companies の companyIdLabel）
//
// #767：検索結果にIDを出す／IDで検索できるようにするため、
//   「画面に出す文字列」と「検索で照合する番号」を同じ場所から作る。
//   別々に書くと、片方だけ表記が変わったときに「見えているIDで検索しても出ない」が起きる。

export function candidateIdLabel(no: number | null | undefined): string | null {
  if (no == null) return null;
  return `P-${String(no).padStart(5, "0")}`;
}

export function jobIdLabel(no: number | null | undefined): string | null {
  if (no == null) return null;
  return `No.${String(no).padStart(5, "0")}`;
}

/** 検索語がIDの直打ちだったときの、番号と「どこを探すか」。 */
export type EntityIdQuery = { no: number; cand: boolean; job: boolean; company: boolean };

/**
 * 検索語が「IDの直打ち」なら番号と探す先を返す。IDに見えなければ null。
 *
 *  ・接頭辞 P… → 人材、C… → 企業、それ以外（No. / J- など）→ 案件。
 *  ・接頭辞なし（純数字）は3種すべてを探す。番号空間が別なので取り違えは起きにくく、
 *    「17013 と打てば P-17013 が出る」という素直な動きになる。
 *  ・"P-00017" のようなゼロ埋め、"#45509"、"C 1" のような区切りもそのまま読む。
 */
export function parseEntityId(q: string): EntityIdQuery | null {
  const m = q.trim().match(/^([A-Za-z]{0,4})[\s\-#.．_]*(\d{1,9})$/);
  if (!m) return null;
  const no = Number(m[2]);
  if (!Number.isFinite(no)) return null;
  const pfx = m[1].toUpperCase();
  const cand = pfx === "" || pfx.startsWith("P");
  const company = pfx === "" || pfx.startsWith("C");
  // 案件は「人材でも企業でもない接頭辞」を全部引き受ける（No. / J- / 無印）。
  const job = pfx === "" || !(pfx.startsWith("P") || pfx.startsWith("C"));
  return { no, cand, job, company };
}
