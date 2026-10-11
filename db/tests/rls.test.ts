// Row-level security tests against a throwaway local Postgres 16.
// Run: npm run test:db   (needs initdb/pg_ctl on PATH or PG_BIN set)
// It stubs the small part of Supabase's auth schema the migration uses.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import pg from 'pg'

const BIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin'
const PORT = 54329
const dir = mkdtempSync(join(tmpdir(), 'lp-pg-'))
// Postgres refuses to run as root; in containers, drop to the postgres user.
const asRoot = process.getuid?.() === 0
if (asRoot) {
  chmodSync(dir, 0o777)
  execFileSync('chown', ['postgres', dir])
}
// stdio is ignored so the server process does not keep our pipes open.
const run = (cmd: string, args: string[]) =>
  asRoot ? execFileSync('runuser', ['-u', 'postgres', '--', join(BIN, cmd), ...args], { stdio: 'ignore' }) : execFileSync(join(BIN, cmd), args, { stdio: 'ignore' })

const STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

let failures = 0
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`)
  }
}

async function main() {
  run('initdb', ['-D', dir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8'])
  run('pg_ctl', ['-D', dir, '-l', join(dir, 'server.log'), '-o', `-p ${PORT} -k ${dir} -c listen_addresses=''`, '-w', 'start'])
  const db = new pg.Client({ host: dir, port: PORT, user: 'postgres', database: 'postgres' })
  await db.connect()
  try {
    await db.query(STUB)
    for (const f of readdirSync('supabase/migrations').sort()) await db.query(readFileSync(join('supabase/migrations', f), 'utf8'))
    // Supabase grants table privileges to service_role by default.
    await db.query('grant all on all tables in schema public to service_role')
    await db.query(`insert into auth.users (id) values ('${A}'), ('${B}')`)

    const as = async <T,>(uid: string | null, fn: () => Promise<T>, role = 'authenticated'): Promise<T> => {
      await db.query('begin')
      try {
        await db.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [uid ?? '', role])
        await db.query(`set local role ${role}`)
        const r = await fn()
        await db.query('commit')
        return r
      } catch (e) {
        await db.query('rollback')
        throw e
      }
    }

    console.log('RLS')
    let taskA = ''
    await test('a user can create and read their own task; user_id is forced', async () => {
      const r = await as(A, () => db.query(`insert into public.tasks (title, user_id) values ('A task', '${B}') returning id, user_id`))
      taskA = r.rows[0].id
      assert.equal(r.rows[0].user_id, A)
      const read = await as(A, () => db.query('select id from public.tasks'))
      assert.equal(read.rowCount, 1)
    })

    await test("another user cannot see, update or delete it", async () => {
      const read = await as(B, () => db.query('select id from public.tasks'))
      assert.equal(read.rowCount, 0)
      const upd = await as(B, () => db.query(`update public.tasks set title = 'hacked' where id = $1`, [taskA]))
      assert.equal(upd.rowCount, 0)
      const del = await as(B, () => db.query(`delete from public.tasks where id = $1`, [taskA]))
      assert.equal(del.rowCount, 0)
    })

    await test('user_id cannot be moved to someone else', async () => {
      await assert.rejects(as(A, () => db.query(`update public.tasks set user_id = '${B}' where id = $1`, [taskA])))
    })

    await test("cannot link to another user's rows by guessing ids", async () => {
      await assert.rejects(as(B, () => db.query(`insert into public.task_occurrences (task_id, occurrence_date, status) values ($1, '2026-10-12', 'done')`, [taskA])), /linked record not found/)
      await assert.rejects(as(B, () => db.query(`insert into public.tasks (title, parent_id) values ('child', $1)`, [taskA])), /linked record not found/)
    })

    await test('anonymous visitors have no access', async () => {
      await assert.rejects(as(null, () => db.query('select id from public.tasks'), 'anon'), /permission denied/)
    })

    await test('every public table has RLS enabled and forced', async () => {
      const r = await db.query(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)`)
      assert.deepEqual(r.rows.map((x) => x.relname), [])
    })

    await test('the service role can write rows for a user (push function)', async () => {
      const r = await as(null, () => db.query(`insert into public.notification_log (user_id, channel, title, status) values ('${A}', 'push', 'x', 'delivered') returning user_id`), 'service_role')
      assert.equal(r.rows[0].user_id, A)
    })

    await test('delete_my_account removes the user and cascades their data', async () => {
      await as(A, () => db.query('select public.delete_my_account()'))
      const left = await db.query(`select count(*)::int as n from public.tasks where user_id = '${A}'`)
      assert.equal(left.rows[0].n, 0)
      const users = await db.query(`select count(*)::int as n from auth.users where id = '${A}'`)
      assert.equal(users.rows[0].n, 0)
    })
  } finally {
    await db.end()
    run('pg_ctl', ['-D', dir, '-m', 'immediate', 'stop'])
    rmSync(dir, { recursive: true, force: true })
  }
  if (failures) {
    console.log(`\n${failures} failed`)
    process.exit(1)
  }
  console.log('\nAll database tests passed')
}

main().catch((e) => {
  console.error(e)
  try {
    run('pg_ctl', ['-D', dir, '-m', 'immediate', 'stop'])
  } catch {
    /* not running */
  }
  process.exit(1)
})
