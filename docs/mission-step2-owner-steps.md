# Mission page, step 2: what Saurabh does himself (after the page is live)

No helper creates accounts or adds rows. You do these two things, in Supabase,
yourself. Nothing here sends an email.

## 1. Create your sign-in account

1. Supabase, this project, Authentication, Users.
2. **Add user**, then **Create new user** (not "Send invitation": that sends an email).
3. Type your email and a long password. Tick "Auto Confirm User".
4. Copy the account's **User UID** (a long code with dashes). Below it is `<your-user-id>`.

## 2. Add yourself as the admin

Open the SQL editor, paste these lines, put your User UID in both places, press Run:

```sql
begin;
select set_config('mission.actor', '<your-user-id>', true);
insert into public.mission_member (user_id, role) values ('<your-user-id>', 'admin');
commit;
```

Then open the Mission page and sign in. You should see "You are signed in" and the role "Admin".
Nobody else can sign in until you add them the same way in a later step.

## Switching someone back on after they withdraw

"Withdraw my consent" only switches off that person's own access. To switch them back on
(only when they ask), run, with their User UID:

```sql
begin;
select set_config('mission.actor', '<your-user-id>', true);
update public.mission_member set active = true where user_id = '<their-user-id>';
commit;
```

## If you lose your password

Reset it in Supabase (Authentication, Users, the account). There is no "forgot password" link on the page.
