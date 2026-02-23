#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/validate-quiz.js <file1.yaml> [file2.yaml ...]');
  process.exit(1);
}

const PR_AUTHOR = (process.env.PR_AUTHOR || '').toLowerCase();
const repoRoot = path.resolve(__dirname, '..');

let allPassed = true;
const markdownParts = ['## \uD83E\uDDF1 Quiz Validation Results\n'];

for (const filePath of files) {
  const absPath = path.resolve(filePath);
  const relPath = path.relative(repoRoot, absPath);
  const basename = path.basename(filePath);
  const quizDir = path.dirname(absPath);

  console.log(`\nValidating: ${relPath}`);
  markdownParts.push(`### \`${relPath}\`\n`);
  markdownParts.push('| Check | Result |');
  markdownParts.push('|-------|--------|');

  const results = [];
  let data = null;

  // Check 1: Valid YAML
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    data = yaml.load(content);
    results.push({ name: 'Valid YAML', pass: true });
  } catch (e) {
    results.push({ name: 'Valid YAML', pass: false, msg: e.message });
  }

  if (!data || typeof data !== 'object') {
    results.push({ name: 'Required fields', pass: false, msg: 'Could not parse file' });
    for (const r of results) {
      const icon = r.pass ? '\u2705' : '\u274C';
      const detail = r.msg ? ` (${r.msg})` : '';
      console.log(`  ${icon} ${r.name}${detail}`);
      markdownParts.push(`| ${r.name} | ${icon}${detail} |`);
    }
    markdownParts.push('');
    markdownParts.push('**Result: \u274C Failed (parse error)**\n');
    allPassed = false;
    continue;
  }

  // Check 2: Required fields
  const requiredFields = ['author', 'date', 'question', 'options'];
  const missingFields = requiredFields.filter(f => !(f in data));
  results.push({
    name: 'Required fields',
    pass: missingFields.length === 0,
    msg: missingFields.length > 0 ? `Missing: ${missingFields.join(', ')}` : undefined,
  });

  // Check 3: Exactly 4 options
  const options = Array.isArray(data.options) ? data.options : [];
  results.push({
    name: '4 options',
    pass: options.length === 4,
    msg: options.length !== 4 ? `Found ${options.length} options` : undefined,
  });

  // Check 4: Exactly 1 correct
  const correctCount = options.filter(o => o && o.correct === true).length;
  results.push({
    name: '1 correct answer',
    pass: correctCount === 1,
    msg: correctCount !== 1 ? `Found ${correctCount} correct` : undefined,
  });

  // Check 5: Each option has text + explanation
  let optFieldsOk = true;
  let optFieldsMsg = '';
  for (let i = 0; i < options.length; i++) {
    const o = options[i] || {};
    if (!o.text || typeof o.text !== 'string' || o.text.trim().length === 0) {
      optFieldsOk = false;
      optFieldsMsg += `Option ${i + 1} missing text. `;
    }
    if (!o.explanation || typeof o.explanation !== 'string' || o.explanation.trim().length === 0) {
      optFieldsOk = false;
      optFieldsMsg += `Option ${i + 1} missing explanation. `;
    }
  }
  results.push({
    name: 'Options have text + explanation',
    pass: optFieldsOk,
    msg: optFieldsOk ? undefined : optFieldsMsg.trim(),
  });

  // Check 6: Question substantive (>= 20 chars)
  const question = typeof data.question === 'string' ? data.question.trim() : '';
  results.push({
    name: 'Question substantive',
    pass: question.length >= 20,
    msg: question.length < 20 ? `Only ${question.length} chars (min 20)` : undefined,
  });

  // Check 7: Each explanation >= 10 chars
  let explOk = true;
  let explMsg = '';
  for (let i = 0; i < options.length; i++) {
    const o = options[i] || {};
    const expl = typeof o.explanation === 'string' ? o.explanation.trim() : '';
    if (expl.length < 10) {
      explOk = false;
      explMsg += `Option ${i + 1} explanation too short (${expl.length} chars). `;
    }
  }
  results.push({
    name: 'Explanations substantive',
    pass: explOk,
    msg: explOk ? undefined : explMsg.trim(),
  });

  // Check 8: Date valid (YYYY-MM-DD)
  let dateValid = false;
  if (data.date instanceof Date) {
    // js-yaml auto-parsed it — check it's a valid date
    dateValid = !isNaN(data.date.getTime());
  } else if (typeof data.date === 'string') {
    dateValid = /^\d{4}-\d{2}-\d{2}$/.test(data.date) && !isNaN(new Date(data.date).getTime());
  }
  results.push({
    name: 'Date valid',
    pass: dateValid,
    msg: dateValid ? undefined : `Invalid date: ${data.date}`,
  });

  // Check 9: Author matches PR author
  const yamlAuthor = typeof data.author === 'string' ? data.author.toLowerCase() : '';
  if (PR_AUTHOR) {
    results.push({
      name: 'Author matches PR author',
      pass: yamlAuthor === PR_AUTHOR,
      msg: yamlAuthor !== PR_AUTHOR ? `YAML="${data.author}" PR="${PR_AUTHOR}"` : undefined,
    });
  } else {
    results.push({ name: 'Author matches PR author', pass: true, msg: 'Skipped (no PR_AUTHOR env)' });
  }

  // Check 10: Filename matches author
  const fnameMatch = basename.match(/^q-(.+)-(\d+)\.yaml$/);
  let fnameAuthor = null;
  if (fnameMatch) {
    fnameAuthor = fnameMatch[1].toLowerCase();
  }
  results.push({
    name: 'Filename matches author',
    pass: fnameAuthor !== null && fnameAuthor === yamlAuthor,
    msg: fnameAuthor !== yamlAuthor
      ? `Filename handle="${fnameAuthor}" author="${yamlAuthor}"`
      : undefined,
  });

  // Check 11: Filename unique in target quiz/ directory
  let filenameUnique = true;
  let uniqueMsg;
  try {
    const existingFiles = fs.readdirSync(quizDir);
    const duplicates = existingFiles.filter(f => f === basename);
    // The file itself exists because we're validating it, so count > 1 means duplicate
    // But in a PR context the file might not be on disk yet — check if another file
    // with the same name exists that isn't the file itself
    // For a new PR the file is on disk (checked out), so just check it's the only one
    filenameUnique = duplicates.length <= 1;
    if (!filenameUnique) {
      uniqueMsg = `Duplicate filename in ${path.relative(repoRoot, quizDir)}`;
    }
  } catch {
    filenameUnique = true; // dir doesn't exist yet, will be caught by check 12
  }
  results.push({
    name: 'Filename unique',
    pass: filenameUnique,
    msg: uniqueMsg,
  });

  // Check 12: Target folder exists
  const folderExists = fs.existsSync(quizDir);
  results.push({
    name: 'Target folder exists',
    pass: folderExists,
    msg: folderExists ? undefined : `${path.relative(repoRoot, quizDir)} not found`,
  });

  // Output results
  let filePassed = true;
  for (const r of results) {
    const icon = r.pass ? '\u2705' : '\u274C';
    const detail = r.msg ? ` (${r.msg})` : '';
    console.log(`  ${icon} ${r.name}${detail}`);
    markdownParts.push(`| ${r.name} | ${icon}${detail} |`);
    if (!r.pass && !r.msg?.startsWith('Skipped')) filePassed = false;
  }

  markdownParts.push('');
  if (filePassed) {
    markdownParts.push('**Result: \u2705 All structural checks passed**\n');
  } else {
    markdownParts.push('**Result: \u274C Some checks failed**\n');
    allPassed = false;
  }
}

// Write markdown summary for CI
const markdownOutput = markdownParts.join('\n');
fs.writeFileSync(path.join(repoRoot, 'validation-results.md'), markdownOutput);

if (!allPassed) {
  console.log('\n\u274C Validation failed');
  process.exit(1);
} else {
  console.log('\n\u2705 All files passed validation');
}
