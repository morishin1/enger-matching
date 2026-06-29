# フリーランス「案件を探す」案件詳細 連携（DX → enger.jp）

DX(enger-matching)が**唯一の正**として、フリーランス画面の案件詳細パネルへ「指定項目だけ」を返す連携API。
enger-lp 側は**このAPIを叩いて表示するだけ**にすることで、項目の出し分け・面談済ゲート・派生値(国籍/年代)の算出をDX1か所に集約する（二重実装による「項目が出ない」事故を防ぐ）。

## API
```
GET https://dx.enger.jp/api/public/job-detail?job_no=<案件No>
  Authorization: Bearer <Supabaseアクセストークン>   ← 推奨（なりすまし防止）
  または ?viewer=<ログイン中フリーランスのメール>      ← 検証用フォールバック
```

### レスポンス
```jsonc
{
  "ok": true,
  "job": {
    "job_no": 123,
    "title": "…",
    "role_label": "…",          // 募集職種
    "skills": ["React", "AWS"],  // 必要スキル（タグ表示用）
    "salary_min": 70, "salary_max": 90,  // 単価（enger.jp 既存の金額表示をそのまま使う）
    "remote_type": "partial_remote",
    "remote_label": "一部リモート",       // リモート可否
    // ↓ 面談済(meeting_done=true)のときだけ含まれる（未面談時はキーごと存在しない）
    "start_date": "2026-07-01",          // 開始希望
    "nationality_requirement": "日本国籍のみ", // 国籍要件（DXがサーバ側で算出）
    "age_limit": "30代まで"               // 年代制限（DXがサーバ側で算出）
  },
  "gate": { "meetingDone": true, "canApply": true }
}
```
> ⚠️ ホワイトリストは**サーバ側で強制**。上記以外の項目はDBにあっても返しません。
> 未面談時は `start_date / nationality_requirement / age_limit` は**キーごと返りません**＝表示しようがない。

## enger.jp（enger-lp）側でやること（要件1〜3）

```ts
// 1) 取得（ログイン中フリーランスのトークンを付ける）
const { data: { session } } = await supabase.auth.getSession();
const res = await fetch(`https://dx.enger.jp/api/public/job-detail?job_no=${jobNo}`, {
  headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
});
const { job, gate } = await res.json();

// 2) 表示（job のキーだけを描画。無いキーは出さない＝ホワイトリスト準拠）
//    案件名 job.title / No job.job_no / 募集職種 job.role_label / 必要スキル job.skills(タグ)
//    単価 …既存の金額表示を維持 / リモート可否 job.remote_label
//    面談済のとき：開始希望 job.start_date / 国籍要件 job.nationality_requirement / 年代制限 job.age_limit

// 3) 面談済フラグによるUI切替
if (gate.meetingDone) {
  // ① グレー枠（業務内容の詳細・契約条件・想定企業は〜）を非表示
  // ① 黄色枠（応募はエージェント面談の完了後に解放されます）を非表示
  // ② 上記で空いた場所に job の開始希望/国籍要件/年代制限を差し込む
  // ③ 「面談承認後に応募できます」(非活性) → 「応募する」(活性) に切替（gate.canApply===true）
} else {
  // 従来どおりロック表示（グレー/黄色枠・非活性ボタン）
}
```

## DX側のトリガー（既存）
- 「面談済」フラグ＝ `app_users.meeting_done`。DXの**承認/アカウント管理（ApprovalsView）**でフリーランスの面談済をONにすると、本APIの `gate.meetingDone=true` になり開示・応募可に切り替わる。

## 注意
- enger.jp は別オリジンのため、本APIは enger 系オリジン（`*.enger.jp`）に対して **CORS 許可**済み。
- 本番反映（enger.jp 画面で見える化）は **enger-lp 側のデプロイが必要**。
</content>
