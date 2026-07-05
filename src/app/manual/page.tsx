import type { Metadata } from "next";
import { currentAccess } from "@/lib/accounts";
import { manualDocsFor } from "@/lib/help-content";

export const dynamic = "force-dynamic";

// マニュアルは社内・取引先向けの情報のため、ログイン必須（proxy でゲート）＋検索エンジン非掲載。
export const metadata: Metadata = {
  title: "マニュアル",
  robots: { index: false, follow: false },
};

// 見出し（h）からアンカーIDを作る。日本語見出しでも安定するよう index を併用。
const anchor = (di: number, si: number) => `m-${di}-${si}`;

export default async function ManualPage() {
  const access = await currentAccess();
  const { title, intro, docs } = manualDocsFor(access?.role ?? null);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ maxWidth: 820 }}>
          <div className="meta">Manual · マニュアル</div>
          <h1>{title}</h1>
          <div className="sub">{intro}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* 目次（アンカーリンク）。ドキュメントが複数あるときだけ出す。 */}
        {docs.length > 1 && (
          <nav aria-label="目次" className="card" style={{ flex: "0 0 220px", position: "sticky", top: 12, maxHeight: "80vh", overflowY: "auto", padding: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "var(--color-ink-4)", textTransform: "uppercase", marginBottom: 8 }}>目次</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {docs.map((d, di) => (
                <li key={di} style={{ fontSize: 12.5 }}>
                  <a href={`#${anchor(di, -1)}`} style={{ color: "var(--color-brand-700)", textDecoration: "none", fontWeight: 600 }}>{d.title}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <div style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          {docs.map((d, di) => (
            <section key={di} id={anchor(di, -1)} style={{ scrollMarginTop: 16 }}>
              <div style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>{d.title}</h2>
                {d.intro && <div className="muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.7 }}>{d.intro}</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {d.sections.map((s, si) => (
                  <div key={si} id={anchor(di, si)} className="card" style={{ padding: "13px 15px", scrollMarginTop: 16 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{s.h}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                      {s.body.map((line, li) => (
                        <li key={li} style={{ fontSize: 12.5, lineHeight: 1.75, color: "var(--color-ink-2)" }}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}

          <div style={{ fontSize: 11, color: "var(--color-ink-4)", lineHeight: 1.7 }}>
            ※ 各画面の右上「ヘルプ」を押すと、その画面の使い方をその場で確認できます。マニュアルは機能の追加・変更に合わせて随時更新されます。
          </div>
        </div>
      </div>
    </div>
  );
}
