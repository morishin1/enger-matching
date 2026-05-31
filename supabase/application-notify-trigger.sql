-- 応募(enger.applications) が新規に INSERT されたら、自動で notifications にお知らせを投函。
-- これにより enger.jp 側の実装に依存せず、dx 側で確実に通知できる。
-- すでに dx には /notifications 画面があり、サイドバーのベルアイコンに新着が出る。

-- トリガー関数
create or replace function enger.notify_on_application_insert()
returns trigger as $$
begin
  begin
    insert into enger.notifications (recipient, title, body, kind)
    values (
      'all',
      '新しい応募がありました',
      coalesce(NEW.engineer_name, '人材') || ' さんが「' || coalesce(NEW.job_title, '案件') || '」(No.' || coalesce(NEW.job_no::text, '-') || ') に応募しました。',
      'info'
    );
  exception when others then
    -- 通知テーブルが無い等のエラーで応募登録自体は失敗させない
    null;
  end;
  return NEW;
end;
$$ language plpgsql security definer;

-- トリガー本体（INSERT のみ）
drop trigger if exists trg_notify_on_application_insert on enger.applications;
create trigger trg_notify_on_application_insert
after insert on enger.applications
for each row execute procedure enger.notify_on_application_insert();
