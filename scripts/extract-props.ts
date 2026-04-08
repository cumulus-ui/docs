#!/usr/bin/env tsx
/**
 * extract-props.ts
 *
 * Uses the TypeScript type checker to extract all props (including inherited)
 * from component interfaces. Outputs JSON for PropsTable.astro.
 *
 * Usage: tsx scripts/extract-props.ts [component-name]
 */

import * as ts from 'typescript';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = resolve(__dirname, '..');
const COMPONENTS_SRC = resolve(DOCS_ROOT, '../components/src');
const COMPONENTS_ROOT = resolve(DOCS_ROOT, '../components');
const OUTPUT_DIR = resolve(DOCS_ROOT, 'src/data/props');

interface PropInfo {
  name: string;
  type: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

interface SlotInfo {
  name: string;
  description: string;
}

interface EventInfo {
  name: string;
  description: string;
  detailType?: string;
}

// Create a single program for the entire components source — type checker resolves all imports
const tsConfigPath = resolve(COMPONENTS_ROOT, 'tsconfig.json');
const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, COMPONENTS_ROOT);

// Collect all interfaces.ts files as program roots
const allInterfaceFiles = readdirSync(COMPONENTS_SRC, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'internal')
  .map(d => resolve(COMPONENTS_SRC, d.name, 'interfaces.ts'))
  .filter(f => existsSync(f));

const program = ts.createProgram(allInterfaceFiles, parsedConfig.options);
const checker = program.getTypeChecker();

function extractDefaults(componentName: string): Map<string, string> {
  const filePath = resolve(COMPONENTS_SRC, componentName, 'internal.ts');
  const defaults = new Map<string, string>();
  if (!existsSync(filePath)) return defaults;

  const source = readFileSync(filePath, 'utf-8');
  const pattern = /^\s+(?:override\s+)?(\w+)(?::\s*[^=]+)?\s*=\s*(.+);/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const [, name, rawValue] = match;
    defaults.set(name, rawValue.trim());
  }
  return defaults;
}

function getJsDocComment(symbol: ts.Symbol): string {
  const docs = symbol.getDocumentationComment(checker);
  return docs.map(d => d.text).join('').trim();
}

function extractProps(componentName: string): { props: PropInfo[]; slots: SlotInfo[]; events: EventInfo[] } {
  const filePath = resolve(COMPONENTS_SRC, componentName, 'interfaces.ts');
  if (!existsSync(filePath)) return { props: [], slots: [], events: [] };

  const sourceFile = program.getSourceFile(filePath);
  if (!sourceFile) return { props: [], slots: [], events: [] };

  let targetNode: ts.InterfaceDeclaration | undefined;
  ts.forEachChild(sourceFile, (node) => {
    if (
      ts.isInterfaceDeclaration(node) &&
      node.name.text.endsWith('Props') &&
      !node.name.text.includes('.')
    ) {
      targetNode = node;
    }
  });

  if (!targetNode) return { props: [], slots: [], events: [] };

  const targetSymbol = checker.getSymbolAtLocation(targetNode.name);
  if (!targetSymbol) return { props: [], slots: [], events: [] };

  // Get the declared type — this resolves all extends chains
  const targetType = checker.getDeclaredTypeOfSymbol(targetSymbol);
  const allProperties = checker.getPropertiesOfType(targetType);

  const defaults = extractDefaults(componentName);
  const props: PropInfo[] = [];
  const slots: SlotInfo[] = [];
  const events: EventInfo[] = [];

  for (const prop of allProperties) {
    const name = prop.getName();
    if (name === 'style') continue;

    const description = getJsDocComment(prop);

    const propType = checker.getTypeOfSymbolAtLocation(prop, targetNode);
    const typeString = prop.valueDeclaration && ts.isPropertySignature(prop.valueDeclaration) && prop.valueDeclaration.type
      ? prop.valueDeclaration.type.getText(prop.valueDeclaration.getSourceFile())
      : checker.typeToString(propType, targetNode, ts.TypeFormatFlags.NoTruncation);

    if (typeString === 'SlotContent') {
      const slotName = name === 'children' ? 'default' : name;
      slots.push({ name: slotName, description });
      continue;
    }
    if (typeString.startsWith('EventHandler')) {
      const eventName = name.startsWith('on') ? name.charAt(2).toLowerCase() + name.slice(3) : name;
      events.push({ name: eventName, description, detailType: typeString.replace('EventHandler', 'CustomEvent') });
      continue;
    }

    const required = !(prop.flags & ts.SymbolFlags.Optional);

    const propInfo: PropInfo = { name, type: typeString, description, required };
    const defaultValue = defaults.get(name);
    if (defaultValue !== undefined) propInfo.defaultValue = defaultValue;
    props.push(propInfo);
  }

  return {
    props: props.sort((a, b) => a.name.localeCompare(b.name)),
    slots: slots.sort((a, b) => a.name.localeCompare(b.name)),
    events: events.sort((a, b) => a.name.localeCompare(b.name)),
  };
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
  const { props, slots, events } = extractProps(name);
  if (props.length === 0 && slots.length === 0 && events.length === 0) continue;

  const outPath = resolve(OUTPUT_DIR, `${name}.json`);
  writeFileSync(outPath, JSON.stringify({ props, slots, events }, null, 2) + '\n');
  console.log(`  ✓ ${name} → ${props.length} props, ${slots.length} slots, ${events.length} events`);
  count++;
}

console.log(`\nExtracted props for ${count} components.`);
