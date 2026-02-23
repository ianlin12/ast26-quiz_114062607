#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Load .env if present
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        const val = trimmed.slice(eqIdx + 1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const SITE_API_URL = process.env.SITE_API_URL;
const QUIZ_PUSH_TOKEN = process.env.QUIZ_PUSH_TOKEN;

if (!SITE_API_URL || !QUIZ_PUSH_TOKEN) {
  console.error('SITE_API_URL and QUIZ_PUSH_TOKEN must be set');
  process.exit(1);
}

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--fix') {
  console.error('Usage: node scripts/reconcile.js --check | --fix');
  process.exit(1);
}

const doFix = mode === '--fix';

function deepSortKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(deepSortKeys);
  }
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = deepSortKeys(obj[key]);
    }
    return sorted;
  }
  return obj;
}

function contentHash(data) {
  const canonical = JSON.stringify(deepSortKeys(data));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function apiRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SITE_API_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        'Authorization': `Bearer ${QUIZ_PUSH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function findQuizFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findQuizFiles(fullPath));
    } else if (entry.name.startsWith('q-') && entry.name.endsWith('.yaml')) {
      results.push(fullPath);
    }
  }
  return results;
}

async function main() {
  const docsDir = path.join(repoRoot, 'docs');

  // 1. Glob all quiz files in repo
  const quizFiles = findQuizFiles(docsDir);
  const repoQuizzes = new Map();

  for (const filePath of quizFiles) {
    const relPath = path.relative(repoRoot, filePath);
    const parts = relPath.split(path.sep);
    const docsIdx = parts.indexOf('docs');
    const pillar = parts[docsIdx + 1];
    const concept = parts[docsIdx + 2];
    const filename = parts[parts.length - 1];

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const data = yaml.load(content);
      // Normalize date for hashing
      if (data.date instanceof Date) {
        data.date = data.date.toISOString().split('T')[0];
      }
      const hash = contentHash(data);
      const key = `${concept}/${filename}`;
      repoQuizzes.set(key, { pillar, concept, filename, data, hash, filePath: relPath });
    } catch (err) {
      console.error(`Warning: failed to parse ${relPath}: ${err.message}`);
    }
  }

  // 2. Fetch DB status
  let dbQuizzes;
  try {
    const res = await apiRequest('GET', '/api/quiz/sync/status');
    if (res.status !== 200) {
      console.error(`Failed to fetch sync status: ${res.status} ${res.body}`);
      process.exit(1);
    }
    const parsed = JSON.parse(res.body);
    dbQuizzes = new Map();
    for (const q of parsed.quizzes) {
      const key = `${q.concept}/${q.filename}`;
      dbQuizzes.set(key, q);
    }
  } catch (err) {
    console.error(`Failed to fetch sync status: ${err.message}`);
    process.exit(1);
  }

  // 3. Compare
  const missingFromDb = [];
  const contentMismatch = [];
  const orphanedInDb = [];
  const inSync = [];

  for (const [key, repo] of repoQuizzes) {
    const db = dbQuizzes.get(key);
    if (!db) {
      missingFromDb.push(repo);
    } else if (db.content_hash !== repo.hash) {
      contentMismatch.push(repo);
    } else {
      inSync.push(repo);
    }
  }

  for (const [key, db] of dbQuizzes) {
    if (!repoQuizzes.has(key)) {
      orphanedInDb.push(db);
    }
  }

  // 4. Report
  console.log(`Repo: ${repoQuizzes.size} quiz files`);
  console.log(`DB:   ${dbQuizzes.size} quiz records`);
  console.log(`Missing from DB: ${missingFromDb.length}`);
  console.log(`Orphaned in DB:  ${orphanedInDb.length}`);
  console.log(`Content mismatch: ${contentMismatch.length}`);
  console.log(`In sync: ${inSync.length}`);

  if (missingFromDb.length > 0) {
    console.log('\nMissing from DB:');
    for (const q of missingFromDb) console.log(`  - ${q.filePath}`);
  }

  if (orphanedInDb.length > 0) {
    console.log('\nOrphaned in DB:');
    for (const q of orphanedInDb) console.log(`  - ${q.concept}/${q.filename}`);
  }

  if (contentMismatch.length > 0) {
    console.log('\nContent mismatch:');
    for (const q of contentMismatch) console.log(`  - ${q.filePath}`);
  }

  // 5. Fix if requested
  if (!doFix) {
    if (missingFromDb.length + orphanedInDb.length + contentMismatch.length > 0) {
      console.log('\nRun with --fix to resolve drift.');
    } else {
      console.log('\nAll in sync!');
    }
    return;
  }

  console.log('\nFixing drift...');
  let fixed = 0;
  let failed = 0;

  // Upsert missing and mismatched
  for (const q of [...missingFromDb, ...contentMismatch]) {
    const payload = {
      pillar: q.pillar,
      concept: q.concept,
      filename: q.filename,
      author: q.data.author,
      date: q.data.date,
      question: q.data.question,
      options: q.data.options,
    };
    try {
      const res = await apiRequest('POST', '/api/quiz', payload);
      if (res.status >= 200 && res.status < 300) {
        console.log(`  \u2705 Upserted: ${q.filePath}`);
        fixed++;
      } else {
        console.log(`  \u274C Failed: ${q.filePath} (${res.status})`);
        failed++;
      }
    } catch (err) {
      console.log(`  \u274C Failed: ${q.filePath} (${err.message})`);
      failed++;
    }
  }

  // Delete orphaned
  for (const q of orphanedInDb) {
    const payload = {
      pillar: q.pillar || 'unknown',
      concept: q.concept,
      filename: q.filename,
    };
    try {
      const res = await apiRequest('DELETE', '/api/quiz', payload);
      if (res.status >= 200 && res.status < 300) {
        console.log(`  \u2705 Deleted orphan: ${q.concept}/${q.filename}`);
        fixed++;
      } else {
        console.log(`  \u274C Failed to delete: ${q.concept}/${q.filename} (${res.status})`);
        failed++;
      }
    } catch (err) {
      console.log(`  \u274C Failed to delete: ${q.concept}/${q.filename} (${err.message})`);
      failed++;
    }
  }

  console.log(`\nDone: ${fixed} fixed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
