#!/usr/bin/env tsx
/**
 * extract-props.ts
 *
 * Parses component interfaces.ts files using the TypeScript compiler API
 * and extracts prop names, types, descriptions, and optionality.
 * Outputs JSON files for use by PropsTable.astro.
 *
 * Usage: tsx scripts/extract-props.ts [component-name]
 *   No argument → extracts all components
 *   With argument → extracts single component (e.g. "badge")
 */

import * as ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(__dirname, '..');
const COMPONENTS_SRC = resolve(DOCS_ROOT, '../components/src');
const OUTPUT_DIR = resolve(DOCS_ROOT, 'src/data/props');

interface PropInfo {
  name: string;
  type: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

function extractProps(componentName: string): PropInfo[] {
  const filePath = resolve(COMPONENTS_SRC, componentName, 'interfaces.ts');
  if (!existsSync(filePath)) {
    console.warn(`  ⚠ No interfaces.ts for ${componentName}`);
    return [];
  }

  const source = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const props: PropInfo[] = [];

  // Find the main *Props interface (e.g. BadgeProps, CheckboxProps)
  const suffix = 'Props';
  let targetInterface: ts.InterfaceDeclaration | undefined;

  ts.forEachChild(sourceFile, (node) => {
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text.endsWith(suffix) &&
      !node.name.text.includes('.')
    ) {
      targetInterface = node;
    }
  });

  if (!targetInterface) {
    console.warn(`  ⚠ No *Props interface found in ${componentName}/interfaces.ts`);
    return [];
  }

  for (const member of targetInterface.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;

    const name = member.name.getText(sourceFile);

    // Skip internal props (style overrides, slots, events documented as JSDoc-only)
    if (name === 'style') continue;

    const required = !member.questionToken;
    const type = member.type ? member.type.getText(sourceFile) : 'unknown';

    // Extract JSDoc description
    const jsDocs = ts.getJSDocCommentsAndTags(member);
    let description = '';
    for (const doc of jsDocs) {
      if (ts.isJSDoc(doc) && doc.comment) {
        description = typeof doc.comment === 'string'
          ? doc.comment
          : doc.comment.map(c => c.getText(sourceFile)).join('');
        break;
      }
    }

    // Skip @slot and @event markers (JSDoc-only documentation, not real props)
    if (description.startsWith('@slot') || description.startsWith('@event')) continue;

    props.push({ name, type, description: description.trim(), required });
  }

  return props;
}

// ─── Main ──────────────────────────────────────────────

const target = process.argv[2];

if (!existsSync(COMPONENTS_SRC)) {
  console.log(`Components source not found at ${COMPONENTS_SRC}, skipping generation.`);
  process.exit(0);
}

const components = target
  ? [target]
  : readdirSync(COMPONENTS_SRC, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'internal')
      .map(d => d.name);

let count = 0;
for (const name of components) {
  const props = extractProps(name);
  if (props.length === 0) continue;

  const outPath = resolve(OUTPUT_DIR, `${name}.json`);
  writeFileSync(outPath, JSON.stringify(props, null, 2) + '\n');
  console.log(`  ✓ ${name} → ${props.length} props`);
  count++;
}

console.log(`\nExtracted props for ${count} components.`);
