import { readFile, writeFile } from 'node:fs/promises';
import { Document, parseDocument } from 'yaml';
import type { WizardAnswers, WorkType } from '../types/index.js';
import { DEFAULT_AUTONOMY_PER_WORK_TYPE, SCALE_WIP_DEFAULTS } from '../constants.js';

/**
 * Read and parse a YAML file, preserving comments.
 */
export async function readYamlDocument(filePath: string): Promise<Document> {
  const raw = await readFile(filePath, 'utf-8');
  return parseDocument(raw);
}

/**
 * Write a YAML Document back to file, preserving comments.
 */
export async function writeYamlDocument(filePath: string, doc: Document): Promise<void> {
  await writeFile(filePath, doc.toString(), 'utf-8');
}

/**
 * Apply wizard answers to the config.yaml Document.
 * Uses the Document API to set values while preserving YAML comments.
 *
 * The config.yaml structure (top-level keys):
 *   scale: solo | small-team | startup | enterprise
 *   autonomy:
 *     feature: 2
 *     enhancement: 2
 *     ...
 *   wip:
 *     building: 2
 *     pr_ready: 5
 *   board:
 *     provider: github
 *     github:
 *       owner: ""
 *       project_number: 0
 *   debt: ...
 *   costs: ...
 */
export function applyWizardToConfig(doc: Document, answers: WizardAnswers): void {
  // Set scale
  doc.set('scale', answers.scale);

  // Set WIP limits based on scale
  const wipDefaults = SCALE_WIP_DEFAULTS[answers.scale];
  doc.setIn(['wip', 'building'], wipDefaults.building);
  doc.setIn(['wip', 'pr_ready'], wipDefaults.pr_ready);

  // Set board provider
  doc.setIn(['board', 'provider'], answers.board);

  // Set autonomy per work type.
  // Start from the defaults and then override all values with the wizard's
  // chosen autonomy level. This gives users a uniform starting point while
  // still writing every work-type key so they can tune later.
  const workTypes = Object.keys(DEFAULT_AUTONOMY_PER_WORK_TYPE) as WorkType[];
  for (const wt of workTypes) {
    doc.setIn(['autonomy', wt], answers.autonomy);
  }
}
