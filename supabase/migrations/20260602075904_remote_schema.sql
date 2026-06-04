drop extension if exists "pg_net";

create schema if not exists "lms";

create type "public"."lesson_type" as enum ('video', 'doc', 'quiz');

create type "public"."notification_type" as enum ('info', 'deadline', 'feedback', 'system');

create type "public"."portfolio_type" as enum ('submission', 'project', 'badge', 'note');

create type "public"."submission_status" as enum ('draft', 'submitted', 'graded', 'returned');

create type "public"."user_role" as enum ('student', 'instructor', 'admin');

drop policy "jobs_read" on "enger"."jobs";

alter table "enger"."app_users" drop constraint "app_users_role_check";

drop index if exists "enger"."jobs_no_uniq";

drop index if exists "enger"."jobs_published_idx";


  create table "enger"."account_audits" (
    "id" uuid not null default gen_random_uuid(),
    "target_id" uuid,
    "target_email" text,
    "action" text not null,
    "detail" text,
    "actor_email" text,
    "actor_name" text,
    "actor_role" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "enger"."account_audits" enable row level security;


  create table "enger"."account_emails" (
    "id" uuid not null default gen_random_uuid(),
    "account_id" uuid,
    "account_email" text,
    "template" text,
    "subject" text not null,
    "body" text not null,
    "actor_email" text,
    "actor_name" text,
    "status" text not null default 'sent'::text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "enger"."account_emails" enable row level security;


  create table "enger"."client_feedback" (
    "id" uuid not null default gen_random_uuid(),
    "proposal_id" uuid,
    "company" text,
    "verdict" text not null,
    "reason" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "enger"."client_feedback" enable row level security;


  create table "enger"."proposal_memos" (
    "id" uuid not null default gen_random_uuid(),
    "proposal_id" uuid not null,
    "category" text not null,
    "body" text not null,
    "created_by_email" text,
    "created_by_name" text,
    "created_at" timestamp with time zone not null default now()
      );


alter table "enger"."proposal_memos" enable row level security;


  create table "lms"."assignments" (
    "id" uuid not null default gen_random_uuid(),
    "sprint_id" uuid not null,
    "title" text not null,
    "template" text,
    "rubric_json" jsonb,
    "deadline" timestamp with time zone,
    "max_score" integer default 100,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "lms"."assignments" enable row level security;


  create table "lms"."courses" (
    "id" uuid not null default gen_random_uuid(),
    "title" text not null,
    "description" text,
    "instructor_id" uuid,
    "order_index" integer not null default 0,
    "is_published" boolean not null default true,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "lms"."courses" enable row level security;


  create table "lms"."enrollments" (
    "user_id" uuid not null,
    "course_id" uuid not null,
    "enrolled_at" timestamp with time zone not null default now()
      );


alter table "lms"."enrollments" enable row level security;


  create table "lms"."lesson_progress" (
    "user_id" uuid not null,
    "lesson_id" uuid not null,
    "completed" boolean not null default false,
    "completed_at" timestamp with time zone
      );


alter table "lms"."lesson_progress" enable row level security;


  create table "lms"."lessons" (
    "id" uuid not null default gen_random_uuid(),
    "sprint_id" uuid not null,
    "order_index" integer not null,
    "type" public.lesson_type not null,
    "title" text not null,
    "duration_sec" integer,
    "video_url" text,
    "doc_url" text,
    "body" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "lms"."lessons" enable row level security;


  create table "lms"."portfolio_items" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "type" public.portfolio_type not null,
    "title" text not null,
    "body" text,
    "source_submission_id" uuid,
    "order_index" integer not null default 0,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "lms"."portfolio_items" enable row level security;


  create table "lms"."sprints" (
    "id" uuid not null default gen_random_uuid(),
    "course_id" uuid not null,
    "order_index" integer not null,
    "title" text not null,
    "description" text,
    "unlock_after_sprint_id" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "lms"."sprints" enable row level security;


  create table "lms"."submissions" (
    "id" uuid not null default gen_random_uuid(),
    "assignment_id" uuid not null,
    "user_id" uuid not null,
    "body" text,
    "status" public.submission_status not null default 'draft'::public.submission_status,
    "score" integer,
    "feedback" text,
    "submitted_at" timestamp with time zone,
    "graded_at" timestamp with time zone,
    "graded_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
      );


alter table "lms"."submissions" enable row level security;


  create table "public"."ai_chat_messages" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "role" text not null,
    "content" text not null,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."ai_chat_messages" enable row level security;


  create table "public"."ai_chat_usage" (
    "user_id" uuid not null,
    "date" date not null default CURRENT_DATE,
    "count" integer not null default 0,
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."ai_chat_usage" enable row level security;


  create table "public"."invites" (
    "id" uuid not null default gen_random_uuid(),
    "token" text not null default encode(extensions.gen_random_bytes(12), 'hex'::text),
    "email" text,
    "role" public.user_role not null default 'student'::public.user_role,
    "course_id" uuid,
    "invited_by" uuid,
    "used" boolean not null default false,
    "used_by" uuid,
    "created_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone default (now() + '30 days'::interval)
      );


alter table "public"."invites" enable row level security;


  create table "public"."notifications" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "type" public.notification_type not null default 'info'::public.notification_type,
    "text" text not null,
    "link" text,
    "read" boolean not null default false,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."notifications" enable row level security;


  create table "public"."profiles" (
    "id" uuid not null,
    "name" text not null default ''::text,
    "role" public.user_role not null default 'student'::public.user_role,
    "avatar_initial" text,
    "bio" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "email" text,
    "display_name" text,
    "avatar_url" text,
    "github_id" bigint,
    "github_login" text,
    "skills" jsonb not null default '[]'::jsonb,
    "primary_language" text,
    "total_stars" integer not null default 0,
    "total_repos" integer not null default 0,
    "estimated_pay_low" integer,
    "estimated_pay_mid" integer,
    "estimated_pay_high" integer,
    "last_login_at" timestamp with time zone,
    "headline" text,
    "referral_code" text,
    "referred_by" uuid,
    "portfolio_url" text,
    "skill_sheet_url" text,
    "skill_sheet_name" text,
    "qiita_id" text,
    "signup_source" text,
    "signup_method" text,
    "phone" text,
    "contact_line" text,
    "weekly_days" text,
    "remote_pref" text,
    "wants_match_alert" boolean not null default false
      );


alter table "public"."profiles" enable row level security;


  create table "public"."skill_levels" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "skill" text not null,
    "level" integer not null default 1,
    "source" text default 'manual'::text,
    "updated_at" timestamp with time zone not null default now()
      );


alter table "public"."skill_levels" enable row level security;

alter table "enger"."ai_usage" drop column "provider";

alter table "enger"."ai_usage" add column "account" text;

alter table "enger"."app_users" add column "approved_by_email" text;

alter table "enger"."app_users" add column "approved_by_name" text;

alter table "enger"."app_users" add column "meeting_done" boolean not null default false;

alter table "enger"."app_users" add column "meeting_done_at" timestamp with time zone;

alter table "enger"."app_users" add column "meeting_done_by_email" text;

alter table "enger"."app_users" add column "meeting_done_by_name" text;

alter table "enger"."app_users" add column "owner_agent_email" text;

alter table "enger"."app_users" add column "owner_agent_name" text;

alter table "enger"."app_users" add column "position" text;

alter table "enger"."app_users" add column "signup_method" text;

alter table "enger"."app_users" add column "signup_source" text;

alter table "enger"."candidates" add column "operator" text;

alter table "enger"."candidates" add column "owner_company" text;

alter table "enger"."candidates" add column "shared" boolean not null default false;

alter table "enger"."jobs" add column "description" text;

alter table "enger"."jobs" add column "freshness" text;

alter table "enger"."jobs" add column "imported_at" timestamp with time zone;

alter table "enger"."jobs" add column "nationality" text;

alter table "enger"."jobs" add column "operator" text;

alter table "enger"."jobs" add column "owner_company" text;

alter table "enger"."jobs" add column "period_note" text;

alter table "enger"."jobs" add column "priority" text;

alter table "enger"."jobs" add column "rank" text default '-'::text;

alter table "enger"."jobs" add column "salary_label" text;

alter table "enger"."jobs" add column "shared" boolean not null default false;

alter table "enger"."jobs" add column "skill_level" text;

alter table "enger"."jobs" add column "source_csv" text;

alter table "enger"."jobs" add column "updated_at" timestamp with time zone not null default now();

alter table "enger"."jobs" add column "work_days" text;

alter table "enger"."jobs" alter column "is_published" set default true;

alter table "enger"."jobs" alter column "remote_type" set default 'partial_remote'::text;

alter table "enger"."jobs" alter column "skills" drop not null;

alter table "enger"."jobs" alter column "start_date" set data type date using "start_date"::date;

alter table "enger"."jobs" alter column "title" set not null;

alter table "enger"."meetings" add column "account_email" text;

alter table "enger"."meetings" add column "account_id" uuid;

alter table "enger"."meetings" add column "meeting_time" time without time zone;

alter table "enger"."proposals" add column "cand_notify_status" text default 'pending'::text;

alter table "enger"."proposals" add column "job_notify_status" text default 'pending'::text;

alter table "enger"."proposals" add column "lost_reason_note" text;

alter table "enger"."proposals" add column "meeting_attendees" text;

alter table "enger"."proposals" add column "meeting_format" text;

alter table "enger"."proposals" add column "meeting_note" text;

alter table "enger"."proposals" add column "meeting_time" text;

alter table "enger"."proposals" add column "meeting_url" text;

alter table "enger"."proposals" add column "owner_company" text;

alter table "enger"."proposals" add column "source" text;

alter table "enger"."proposals" add column "stage_updated_at" timestamp with time zone;

alter table "enger"."staff" drop column "email";

CREATE INDEX account_audits_actor_idx ON enger.account_audits USING btree (actor_email, created_at DESC);

CREATE UNIQUE INDEX account_audits_pkey ON enger.account_audits USING btree (id);

CREATE INDEX account_audits_target_idx ON enger.account_audits USING btree (target_id, created_at DESC);

CREATE INDEX account_emails_account_idx ON enger.account_emails USING btree (account_id, created_at DESC);

CREATE UNIQUE INDEX account_emails_pkey ON enger.account_emails USING btree (id);

CREATE INDEX account_emails_template_idx ON enger.account_emails USING btree (template);

CREATE INDEX ai_usage_account_feature_idx ON enger.ai_usage USING btree (account, feature, created_at);

CREATE INDEX app_users_meeting_done_idx ON enger.app_users USING btree (meeting_done);

CREATE INDEX app_users_owner_agent_idx ON enger.app_users USING btree (owner_agent_email);

CREATE INDEX candidates_operator_idx ON enger.candidates USING btree (operator, created_at);

CREATE INDEX candidates_owner_company_idx ON enger.candidates USING btree (owner_company);

CREATE INDEX candidates_shared_idx ON enger.candidates USING btree (shared);

CREATE INDEX client_feedback_company_idx ON enger.client_feedback USING btree (company);

CREATE UNIQUE INDEX client_feedback_pkey ON enger.client_feedback USING btree (id);

CREATE UNIQUE INDEX client_feedback_proposal_uniq ON enger.client_feedback USING btree (proposal_id);

CREATE UNIQUE INDEX jobs_job_no_uniq ON enger.jobs USING btree (job_no);

CREATE INDEX jobs_operator_idx ON enger.jobs USING btree (operator, created_at);

CREATE INDEX jobs_owner_company_idx ON enger.jobs USING btree (owner_company);

CREATE INDEX jobs_shared_idx ON enger.jobs USING btree (shared);

CREATE UNIQUE INDEX jobs_title_client_uniq ON enger.jobs USING btree (title, client_name);

CREATE INDEX meetings_account_idx ON enger.meetings USING btree (account_id, meeting_date DESC);

CREATE UNIQUE INDEX proposal_memos_pkey ON enger.proposal_memos USING btree (id);

CREATE INDEX proposal_memos_proposal_idx ON enger.proposal_memos USING btree (proposal_id, created_at DESC);

CREATE INDEX proposals_owner_company_idx ON enger.proposals USING btree (owner_company);

CREATE UNIQUE INDEX assignments_pkey ON lms.assignments USING btree (id);

CREATE INDEX assignments_sprint_idx ON lms.assignments USING btree (sprint_id);

CREATE INDEX courses_instructor_idx ON lms.courses USING btree (instructor_id);

CREATE UNIQUE INDEX courses_pkey ON lms.courses USING btree (id);

CREATE INDEX enrollments_course_idx ON lms.enrollments USING btree (course_id);

CREATE UNIQUE INDEX enrollments_pkey ON lms.enrollments USING btree (user_id, course_id);

CREATE UNIQUE INDEX lesson_progress_pkey ON lms.lesson_progress USING btree (user_id, lesson_id);

CREATE INDEX lesson_progress_user_idx ON lms.lesson_progress USING btree (user_id);

CREATE UNIQUE INDEX lessons_pkey ON lms.lessons USING btree (id);

CREATE UNIQUE INDEX lessons_sprint_id_order_index_key ON lms.lessons USING btree (sprint_id, order_index);

CREATE INDEX lessons_sprint_idx ON lms.lessons USING btree (sprint_id);

CREATE UNIQUE INDEX portfolio_items_pkey ON lms.portfolio_items USING btree (id);

CREATE INDEX portfolio_items_user_idx ON lms.portfolio_items USING btree (user_id);

CREATE UNIQUE INDEX sprints_course_id_order_index_key ON lms.sprints USING btree (course_id, order_index);

CREATE INDEX sprints_course_idx ON lms.sprints USING btree (course_id);

CREATE UNIQUE INDEX sprints_pkey ON lms.sprints USING btree (id);

CREATE UNIQUE INDEX submissions_assignment_id_user_id_key ON lms.submissions USING btree (assignment_id, user_id);

CREATE INDEX submissions_assignment_idx ON lms.submissions USING btree (assignment_id);

CREATE UNIQUE INDEX submissions_pkey ON lms.submissions USING btree (id);

CREATE INDEX submissions_user_idx ON lms.submissions USING btree (user_id);

CREATE UNIQUE INDEX ai_chat_messages_pkey ON public.ai_chat_messages USING btree (id);

CREATE INDEX ai_chat_messages_user_idx ON public.ai_chat_messages USING btree (user_id, created_at DESC);

CREATE INDEX ai_chat_usage_date_idx ON public.ai_chat_usage USING btree (date);

CREATE UNIQUE INDEX ai_chat_usage_pkey ON public.ai_chat_usage USING btree (user_id, date);

CREATE INDEX idx_skill_levels_user ON public.skill_levels USING btree (user_id);

CREATE UNIQUE INDEX invites_pkey ON public.invites USING btree (id);

CREATE UNIQUE INDEX invites_token_key ON public.invites USING btree (token);

CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);

CREATE INDEX notifications_user_idx ON public.notifications USING btree (user_id, read);

CREATE UNIQUE INDEX profiles_github_id_uniq ON public.profiles USING btree (github_id) WHERE (github_id IS NOT NULL);

CREATE INDEX profiles_last_login_idx ON public.profiles USING btree (last_login_at);

CREATE INDEX profiles_match_alert_idx ON public.profiles USING btree (wants_match_alert) WHERE (wants_match_alert = true);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX profiles_referral_code_uniq ON public.profiles USING btree (referral_code) WHERE (referral_code IS NOT NULL);

CREATE INDEX profiles_referred_by_idx ON public.profiles USING btree (referred_by) WHERE (referred_by IS NOT NULL);

CREATE INDEX profiles_role_idx ON public.profiles USING btree (role);

CREATE INDEX profiles_signup_method_idx ON public.profiles USING btree (signup_method);

CREATE INDEX profiles_signup_source_idx ON public.profiles USING btree (signup_source);

CREATE UNIQUE INDEX skill_levels_pkey ON public.skill_levels USING btree (id);

CREATE UNIQUE INDEX skill_levels_user_id_skill_key ON public.skill_levels USING btree (user_id, skill);

CREATE INDEX jobs_published_idx ON enger.jobs USING btree (is_published, created_at DESC);

alter table "enger"."account_audits" add constraint "account_audits_pkey" PRIMARY KEY using index "account_audits_pkey";

alter table "enger"."account_emails" add constraint "account_emails_pkey" PRIMARY KEY using index "account_emails_pkey";

alter table "enger"."client_feedback" add constraint "client_feedback_pkey" PRIMARY KEY using index "client_feedback_pkey";

alter table "enger"."proposal_memos" add constraint "proposal_memos_pkey" PRIMARY KEY using index "proposal_memos_pkey";

alter table "lms"."assignments" add constraint "assignments_pkey" PRIMARY KEY using index "assignments_pkey";

alter table "lms"."courses" add constraint "courses_pkey" PRIMARY KEY using index "courses_pkey";

alter table "lms"."enrollments" add constraint "enrollments_pkey" PRIMARY KEY using index "enrollments_pkey";

alter table "lms"."lesson_progress" add constraint "lesson_progress_pkey" PRIMARY KEY using index "lesson_progress_pkey";

alter table "lms"."lessons" add constraint "lessons_pkey" PRIMARY KEY using index "lessons_pkey";

alter table "lms"."portfolio_items" add constraint "portfolio_items_pkey" PRIMARY KEY using index "portfolio_items_pkey";

alter table "lms"."sprints" add constraint "sprints_pkey" PRIMARY KEY using index "sprints_pkey";

alter table "lms"."submissions" add constraint "submissions_pkey" PRIMARY KEY using index "submissions_pkey";

alter table "public"."ai_chat_messages" add constraint "ai_chat_messages_pkey" PRIMARY KEY using index "ai_chat_messages_pkey";

alter table "public"."ai_chat_usage" add constraint "ai_chat_usage_pkey" PRIMARY KEY using index "ai_chat_usage_pkey";

alter table "public"."invites" add constraint "invites_pkey" PRIMARY KEY using index "invites_pkey";

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY using index "notifications_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."skill_levels" add constraint "skill_levels_pkey" PRIMARY KEY using index "skill_levels_pkey";

alter table "enger"."client_feedback" add constraint "client_feedback_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES enger.proposals(id) ON DELETE CASCADE not valid;

alter table "enger"."client_feedback" validate constraint "client_feedback_proposal_id_fkey";

alter table "enger"."client_feedback" add constraint "client_feedback_verdict_check" CHECK ((verdict = ANY (ARRAY['want'::text, 'maybe'::text, 'mismatch'::text]))) not valid;

alter table "enger"."client_feedback" validate constraint "client_feedback_verdict_check";

alter table "enger"."proposal_memos" add constraint "proposal_memos_proposal_id_fkey" FOREIGN KEY (proposal_id) REFERENCES enger.proposals(id) ON DELETE CASCADE not valid;

alter table "enger"."proposal_memos" validate constraint "proposal_memos_proposal_id_fkey";

alter table "lms"."assignments" add constraint "assignments_sprint_id_fkey" FOREIGN KEY (sprint_id) REFERENCES lms.sprints(id) ON DELETE CASCADE not valid;

alter table "lms"."assignments" validate constraint "assignments_sprint_id_fkey";

alter table "lms"."courses" add constraint "courses_instructor_id_fkey" FOREIGN KEY (instructor_id) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "lms"."courses" validate constraint "courses_instructor_id_fkey";

alter table "lms"."enrollments" add constraint "enrollments_course_id_fkey" FOREIGN KEY (course_id) REFERENCES lms.courses(id) ON DELETE CASCADE not valid;

alter table "lms"."enrollments" validate constraint "enrollments_course_id_fkey";

alter table "lms"."enrollments" add constraint "enrollments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "lms"."enrollments" validate constraint "enrollments_user_id_fkey";

alter table "lms"."lesson_progress" add constraint "lesson_progress_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES lms.lessons(id) ON DELETE CASCADE not valid;

alter table "lms"."lesson_progress" validate constraint "lesson_progress_lesson_id_fkey";

alter table "lms"."lesson_progress" add constraint "lesson_progress_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "lms"."lesson_progress" validate constraint "lesson_progress_user_id_fkey";

alter table "lms"."lessons" add constraint "lessons_sprint_id_fkey" FOREIGN KEY (sprint_id) REFERENCES lms.sprints(id) ON DELETE CASCADE not valid;

alter table "lms"."lessons" validate constraint "lessons_sprint_id_fkey";

alter table "lms"."lessons" add constraint "lessons_sprint_id_order_index_key" UNIQUE using index "lessons_sprint_id_order_index_key";

alter table "lms"."portfolio_items" add constraint "portfolio_items_source_submission_id_fkey" FOREIGN KEY (source_submission_id) REFERENCES lms.submissions(id) ON DELETE SET NULL not valid;

alter table "lms"."portfolio_items" validate constraint "portfolio_items_source_submission_id_fkey";

alter table "lms"."portfolio_items" add constraint "portfolio_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "lms"."portfolio_items" validate constraint "portfolio_items_user_id_fkey";

alter table "lms"."sprints" add constraint "sprints_course_id_fkey" FOREIGN KEY (course_id) REFERENCES lms.courses(id) ON DELETE CASCADE not valid;

alter table "lms"."sprints" validate constraint "sprints_course_id_fkey";

alter table "lms"."sprints" add constraint "sprints_course_id_order_index_key" UNIQUE using index "sprints_course_id_order_index_key";

alter table "lms"."sprints" add constraint "sprints_unlock_after_sprint_id_fkey" FOREIGN KEY (unlock_after_sprint_id) REFERENCES lms.sprints(id) ON DELETE SET NULL not valid;

alter table "lms"."sprints" validate constraint "sprints_unlock_after_sprint_id_fkey";

alter table "lms"."submissions" add constraint "submissions_assignment_id_fkey" FOREIGN KEY (assignment_id) REFERENCES lms.assignments(id) ON DELETE CASCADE not valid;

alter table "lms"."submissions" validate constraint "submissions_assignment_id_fkey";

alter table "lms"."submissions" add constraint "submissions_assignment_id_user_id_key" UNIQUE using index "submissions_assignment_id_user_id_key";

alter table "lms"."submissions" add constraint "submissions_graded_by_fkey" FOREIGN KEY (graded_by) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "lms"."submissions" validate constraint "submissions_graded_by_fkey";

alter table "lms"."submissions" add constraint "submissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "lms"."submissions" validate constraint "submissions_user_id_fkey";

alter table "public"."ai_chat_messages" add constraint "ai_chat_messages_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))) not valid;

alter table "public"."ai_chat_messages" validate constraint "ai_chat_messages_role_check";

alter table "public"."ai_chat_messages" add constraint "ai_chat_messages_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."ai_chat_messages" validate constraint "ai_chat_messages_user_id_fkey";

alter table "public"."ai_chat_usage" add constraint "ai_chat_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."ai_chat_usage" validate constraint "ai_chat_usage_user_id_fkey";

alter table "public"."invites" add constraint "invites_invited_by_fkey" FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."invites" validate constraint "invites_invited_by_fkey";

alter table "public"."invites" add constraint "invites_token_key" UNIQUE using index "invites_token_key";

alter table "public"."notifications" add constraint "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."notifications" validate constraint "notifications_user_id_fkey";

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

alter table "public"."profiles" add constraint "profiles_remote_pref_chk" CHECK (((remote_pref IS NULL) OR (remote_pref = ANY (ARRAY['full_remote'::text, 'hybrid'::text, 'onsite_ok'::text])))) not valid;

alter table "public"."profiles" validate constraint "profiles_remote_pref_chk";

alter table "public"."profiles" add constraint "profiles_weekly_days_chk" CHECK (((weekly_days IS NULL) OR (weekly_days = ANY (ARRAY['1-2'::text, '3-4'::text, '5'::text])))) not valid;

alter table "public"."profiles" validate constraint "profiles_weekly_days_chk";

alter table "public"."skill_levels" add constraint "skill_levels_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."skill_levels" validate constraint "skill_levels_user_id_fkey";

alter table "public"."skill_levels" add constraint "skill_levels_user_id_skill_key" UNIQUE using index "skill_levels_user_id_skill_key";

alter table "enger"."app_users" add constraint "app_users_role_check" CHECK ((role = ANY (ARRAY['admin'::text, 'agent'::text, 'client'::text, 'candidate'::text, 'partner'::text, 'freelance'::text]))) not valid;

alter table "enger"."app_users" validate constraint "app_users_role_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.current_user_role()
 RETURNS public.user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select role from public.profiles where id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_invite(p_token text)
 RETURNS TABLE(email text, role public.user_role, course_id uuid, course_title text, used boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.email, i.role, i.course_id,
         (select c.title from lms.courses c where c.id = i.course_id),
         i.used
  from public.invites i
  where i.token = p_token
    and (i.expires_at is null or i.expires_at > now());
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  inv public.invites;
  v_role user_role;
begin
  if (new.raw_user_meta_data->>'invite_token') is not null then
    select * into inv from public.invites
      where token = new.raw_user_meta_data->>'invite_token' and used = false
      limit 1;
  end if;

  v_role := coalesce(inv.role, (new.raw_user_meta_data->>'role')::user_role, 'student');

  insert into public.profiles (id, name, role, avatar_initial)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_role,
    upper(substring(coalesce(new.raw_user_meta_data->>'name', new.email) from 1 for 1))
  );

  if inv.id is not null then
    if inv.course_id is not null then
      insert into lms.enrollments (user_id, course_id)
      values (new.id, inv.course_id)
      on conflict do nothing;
    end if;
    update public.invites set used = true, used_by = new.id where id = inv.id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

create or replace view "public"."v_engineer_overview" as  SELECT id,
    name,
    role,
    avatar_initial,
    ( SELECT count(*) AS count
           FROM lms.enrollments e
          WHERE (e.user_id = p.id)) AS enrolled_courses,
    ( SELECT count(*) AS count
           FROM lms.submissions s
          WHERE ((s.user_id = p.id) AND (s.status = 'graded'::public.submission_status))) AS graded_submissions,
    ( SELECT count(*) AS count
           FROM lms.lesson_progress lp
          WHERE ((lp.user_id = p.id) AND lp.completed)) AS completed_lessons,
    ( SELECT count(*) AS count
           FROM public.skill_levels sl
          WHERE (sl.user_id = p.id)) AS skill_count
   FROM public.profiles p
  WHERE (role = 'student'::public.user_role);


CREATE OR REPLACE FUNCTION enger.company_overview()
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(json_agg(row_to_json(c) order by c.active_jobs desc, c.job_count desc), '[]'::json)
  from (
    select
      g.name, g.job_count, g.active_jobs, g.focus_jobs, g.last_job_at, g.avg_rate,
      case when g.job_count >= 10 then 'A' when g.job_count >= 3 then 'B' else 'C' end as tier,
      case
        when g.last_job_at < now() - interval '90 days' then '休眠'
        when g.job_count >= 10 then '主要'
        when g.job_count <= 2 then '新規'
        else '拡大中'
      end as status,
      coalesce(pr.proposals_total, 0) as proposals_total,
      coalesce(pr.won, 0) as won,
      coalesce(pr.lost, 0) as lost,
      lm.fb_sentiment   as last_sentiment,
      lm.relation_status as last_relation,
      lm.meeting_date   as last_meeting_at,
      coalesce(mc.meeting_count, 0) as meeting_count
    from (
      select
        j.client_name as name,
        count(*) as job_count,
        count(*) filter (where coalesce(j.status,'募集中') = '募集中') as active_jobs,
        count(*) filter (where j.is_focus) as focus_jobs,
        max(j.created_at) as last_job_at,
        round(avg(coalesce(j.salary_max, j.salary_min)))::int as avg_rate
      from enger.jobs j
      where j.is_published and j.client_name is not null and btrim(j.client_name) <> ''
      group by j.client_name
    ) g
    left join (
      select company,
        count(*) as proposals_total,
        count(*) filter (where stage = '稼働決定') as won,
        count(*) filter (where stage in ('見送り','失注')) as lost
      from enger.proposals where company is not null group by company
    ) pr on pr.company = g.name
    left join (
      select company_name, count(*) as meeting_count from enger.meetings group by company_name
    ) mc on mc.company_name = g.name
    left join lateral (
      select fb_sentiment, relation_status, meeting_date
      from enger.meetings m where m.company_name = g.name
      order by meeting_date desc nulls last, created_at desc
      limit 1
    ) lm on true
  ) c;
$function$
;

CREATE OR REPLACE FUNCTION enger.matching_stats()
 RETURNS json
 LANGUAGE sql
 STABLE
AS $function$
  select json_build_object(
    'jobs_total',       (select count(*) from enger.jobs where is_published),
    'jobs_proposable',  (select count(*) from enger.jobs j
                          where j.is_published
                            and coalesce(j.status,'募集中') = '募集中'
                            and array_length(j.skills,1) is not null
                            and exists (select 1 from enger.candidates c where c.skills && j.skills)),
    'jobs_new7',        (select count(*) from enger.jobs
                          where is_published and created_at >= now() - interval '7 days'),
    'jobs_detail_full', (select count(*) from enger.jobs
                          where is_published and remote_type is not null
                            and (detail is not null or work_location is not null)),
    'cand_total',        (select count(*) from enger.candidates),
    'cand_proposable',   (select count(*) from enger.candidates where status = '提案可'),
    'cand_skills',       (select count(*) from enger.candidates where array_length(skills,1) is not null),
    'cand_profile_full', (select count(*) from enger.candidates
                           where array_length(skills,1) is not null
                             and (rate is not null or salary_min is not null)),
    'cand_stale',        (select count(*) from enger.candidates
                           where coalesce(imported_at, created_at) < now() - interval '30 days'),
    'cand_dupes',        (select count(*) from
                           (select 1 from enger.candidates
                             where name is not null and btrim(name) <> ''
                             group by lower(btrim(name)) having count(*) > 1) t)
  );
$function$
;

grant delete on table "enger"."account_audits" to "anon";

grant insert on table "enger"."account_audits" to "anon";

grant references on table "enger"."account_audits" to "anon";

grant select on table "enger"."account_audits" to "anon";

grant trigger on table "enger"."account_audits" to "anon";

grant truncate on table "enger"."account_audits" to "anon";

grant update on table "enger"."account_audits" to "anon";

grant delete on table "enger"."account_audits" to "authenticated";

grant insert on table "enger"."account_audits" to "authenticated";

grant references on table "enger"."account_audits" to "authenticated";

grant select on table "enger"."account_audits" to "authenticated";

grant trigger on table "enger"."account_audits" to "authenticated";

grant truncate on table "enger"."account_audits" to "authenticated";

grant update on table "enger"."account_audits" to "authenticated";

grant delete on table "enger"."account_audits" to "service_role";

grant insert on table "enger"."account_audits" to "service_role";

grant references on table "enger"."account_audits" to "service_role";

grant select on table "enger"."account_audits" to "service_role";

grant trigger on table "enger"."account_audits" to "service_role";

grant truncate on table "enger"."account_audits" to "service_role";

grant update on table "enger"."account_audits" to "service_role";

grant delete on table "enger"."account_emails" to "anon";

grant insert on table "enger"."account_emails" to "anon";

grant references on table "enger"."account_emails" to "anon";

grant select on table "enger"."account_emails" to "anon";

grant trigger on table "enger"."account_emails" to "anon";

grant truncate on table "enger"."account_emails" to "anon";

grant update on table "enger"."account_emails" to "anon";

grant delete on table "enger"."account_emails" to "authenticated";

grant insert on table "enger"."account_emails" to "authenticated";

grant references on table "enger"."account_emails" to "authenticated";

grant select on table "enger"."account_emails" to "authenticated";

grant trigger on table "enger"."account_emails" to "authenticated";

grant truncate on table "enger"."account_emails" to "authenticated";

grant update on table "enger"."account_emails" to "authenticated";

grant delete on table "enger"."account_emails" to "service_role";

grant insert on table "enger"."account_emails" to "service_role";

grant references on table "enger"."account_emails" to "service_role";

grant select on table "enger"."account_emails" to "service_role";

grant trigger on table "enger"."account_emails" to "service_role";

grant truncate on table "enger"."account_emails" to "service_role";

grant update on table "enger"."account_emails" to "service_role";

grant delete on table "enger"."ai_usage" to "anon";

grant insert on table "enger"."ai_usage" to "anon";

grant references on table "enger"."ai_usage" to "anon";

grant trigger on table "enger"."ai_usage" to "anon";

grant truncate on table "enger"."ai_usage" to "anon";

grant update on table "enger"."ai_usage" to "anon";

grant delete on table "enger"."ai_usage" to "authenticated";

grant insert on table "enger"."ai_usage" to "authenticated";

grant references on table "enger"."ai_usage" to "authenticated";

grant trigger on table "enger"."ai_usage" to "authenticated";

grant truncate on table "enger"."ai_usage" to "authenticated";

grant update on table "enger"."ai_usage" to "authenticated";

grant delete on table "enger"."app_settings" to "anon";

grant insert on table "enger"."app_settings" to "anon";

grant references on table "enger"."app_settings" to "anon";

grant trigger on table "enger"."app_settings" to "anon";

grant truncate on table "enger"."app_settings" to "anon";

grant update on table "enger"."app_settings" to "anon";

grant delete on table "enger"."app_settings" to "authenticated";

grant insert on table "enger"."app_settings" to "authenticated";

grant references on table "enger"."app_settings" to "authenticated";

grant trigger on table "enger"."app_settings" to "authenticated";

grant truncate on table "enger"."app_settings" to "authenticated";

grant update on table "enger"."app_settings" to "authenticated";

grant delete on table "enger"."app_users" to "anon";

grant insert on table "enger"."app_users" to "anon";

grant references on table "enger"."app_users" to "anon";

grant select on table "enger"."app_users" to "anon";

grant trigger on table "enger"."app_users" to "anon";

grant truncate on table "enger"."app_users" to "anon";

grant update on table "enger"."app_users" to "anon";

grant delete on table "enger"."app_users" to "authenticated";

grant insert on table "enger"."app_users" to "authenticated";

grant references on table "enger"."app_users" to "authenticated";

grant select on table "enger"."app_users" to "authenticated";

grant trigger on table "enger"."app_users" to "authenticated";

grant truncate on table "enger"."app_users" to "authenticated";

grant update on table "enger"."app_users" to "authenticated";

grant delete on table "enger"."applications" to "anon";

grant insert on table "enger"."applications" to "anon";

grant references on table "enger"."applications" to "anon";

grant trigger on table "enger"."applications" to "anon";

grant truncate on table "enger"."applications" to "anon";

grant update on table "enger"."applications" to "anon";

grant delete on table "enger"."applications" to "authenticated";

grant insert on table "enger"."applications" to "authenticated";

grant references on table "enger"."applications" to "authenticated";

grant trigger on table "enger"."applications" to "authenticated";

grant truncate on table "enger"."applications" to "authenticated";

grant update on table "enger"."applications" to "authenticated";

grant delete on table "enger"."billing_tasks" to "anon";

grant insert on table "enger"."billing_tasks" to "anon";

grant references on table "enger"."billing_tasks" to "anon";

grant select on table "enger"."billing_tasks" to "anon";

grant trigger on table "enger"."billing_tasks" to "anon";

grant truncate on table "enger"."billing_tasks" to "anon";

grant update on table "enger"."billing_tasks" to "anon";

grant delete on table "enger"."billing_tasks" to "authenticated";

grant insert on table "enger"."billing_tasks" to "authenticated";

grant references on table "enger"."billing_tasks" to "authenticated";

grant select on table "enger"."billing_tasks" to "authenticated";

grant trigger on table "enger"."billing_tasks" to "authenticated";

grant truncate on table "enger"."billing_tasks" to "authenticated";

grant update on table "enger"."billing_tasks" to "authenticated";

grant delete on table "enger"."candidates" to "anon";

grant insert on table "enger"."candidates" to "anon";

grant references on table "enger"."candidates" to "anon";

grant trigger on table "enger"."candidates" to "anon";

grant truncate on table "enger"."candidates" to "anon";

grant update on table "enger"."candidates" to "anon";

grant delete on table "enger"."candidates" to "authenticated";

grant insert on table "enger"."candidates" to "authenticated";

grant references on table "enger"."candidates" to "authenticated";

grant trigger on table "enger"."candidates" to "authenticated";

grant truncate on table "enger"."candidates" to "authenticated";

grant update on table "enger"."candidates" to "authenticated";

grant delete on table "enger"."client_feedback" to "anon";

grant insert on table "enger"."client_feedback" to "anon";

grant references on table "enger"."client_feedback" to "anon";

grant select on table "enger"."client_feedback" to "anon";

grant trigger on table "enger"."client_feedback" to "anon";

grant truncate on table "enger"."client_feedback" to "anon";

grant update on table "enger"."client_feedback" to "anon";

grant delete on table "enger"."client_feedback" to "authenticated";

grant insert on table "enger"."client_feedback" to "authenticated";

grant references on table "enger"."client_feedback" to "authenticated";

grant select on table "enger"."client_feedback" to "authenticated";

grant trigger on table "enger"."client_feedback" to "authenticated";

grant truncate on table "enger"."client_feedback" to "authenticated";

grant update on table "enger"."client_feedback" to "authenticated";

grant delete on table "enger"."client_feedback" to "service_role";

grant insert on table "enger"."client_feedback" to "service_role";

grant references on table "enger"."client_feedback" to "service_role";

grant select on table "enger"."client_feedback" to "service_role";

grant trigger on table "enger"."client_feedback" to "service_role";

grant truncate on table "enger"."client_feedback" to "service_role";

grant update on table "enger"."client_feedback" to "service_role";

grant delete on table "enger"."companies" to "anon";

grant insert on table "enger"."companies" to "anon";

grant references on table "enger"."companies" to "anon";

grant trigger on table "enger"."companies" to "anon";

grant truncate on table "enger"."companies" to "anon";

grant update on table "enger"."companies" to "anon";

grant delete on table "enger"."companies" to "authenticated";

grant insert on table "enger"."companies" to "authenticated";

grant references on table "enger"."companies" to "authenticated";

grant trigger on table "enger"."companies" to "authenticated";

grant truncate on table "enger"."companies" to "authenticated";

grant update on table "enger"."companies" to "authenticated";

grant delete on table "enger"."company_profiles" to "anon";

grant insert on table "enger"."company_profiles" to "anon";

grant references on table "enger"."company_profiles" to "anon";

grant trigger on table "enger"."company_profiles" to "anon";

grant truncate on table "enger"."company_profiles" to "anon";

grant update on table "enger"."company_profiles" to "anon";

grant delete on table "enger"."company_profiles" to "authenticated";

grant insert on table "enger"."company_profiles" to "authenticated";

grant references on table "enger"."company_profiles" to "authenticated";

grant trigger on table "enger"."company_profiles" to "authenticated";

grant truncate on table "enger"."company_profiles" to "authenticated";

grant update on table "enger"."company_profiles" to "authenticated";

grant delete on table "enger"."contact_messages" to "anon";

grant insert on table "enger"."contact_messages" to "anon";

grant references on table "enger"."contact_messages" to "anon";

grant trigger on table "enger"."contact_messages" to "anon";

grant truncate on table "enger"."contact_messages" to "anon";

grant update on table "enger"."contact_messages" to "anon";

grant delete on table "enger"."contact_messages" to "authenticated";

grant insert on table "enger"."contact_messages" to "authenticated";

grant references on table "enger"."contact_messages" to "authenticated";

grant trigger on table "enger"."contact_messages" to "authenticated";

grant truncate on table "enger"."contact_messages" to "authenticated";

grant update on table "enger"."contact_messages" to "authenticated";

grant delete on table "enger"."daily_reports" to "anon";

grant insert on table "enger"."daily_reports" to "anon";

grant references on table "enger"."daily_reports" to "anon";

grant trigger on table "enger"."daily_reports" to "anon";

grant truncate on table "enger"."daily_reports" to "anon";

grant update on table "enger"."daily_reports" to "anon";

grant delete on table "enger"."daily_reports" to "authenticated";

grant insert on table "enger"."daily_reports" to "authenticated";

grant references on table "enger"."daily_reports" to "authenticated";

grant trigger on table "enger"."daily_reports" to "authenticated";

grant truncate on table "enger"."daily_reports" to "authenticated";

grant update on table "enger"."daily_reports" to "authenticated";

grant delete on table "enger"."document_tasks" to "anon";

grant insert on table "enger"."document_tasks" to "anon";

grant references on table "enger"."document_tasks" to "anon";

grant trigger on table "enger"."document_tasks" to "anon";

grant truncate on table "enger"."document_tasks" to "anon";

grant update on table "enger"."document_tasks" to "anon";

grant delete on table "enger"."document_tasks" to "authenticated";

grant insert on table "enger"."document_tasks" to "authenticated";

grant references on table "enger"."document_tasks" to "authenticated";

grant trigger on table "enger"."document_tasks" to "authenticated";

grant truncate on table "enger"."document_tasks" to "authenticated";

grant update on table "enger"."document_tasks" to "authenticated";

grant delete on table "enger"."engagement_rate_changes" to "anon";

grant insert on table "enger"."engagement_rate_changes" to "anon";

grant references on table "enger"."engagement_rate_changes" to "anon";

grant trigger on table "enger"."engagement_rate_changes" to "anon";

grant truncate on table "enger"."engagement_rate_changes" to "anon";

grant update on table "enger"."engagement_rate_changes" to "anon";

grant delete on table "enger"."engagement_rate_changes" to "authenticated";

grant insert on table "enger"."engagement_rate_changes" to "authenticated";

grant references on table "enger"."engagement_rate_changes" to "authenticated";

grant trigger on table "enger"."engagement_rate_changes" to "authenticated";

grant truncate on table "enger"."engagement_rate_changes" to "authenticated";

grant update on table "enger"."engagement_rate_changes" to "authenticated";

grant delete on table "enger"."engagements" to "anon";

grant insert on table "enger"."engagements" to "anon";

grant references on table "enger"."engagements" to "anon";

grant trigger on table "enger"."engagements" to "anon";

grant truncate on table "enger"."engagements" to "anon";

grant update on table "enger"."engagements" to "anon";

grant delete on table "enger"."engagements" to "authenticated";

grant insert on table "enger"."engagements" to "authenticated";

grant references on table "enger"."engagements" to "authenticated";

grant trigger on table "enger"."engagements" to "authenticated";

grant truncate on table "enger"."engagements" to "authenticated";

grant update on table "enger"."engagements" to "authenticated";

grant delete on table "enger"."engineer_actions" to "anon";

grant insert on table "enger"."engineer_actions" to "anon";

grant references on table "enger"."engineer_actions" to "anon";

grant trigger on table "enger"."engineer_actions" to "anon";

grant truncate on table "enger"."engineer_actions" to "anon";

grant update on table "enger"."engineer_actions" to "anon";

grant delete on table "enger"."engineer_actions" to "authenticated";

grant insert on table "enger"."engineer_actions" to "authenticated";

grant references on table "enger"."engineer_actions" to "authenticated";

grant trigger on table "enger"."engineer_actions" to "authenticated";

grant truncate on table "enger"."engineer_actions" to "authenticated";

grant update on table "enger"."engineer_actions" to "authenticated";

grant delete on table "enger"."job_favorites" to "anon";

grant insert on table "enger"."job_favorites" to "anon";

grant references on table "enger"."job_favorites" to "anon";

grant select on table "enger"."job_favorites" to "anon";

grant trigger on table "enger"."job_favorites" to "anon";

grant truncate on table "enger"."job_favorites" to "anon";

grant update on table "enger"."job_favorites" to "anon";

grant references on table "enger"."job_favorites" to "authenticated";

grant trigger on table "enger"."job_favorites" to "authenticated";

grant truncate on table "enger"."job_favorites" to "authenticated";

grant update on table "enger"."job_favorites" to "authenticated";

grant delete on table "enger"."jobs" to "anon";

grant insert on table "enger"."jobs" to "anon";

grant references on table "enger"."jobs" to "anon";

grant trigger on table "enger"."jobs" to "anon";

grant truncate on table "enger"."jobs" to "anon";

grant update on table "enger"."jobs" to "anon";

grant delete on table "enger"."jobs" to "authenticated";

grant insert on table "enger"."jobs" to "authenticated";

grant references on table "enger"."jobs" to "authenticated";

grant trigger on table "enger"."jobs" to "authenticated";

grant truncate on table "enger"."jobs" to "authenticated";

grant update on table "enger"."jobs" to "authenticated";

grant delete on table "enger"."meetings" to "anon";

grant insert on table "enger"."meetings" to "anon";

grant references on table "enger"."meetings" to "anon";

grant trigger on table "enger"."meetings" to "anon";

grant truncate on table "enger"."meetings" to "anon";

grant update on table "enger"."meetings" to "anon";

grant delete on table "enger"."meetings" to "authenticated";

grant insert on table "enger"."meetings" to "authenticated";

grant references on table "enger"."meetings" to "authenticated";

grant trigger on table "enger"."meetings" to "authenticated";

grant truncate on table "enger"."meetings" to "authenticated";

grant update on table "enger"."meetings" to "authenticated";

grant delete on table "enger"."notifications" to "anon";

grant insert on table "enger"."notifications" to "anon";

grant references on table "enger"."notifications" to "anon";

grant trigger on table "enger"."notifications" to "anon";

grant truncate on table "enger"."notifications" to "anon";

grant update on table "enger"."notifications" to "anon";

grant delete on table "enger"."notifications" to "authenticated";

grant insert on table "enger"."notifications" to "authenticated";

grant references on table "enger"."notifications" to "authenticated";

grant trigger on table "enger"."notifications" to "authenticated";

grant truncate on table "enger"."notifications" to "authenticated";

grant update on table "enger"."notifications" to "authenticated";

grant delete on table "enger"."pr_posts" to "anon";

grant insert on table "enger"."pr_posts" to "anon";

grant references on table "enger"."pr_posts" to "anon";

grant trigger on table "enger"."pr_posts" to "anon";

grant truncate on table "enger"."pr_posts" to "anon";

grant update on table "enger"."pr_posts" to "anon";

grant delete on table "enger"."pr_posts" to "authenticated";

grant insert on table "enger"."pr_posts" to "authenticated";

grant references on table "enger"."pr_posts" to "authenticated";

grant trigger on table "enger"."pr_posts" to "authenticated";

grant truncate on table "enger"."pr_posts" to "authenticated";

grant update on table "enger"."pr_posts" to "authenticated";

grant delete on table "enger"."proposal_memos" to "anon";

grant insert on table "enger"."proposal_memos" to "anon";

grant references on table "enger"."proposal_memos" to "anon";

grant select on table "enger"."proposal_memos" to "anon";

grant trigger on table "enger"."proposal_memos" to "anon";

grant truncate on table "enger"."proposal_memos" to "anon";

grant update on table "enger"."proposal_memos" to "anon";

grant delete on table "enger"."proposal_memos" to "authenticated";

grant insert on table "enger"."proposal_memos" to "authenticated";

grant references on table "enger"."proposal_memos" to "authenticated";

grant select on table "enger"."proposal_memos" to "authenticated";

grant trigger on table "enger"."proposal_memos" to "authenticated";

grant truncate on table "enger"."proposal_memos" to "authenticated";

grant update on table "enger"."proposal_memos" to "authenticated";

grant delete on table "enger"."proposal_memos" to "service_role";

grant insert on table "enger"."proposal_memos" to "service_role";

grant references on table "enger"."proposal_memos" to "service_role";

grant select on table "enger"."proposal_memos" to "service_role";

grant trigger on table "enger"."proposal_memos" to "service_role";

grant truncate on table "enger"."proposal_memos" to "service_role";

grant update on table "enger"."proposal_memos" to "service_role";

grant delete on table "enger"."proposals" to "anon";

grant insert on table "enger"."proposals" to "anon";

grant references on table "enger"."proposals" to "anon";

grant trigger on table "enger"."proposals" to "anon";

grant truncate on table "enger"."proposals" to "anon";

grant update on table "enger"."proposals" to "anon";

grant delete on table "enger"."proposals" to "authenticated";

grant insert on table "enger"."proposals" to "authenticated";

grant references on table "enger"."proposals" to "authenticated";

grant trigger on table "enger"."proposals" to "authenticated";

grant truncate on table "enger"."proposals" to "authenticated";

grant update on table "enger"."proposals" to "authenticated";

grant delete on table "enger"."quality_rules" to "anon";

grant insert on table "enger"."quality_rules" to "anon";

grant references on table "enger"."quality_rules" to "anon";

grant trigger on table "enger"."quality_rules" to "anon";

grant truncate on table "enger"."quality_rules" to "anon";

grant update on table "enger"."quality_rules" to "anon";

grant delete on table "enger"."quality_rules" to "authenticated";

grant insert on table "enger"."quality_rules" to "authenticated";

grant references on table "enger"."quality_rules" to "authenticated";

grant trigger on table "enger"."quality_rules" to "authenticated";

grant truncate on table "enger"."quality_rules" to "authenticated";

grant update on table "enger"."quality_rules" to "authenticated";

grant delete on table "enger"."scouts" to "anon";

grant insert on table "enger"."scouts" to "anon";

grant references on table "enger"."scouts" to "anon";

grant trigger on table "enger"."scouts" to "anon";

grant truncate on table "enger"."scouts" to "anon";

grant update on table "enger"."scouts" to "anon";

grant delete on table "enger"."scouts" to "authenticated";

grant insert on table "enger"."scouts" to "authenticated";

grant references on table "enger"."scouts" to "authenticated";

grant trigger on table "enger"."scouts" to "authenticated";

grant truncate on table "enger"."scouts" to "authenticated";

grant delete on table "enger"."staff" to "anon";

grant insert on table "enger"."staff" to "anon";

grant references on table "enger"."staff" to "anon";

grant trigger on table "enger"."staff" to "anon";

grant truncate on table "enger"."staff" to "anon";

grant update on table "enger"."staff" to "anon";

grant delete on table "enger"."staff" to "authenticated";

grant insert on table "enger"."staff" to "authenticated";

grant references on table "enger"."staff" to "authenticated";

grant trigger on table "enger"."staff" to "authenticated";

grant truncate on table "enger"."staff" to "authenticated";

grant update on table "enger"."staff" to "authenticated";

grant delete on table "enger"."talent_interest" to "anon";

grant insert on table "enger"."talent_interest" to "anon";

grant references on table "enger"."talent_interest" to "anon";

grant trigger on table "enger"."talent_interest" to "anon";

grant truncate on table "enger"."talent_interest" to "anon";

grant update on table "enger"."talent_interest" to "anon";

grant delete on table "enger"."talent_interest" to "authenticated";

grant insert on table "enger"."talent_interest" to "authenticated";

grant references on table "enger"."talent_interest" to "authenticated";

grant trigger on table "enger"."talent_interest" to "authenticated";

grant truncate on table "enger"."talent_interest" to "authenticated";

grant update on table "enger"."talent_interest" to "authenticated";

grant delete on table "lms"."assignments" to "anon";

grant insert on table "lms"."assignments" to "anon";

grant references on table "lms"."assignments" to "anon";

grant select on table "lms"."assignments" to "anon";

grant trigger on table "lms"."assignments" to "anon";

grant truncate on table "lms"."assignments" to "anon";

grant update on table "lms"."assignments" to "anon";

grant delete on table "lms"."assignments" to "authenticated";

grant insert on table "lms"."assignments" to "authenticated";

grant references on table "lms"."assignments" to "authenticated";

grant select on table "lms"."assignments" to "authenticated";

grant trigger on table "lms"."assignments" to "authenticated";

grant truncate on table "lms"."assignments" to "authenticated";

grant update on table "lms"."assignments" to "authenticated";

grant delete on table "lms"."assignments" to "service_role";

grant insert on table "lms"."assignments" to "service_role";

grant references on table "lms"."assignments" to "service_role";

grant select on table "lms"."assignments" to "service_role";

grant trigger on table "lms"."assignments" to "service_role";

grant truncate on table "lms"."assignments" to "service_role";

grant update on table "lms"."assignments" to "service_role";

grant delete on table "lms"."courses" to "anon";

grant insert on table "lms"."courses" to "anon";

grant references on table "lms"."courses" to "anon";

grant select on table "lms"."courses" to "anon";

grant trigger on table "lms"."courses" to "anon";

grant truncate on table "lms"."courses" to "anon";

grant update on table "lms"."courses" to "anon";

grant delete on table "lms"."courses" to "authenticated";

grant insert on table "lms"."courses" to "authenticated";

grant references on table "lms"."courses" to "authenticated";

grant select on table "lms"."courses" to "authenticated";

grant trigger on table "lms"."courses" to "authenticated";

grant truncate on table "lms"."courses" to "authenticated";

grant update on table "lms"."courses" to "authenticated";

grant delete on table "lms"."courses" to "service_role";

grant insert on table "lms"."courses" to "service_role";

grant references on table "lms"."courses" to "service_role";

grant select on table "lms"."courses" to "service_role";

grant trigger on table "lms"."courses" to "service_role";

grant truncate on table "lms"."courses" to "service_role";

grant update on table "lms"."courses" to "service_role";

grant delete on table "lms"."enrollments" to "anon";

grant insert on table "lms"."enrollments" to "anon";

grant references on table "lms"."enrollments" to "anon";

grant select on table "lms"."enrollments" to "anon";

grant trigger on table "lms"."enrollments" to "anon";

grant truncate on table "lms"."enrollments" to "anon";

grant update on table "lms"."enrollments" to "anon";

grant delete on table "lms"."enrollments" to "authenticated";

grant insert on table "lms"."enrollments" to "authenticated";

grant references on table "lms"."enrollments" to "authenticated";

grant select on table "lms"."enrollments" to "authenticated";

grant trigger on table "lms"."enrollments" to "authenticated";

grant truncate on table "lms"."enrollments" to "authenticated";

grant update on table "lms"."enrollments" to "authenticated";

grant delete on table "lms"."enrollments" to "service_role";

grant insert on table "lms"."enrollments" to "service_role";

grant references on table "lms"."enrollments" to "service_role";

grant select on table "lms"."enrollments" to "service_role";

grant trigger on table "lms"."enrollments" to "service_role";

grant truncate on table "lms"."enrollments" to "service_role";

grant update on table "lms"."enrollments" to "service_role";

grant delete on table "lms"."lesson_progress" to "anon";

grant insert on table "lms"."lesson_progress" to "anon";

grant references on table "lms"."lesson_progress" to "anon";

grant select on table "lms"."lesson_progress" to "anon";

grant trigger on table "lms"."lesson_progress" to "anon";

grant truncate on table "lms"."lesson_progress" to "anon";

grant update on table "lms"."lesson_progress" to "anon";

grant delete on table "lms"."lesson_progress" to "authenticated";

grant insert on table "lms"."lesson_progress" to "authenticated";

grant references on table "lms"."lesson_progress" to "authenticated";

grant select on table "lms"."lesson_progress" to "authenticated";

grant trigger on table "lms"."lesson_progress" to "authenticated";

grant truncate on table "lms"."lesson_progress" to "authenticated";

grant update on table "lms"."lesson_progress" to "authenticated";

grant delete on table "lms"."lesson_progress" to "service_role";

grant insert on table "lms"."lesson_progress" to "service_role";

grant references on table "lms"."lesson_progress" to "service_role";

grant select on table "lms"."lesson_progress" to "service_role";

grant trigger on table "lms"."lesson_progress" to "service_role";

grant truncate on table "lms"."lesson_progress" to "service_role";

grant update on table "lms"."lesson_progress" to "service_role";

grant delete on table "lms"."lessons" to "anon";

grant insert on table "lms"."lessons" to "anon";

grant references on table "lms"."lessons" to "anon";

grant select on table "lms"."lessons" to "anon";

grant trigger on table "lms"."lessons" to "anon";

grant truncate on table "lms"."lessons" to "anon";

grant update on table "lms"."lessons" to "anon";

grant delete on table "lms"."lessons" to "authenticated";

grant insert on table "lms"."lessons" to "authenticated";

grant references on table "lms"."lessons" to "authenticated";

grant select on table "lms"."lessons" to "authenticated";

grant trigger on table "lms"."lessons" to "authenticated";

grant truncate on table "lms"."lessons" to "authenticated";

grant update on table "lms"."lessons" to "authenticated";

grant delete on table "lms"."lessons" to "service_role";

grant insert on table "lms"."lessons" to "service_role";

grant references on table "lms"."lessons" to "service_role";

grant select on table "lms"."lessons" to "service_role";

grant trigger on table "lms"."lessons" to "service_role";

grant truncate on table "lms"."lessons" to "service_role";

grant update on table "lms"."lessons" to "service_role";

grant delete on table "lms"."portfolio_items" to "anon";

grant insert on table "lms"."portfolio_items" to "anon";

grant references on table "lms"."portfolio_items" to "anon";

grant select on table "lms"."portfolio_items" to "anon";

grant trigger on table "lms"."portfolio_items" to "anon";

grant truncate on table "lms"."portfolio_items" to "anon";

grant update on table "lms"."portfolio_items" to "anon";

grant delete on table "lms"."portfolio_items" to "authenticated";

grant insert on table "lms"."portfolio_items" to "authenticated";

grant references on table "lms"."portfolio_items" to "authenticated";

grant select on table "lms"."portfolio_items" to "authenticated";

grant trigger on table "lms"."portfolio_items" to "authenticated";

grant truncate on table "lms"."portfolio_items" to "authenticated";

grant update on table "lms"."portfolio_items" to "authenticated";

grant delete on table "lms"."portfolio_items" to "service_role";

grant insert on table "lms"."portfolio_items" to "service_role";

grant references on table "lms"."portfolio_items" to "service_role";

grant select on table "lms"."portfolio_items" to "service_role";

grant trigger on table "lms"."portfolio_items" to "service_role";

grant truncate on table "lms"."portfolio_items" to "service_role";

grant update on table "lms"."portfolio_items" to "service_role";

grant delete on table "lms"."sprints" to "anon";

grant insert on table "lms"."sprints" to "anon";

grant references on table "lms"."sprints" to "anon";

grant select on table "lms"."sprints" to "anon";

grant trigger on table "lms"."sprints" to "anon";

grant truncate on table "lms"."sprints" to "anon";

grant update on table "lms"."sprints" to "anon";

grant delete on table "lms"."sprints" to "authenticated";

grant insert on table "lms"."sprints" to "authenticated";

grant references on table "lms"."sprints" to "authenticated";

grant select on table "lms"."sprints" to "authenticated";

grant trigger on table "lms"."sprints" to "authenticated";

grant truncate on table "lms"."sprints" to "authenticated";

grant update on table "lms"."sprints" to "authenticated";

grant delete on table "lms"."sprints" to "service_role";

grant insert on table "lms"."sprints" to "service_role";

grant references on table "lms"."sprints" to "service_role";

grant select on table "lms"."sprints" to "service_role";

grant trigger on table "lms"."sprints" to "service_role";

grant truncate on table "lms"."sprints" to "service_role";

grant update on table "lms"."sprints" to "service_role";

grant delete on table "lms"."submissions" to "anon";

grant insert on table "lms"."submissions" to "anon";

grant references on table "lms"."submissions" to "anon";

grant select on table "lms"."submissions" to "anon";

grant trigger on table "lms"."submissions" to "anon";

grant truncate on table "lms"."submissions" to "anon";

grant update on table "lms"."submissions" to "anon";

grant delete on table "lms"."submissions" to "authenticated";

grant insert on table "lms"."submissions" to "authenticated";

grant references on table "lms"."submissions" to "authenticated";

grant select on table "lms"."submissions" to "authenticated";

grant trigger on table "lms"."submissions" to "authenticated";

grant truncate on table "lms"."submissions" to "authenticated";

grant update on table "lms"."submissions" to "authenticated";

grant delete on table "lms"."submissions" to "service_role";

grant insert on table "lms"."submissions" to "service_role";

grant references on table "lms"."submissions" to "service_role";

grant select on table "lms"."submissions" to "service_role";

grant trigger on table "lms"."submissions" to "service_role";

grant truncate on table "lms"."submissions" to "service_role";

grant update on table "lms"."submissions" to "service_role";

grant delete on table "public"."ai_chat_messages" to "anon";

grant insert on table "public"."ai_chat_messages" to "anon";

grant references on table "public"."ai_chat_messages" to "anon";

grant select on table "public"."ai_chat_messages" to "anon";

grant trigger on table "public"."ai_chat_messages" to "anon";

grant truncate on table "public"."ai_chat_messages" to "anon";

grant update on table "public"."ai_chat_messages" to "anon";

grant delete on table "public"."ai_chat_messages" to "authenticated";

grant insert on table "public"."ai_chat_messages" to "authenticated";

grant references on table "public"."ai_chat_messages" to "authenticated";

grant select on table "public"."ai_chat_messages" to "authenticated";

grant trigger on table "public"."ai_chat_messages" to "authenticated";

grant truncate on table "public"."ai_chat_messages" to "authenticated";

grant update on table "public"."ai_chat_messages" to "authenticated";

grant delete on table "public"."ai_chat_messages" to "service_role";

grant insert on table "public"."ai_chat_messages" to "service_role";

grant references on table "public"."ai_chat_messages" to "service_role";

grant select on table "public"."ai_chat_messages" to "service_role";

grant trigger on table "public"."ai_chat_messages" to "service_role";

grant truncate on table "public"."ai_chat_messages" to "service_role";

grant update on table "public"."ai_chat_messages" to "service_role";

grant delete on table "public"."ai_chat_usage" to "anon";

grant insert on table "public"."ai_chat_usage" to "anon";

grant references on table "public"."ai_chat_usage" to "anon";

grant select on table "public"."ai_chat_usage" to "anon";

grant trigger on table "public"."ai_chat_usage" to "anon";

grant truncate on table "public"."ai_chat_usage" to "anon";

grant update on table "public"."ai_chat_usage" to "anon";

grant delete on table "public"."ai_chat_usage" to "authenticated";

grant insert on table "public"."ai_chat_usage" to "authenticated";

grant references on table "public"."ai_chat_usage" to "authenticated";

grant select on table "public"."ai_chat_usage" to "authenticated";

grant trigger on table "public"."ai_chat_usage" to "authenticated";

grant truncate on table "public"."ai_chat_usage" to "authenticated";

grant update on table "public"."ai_chat_usage" to "authenticated";

grant delete on table "public"."ai_chat_usage" to "service_role";

grant insert on table "public"."ai_chat_usage" to "service_role";

grant references on table "public"."ai_chat_usage" to "service_role";

grant select on table "public"."ai_chat_usage" to "service_role";

grant trigger on table "public"."ai_chat_usage" to "service_role";

grant truncate on table "public"."ai_chat_usage" to "service_role";

grant update on table "public"."ai_chat_usage" to "service_role";

grant delete on table "public"."invites" to "anon";

grant insert on table "public"."invites" to "anon";

grant references on table "public"."invites" to "anon";

grant select on table "public"."invites" to "anon";

grant trigger on table "public"."invites" to "anon";

grant truncate on table "public"."invites" to "anon";

grant update on table "public"."invites" to "anon";

grant delete on table "public"."invites" to "authenticated";

grant insert on table "public"."invites" to "authenticated";

grant references on table "public"."invites" to "authenticated";

grant select on table "public"."invites" to "authenticated";

grant trigger on table "public"."invites" to "authenticated";

grant truncate on table "public"."invites" to "authenticated";

grant update on table "public"."invites" to "authenticated";

grant delete on table "public"."invites" to "service_role";

grant insert on table "public"."invites" to "service_role";

grant references on table "public"."invites" to "service_role";

grant select on table "public"."invites" to "service_role";

grant trigger on table "public"."invites" to "service_role";

grant truncate on table "public"."invites" to "service_role";

grant update on table "public"."invites" to "service_role";

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant references on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant trigger on table "public"."notifications" to "anon";

grant truncate on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant references on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant trigger on table "public"."notifications" to "authenticated";

grant truncate on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant references on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant trigger on table "public"."notifications" to "service_role";

grant truncate on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."skill_levels" to "anon";

grant insert on table "public"."skill_levels" to "anon";

grant references on table "public"."skill_levels" to "anon";

grant select on table "public"."skill_levels" to "anon";

grant trigger on table "public"."skill_levels" to "anon";

grant truncate on table "public"."skill_levels" to "anon";

grant update on table "public"."skill_levels" to "anon";

grant delete on table "public"."skill_levels" to "authenticated";

grant insert on table "public"."skill_levels" to "authenticated";

grant references on table "public"."skill_levels" to "authenticated";

grant select on table "public"."skill_levels" to "authenticated";

grant trigger on table "public"."skill_levels" to "authenticated";

grant truncate on table "public"."skill_levels" to "authenticated";

grant update on table "public"."skill_levels" to "authenticated";

grant delete on table "public"."skill_levels" to "service_role";

grant insert on table "public"."skill_levels" to "service_role";

grant references on table "public"."skill_levels" to "service_role";

grant select on table "public"."skill_levels" to "service_role";

grant trigger on table "public"."skill_levels" to "service_role";

grant truncate on table "public"."skill_levels" to "service_role";

grant update on table "public"."skill_levels" to "service_role";


  create policy "jobs_read_published"
  on "enger"."jobs"
  as permissive
  for select
  to public
using (true);



  create policy "jobs_write_staff"
  on "enger"."jobs"
  as permissive
  for all
  to public
using ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role]))))))
with check ((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role]))))));



  create policy "instructor/admin manage assignments"
  on "lms"."assignments"
  as permissive
  for all
  to public
using (((public.current_user_role() = 'admin'::public.user_role) OR (EXISTS ( SELECT 1
   FROM (lms.sprints s
     JOIN lms.courses c ON ((c.id = s.course_id)))
  WHERE ((s.id = assignments.sprint_id) AND (c.instructor_id = auth.uid()))))));



  create policy "lms_assignments_read"
  on "lms"."assignments"
  as permissive
  for select
  to public
using (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role]))))) OR (EXISTS ( SELECT 1
   FROM (lms.sprints s
     JOIN lms.enrollments e ON ((e.course_id = s.course_id)))
  WHERE ((s.id = assignments.sprint_id) AND (e.user_id = auth.uid()))))));



  create policy "view assignments if enrolled or instructor/admin"
  on "lms"."assignments"
  as permissive
  for select
  to public
using (((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])) OR (EXISTS ( SELECT 1
   FROM (lms.sprints s
     JOIN lms.enrollments e ON ((e.course_id = s.course_id)))
  WHERE ((s.id = assignments.sprint_id) AND (e.user_id = auth.uid()))))));



  create policy "admins can do anything on courses"
  on "lms"."courses"
  as permissive
  for all
  to public
using ((public.current_user_role() = 'admin'::public.user_role));



  create policy "anyone authenticated can view published courses"
  on "lms"."courses"
  as permissive
  for select
  to authenticated
using ((is_published = true));



  create policy "instructors can manage own courses"
  on "lms"."courses"
  as permissive
  for all
  to public
using ((instructor_id = auth.uid()));



  create policy "instructors can view own courses"
  on "lms"."courses"
  as permissive
  for select
  to public
using ((instructor_id = auth.uid()));



  create policy "admins manage enrollments"
  on "lms"."enrollments"
  as permissive
  for all
  to public
using ((public.current_user_role() = 'admin'::public.user_role));



  create policy "instructor/admin view all enrollments"
  on "lms"."enrollments"
  as permissive
  for select
  to public
using ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])));



  create policy "users view own enrollments"
  on "lms"."enrollments"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "instructor/admin view all progress"
  on "lms"."lesson_progress"
  as permissive
  for select
  to public
using ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])));



  create policy "users manage own progress"
  on "lms"."lesson_progress"
  as permissive
  for all
  to public
using ((user_id = auth.uid()));



  create policy "instructor/admin manage lessons"
  on "lms"."lessons"
  as permissive
  for all
  to public
using (((public.current_user_role() = 'admin'::public.user_role) OR (EXISTS ( SELECT 1
   FROM (lms.sprints s
     JOIN lms.courses c ON ((c.id = s.course_id)))
  WHERE ((s.id = lessons.sprint_id) AND (c.instructor_id = auth.uid()))))));



  create policy "lms_lessons_read"
  on "lms"."lessons"
  as permissive
  for select
  to public
using (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role]))))) OR (EXISTS ( SELECT 1
   FROM (lms.sprints s
     JOIN lms.enrollments e ON ((e.course_id = s.course_id)))
  WHERE ((s.id = lessons.sprint_id) AND (e.user_id = auth.uid()))))));



  create policy "view lessons if enrolled or instructor/admin"
  on "lms"."lessons"
  as permissive
  for select
  to public
using (((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])) OR (EXISTS ( SELECT 1
   FROM (lms.sprints s
     JOIN lms.enrollments e ON ((e.course_id = s.course_id)))
  WHERE ((s.id = lessons.sprint_id) AND (e.user_id = auth.uid()))))));



  create policy "instructor/admin view portfolios"
  on "lms"."portfolio_items"
  as permissive
  for select
  to public
using ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])));



  create policy "users manage own portfolio"
  on "lms"."portfolio_items"
  as permissive
  for all
  to public
using ((user_id = auth.uid()));



  create policy "instructor/admin manage sprints"
  on "lms"."sprints"
  as permissive
  for all
  to public
using (((public.current_user_role() = 'admin'::public.user_role) OR (EXISTS ( SELECT 1
   FROM lms.courses c
  WHERE ((c.id = sprints.course_id) AND (c.instructor_id = auth.uid()))))));



  create policy "lms_sprints_read"
  on "lms"."sprints"
  as permissive
  for select
  to public
using (((EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role]))))) OR (EXISTS ( SELECT 1
   FROM lms.enrollments e
  WHERE ((e.course_id = sprints.course_id) AND (e.user_id = auth.uid()))))));



  create policy "view sprints if enrolled or instructor/admin"
  on "lms"."sprints"
  as permissive
  for select
  to public
using (((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])) OR (EXISTS ( SELECT 1
   FROM lms.enrollments e
  WHERE ((e.course_id = sprints.course_id) AND (e.user_id = auth.uid()))))));



  create policy "instructor/admin grade submissions"
  on "lms"."submissions"
  as permissive
  for update
  to public
using ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])));



  create policy "instructor/admin view all submissions"
  on "lms"."submissions"
  as permissive
  for select
  to public
using ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])));



  create policy "users manage own submissions"
  on "lms"."submissions"
  as permissive
  for all
  to public
using ((user_id = auth.uid()));



  create policy "admins view all ai messages"
  on "public"."ai_chat_messages"
  as permissive
  for select
  to public
using ((public.current_user_role() = 'admin'::public.user_role));



  create policy "users manage own ai messages"
  on "public"."ai_chat_messages"
  as permissive
  for all
  to public
using ((user_id = auth.uid()));



  create policy "admins view all ai usage"
  on "public"."ai_chat_usage"
  as permissive
  for select
  to public
using ((public.current_user_role() = 'admin'::public.user_role));



  create policy "users view own ai usage"
  on "public"."ai_chat_usage"
  as permissive
  for select
  to public
using ((user_id = auth.uid()));



  create policy "invites_admin_all"
  on "public"."invites"
  as permissive
  for all
  to public
using (public.is_admin())
with check (public.is_admin());



  create policy "system/admin insert notifications"
  on "public"."notifications"
  as permissive
  for insert
  to public
with check (((public.current_user_role() = 'admin'::public.user_role) OR (user_id = auth.uid())));



  create policy "users view/update own notifications"
  on "public"."notifications"
  as permissive
  for all
  to public
using ((user_id = auth.uid()));



  create policy "admins and instructors can view all profiles"
  on "public"."profiles"
  as permissive
  for select
  to public
using ((public.current_user_role() = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])));



  create policy "admins can update any profile"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((public.current_user_role() = 'admin'::public.user_role));



  create policy "profiles_admin_select"
  on "public"."profiles"
  as permissive
  for select
  to public
using (public.is_admin());



  create policy "profiles_admin_update"
  on "public"."profiles"
  as permissive
  for update
  to public
using (public.is_admin())
with check (public.is_admin());



  create policy "profiles_select_own"
  on "public"."profiles"
  as permissive
  for select
  to public
using ((auth.uid() = id));



  create policy "profiles_update_own"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((auth.uid() = id))
with check ((auth.uid() = id));



  create policy "users can update own profile"
  on "public"."profiles"
  as permissive
  for update
  to public
using ((auth.uid() = id));



  create policy "users can view own profile"
  on "public"."profiles"
  as permissive
  for select
  to public
using ((auth.uid() = id));



  create policy "skill_levels_modify_own"
  on "public"."skill_levels"
  as permissive
  for all
  to public
using ((auth.uid() = user_id))
with check ((auth.uid() = user_id));



  create policy "skill_levels_select_own"
  on "public"."skill_levels"
  as permissive
  for select
  to public
using (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.profiles p
  WHERE ((p.id = auth.uid()) AND (p.role = ANY (ARRAY['admin'::public.user_role, 'instructor'::public.user_role])))))));


CREATE TRIGGER assignments_updated_at BEFORE UPDATE ON lms.assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER courses_updated_at BEFORE UPDATE ON lms.courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER lessons_updated_at BEFORE UPDATE ON lms.lessons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER portfolio_items_updated_at BEFORE UPDATE ON lms.portfolio_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sprints_updated_at BEFORE UPDATE ON lms.sprints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER submissions_updated_at BEFORE UPDATE ON lms.submissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "skillsheets insert"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check ((bucket_id = 'skillsheets'::text));



  create policy "skillsheets read"
  on "storage"."objects"
  as permissive
  for select
  to public
using ((bucket_id = 'skillsheets'::text));



