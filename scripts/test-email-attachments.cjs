// node --test scripts/test-email-attachments.cjs
// Optional PostgreSQL checks: set MAIL_MERGE_TEST_DEPS to a temporary package
// directory containing @electric-sql/pglite@0.5.8 (also used by test-mail-merge.cjs).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');

const expectedDocuments = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
const existingImages = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
const schema = readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8');
const bucketSql = schema.match(/insert into storage\.buckets\s*\([^;]+?\)\s*values\s*\(\s*'survey-uploads'[\s\S]*?;/)?.[0];
const migrationPath = path.join(__dirname, '../supabase/email-attachments.sql');
const extra = process.env.MAIL_MERGE_TEST_DEPS ? createRequire(path.join(process.env.MAIL_MERGE_TEST_DEPS, 'package.json')) : null;

test('fresh upload bucket accepts PowerPoint, Office documents and existing image formats', () => {
  assert.ok(bucketSql, 'survey-uploads bucket configuration is present in schema.sql');
  for (const mime of [...existingImages, ...expectedDocuments]) assert.ok(bucketSql.includes(`'${mime}'`), `fresh bucket accepts ${mime}`);
});

test('attachment MIME migration is additive, repeatable and preserves storage settings and policies', { skip: !extra }, async () => {
  const { PGlite } = extra('@electric-sql/pglite');
  const db = new PGlite();
  const migration = readFileSync(migrationPath, 'utf8');
  try {
    await db.exec(`
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id text primary key, bucket_id text);
      alter table storage.objects enable row level security;
      create policy "existing upload policy" on storage.objects for insert with check (bucket_id = 'survey-uploads');
    `);
    const originalMimes = [...existingImages, 'application/x-project-custom'];
    await db.query('insert into storage.buckets values ($1,$2,$3,$4,$5), ($6,$7,$8,$9,$10)', [
      'survey-uploads', 'Custom upload name', false, 1234567, originalMimes,
      'other-uploads', 'Other bucket', true, 7654321, ['image/png'],
    ]);
    const queryBuckets = async () => (await db.query('select * from storage.buckets order by id')).rows;
    const queryPolicies = async () => (await db.query("select policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname='storage' order by policyname")).rows;
    const before = await queryBuckets();
    const policies = await queryPolicies();
    await db.exec(migration);
    const first = await queryBuckets();
    assert.deepEqual(first[0], before[0], 'unrelated bucket is unchanged');
    assert.deepEqual({ ...first[1], allowed_mime_types: before[1].allowed_mime_types }, before[1], 'name, visibility and custom size limit are unchanged');
    assert.deepEqual(new Set(first[1].allowed_mime_types), new Set([...originalMimes, ...expectedDocuments]), 'new types are added without dropping existing or custom formats');
    await db.exec(migration);
    assert.deepEqual(await queryBuckets(), first, 'rerunning migration does not change configuration');
    assert.deepEqual(await queryPolicies(), policies, 'existing storage policies are unchanged');

    await db.query("update storage.buckets set allowed_mime_types=null where id='survey-uploads'");
    const unrestricted = await queryBuckets();
    await db.exec(migration);
    assert.deepEqual(await queryBuckets(), unrestricted, 'NULL continues to mean unrestricted MIME types');

    await db.query("update storage.buckets set allowed_mime_types='{}' where id='survey-uploads'");
    await db.exec(migration);
    const empty = (await queryBuckets())[1];
    assert.deepEqual(new Set(empty.allowed_mime_types), new Set(expectedDocuments), 'an empty allowlist gets supported documents without enabling all types');

    await db.exec('delete from storage.buckets');
    await db.exec(bucketSql);
    const fresh = (await queryBuckets())[0];
    assert.equal(fresh.id, 'survey-uploads');
    assert.equal(fresh.public, true);
    assert.equal(Number(fresh.file_size_limit), 10 * 1024 * 1024);
    assert.deepEqual(new Set(fresh.allowed_mime_types), new Set([...existingImages, ...expectedDocuments]));
  } finally {
    await db.close();
  }
});
