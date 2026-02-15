import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import { VERSO_DIR, TEMPLATE_FILES } from '../constants.js';
import { ui, VersoError, handleError } from '../lib/ui.js';
import { getTemplatesDir } from '../lib/templates.js';
import { hashContent, generateChecksums, readChecksums, writeChecksums } from '../lib/checksums.js';
import { readYamlDocument, writeYamlDocument } from '../lib/config.js';
import { mergeYamlDocuments } from '../lib/yaml-merge.js';

export async function upgradeCommand(): Promise<void> {
  try {
    const projectRoot = process.cwd();
    const templatesDir = getTemplatesDir();

    ui.heading('Upgrading VERSO templates...');

    // Preflight: .verso/ must exist
    if (!existsSync(join(projectRoot, VERSO_DIR))) {
      throw new VersoError('.verso/ not found. Run `verso init` first.');
    }

    // Read existing checksums
    const manifest = await readChecksums(projectRoot);
    const originalHashes = manifest?.files ?? {};

    let updated = 0;
    let skipped = 0;
    let merged = 0;

    for (const relPath of TEMPLATE_FILES) {
      const localPath = join(projectRoot, relPath);
      const templatePath = join(templatesDir, relPath);

      // Check template exists in bundle
      if (!existsSync(templatePath)) {
        continue;
      }

      const templateContent = await readFile(templatePath, 'utf-8');
      const templateHash = hashContent(templateContent);

      // Check if local file exists
      if (!existsSync(localPath)) {
        // File missing locally — copy from template
        await writeFile(localPath, templateContent, 'utf-8');
        ui.success(`Added ${relPath} (new file)`);
        updated++;
        continue;
      }

      const localContent = await readFile(localPath, 'utf-8');
      const localHash = hashContent(localContent);

      // Already up to date?
      if (localHash === templateHash) {
        skipped++;
        continue;
      }

      // Special case: config.yaml — always merge
      if (relPath === '.verso/config.yaml') {
        const userDoc = await readYamlDocument(localPath);
        const templateDoc = await readYamlDocument(templatePath);
        mergeYamlDocuments(userDoc, templateDoc);
        await writeYamlDocument(localPath, userDoc);
        ui.success(`Merged ${relPath} (new keys added, your values preserved)`);
        merged++;
        continue;
      }

      const originalHash = originalHashes[relPath];

      if (localHash === originalHash) {
        // User hasn't modified — safe to auto-update
        await writeFile(localPath, templateContent, 'utf-8');
        ui.success(`Updated ${relPath}`);
        updated++;
      } else {
        // User has modified — ask
        ui.warn(`${relPath} has local modifications`);
        const overwrite = await confirm({
          message: `  Overwrite ${relPath} with the latest template?`,
          default: false,
        });

        if (overwrite) {
          await writeFile(localPath, templateContent, 'utf-8');
          ui.success(`Updated ${relPath}`);
          updated++;
        } else {
          ui.info(`Skipped ${relPath}`);
          skipped++;
        }
      }
    }

    // Update checksums
    const newChecksums = await generateChecksums(projectRoot);
    await writeChecksums(projectRoot, newChecksums);

    // Summary
    ui.blank();
    ui.info(`${updated} updated, ${merged} merged, ${skipped} skipped`);
    ui.blank();

  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error) {
      const e = error as { name: string };
      if (e.name === 'ExitPromptError') {
        ui.blank();
        ui.info('Upgrade cancelled.');
        process.exit(0);
      }
    }
    handleError(error);
  }
}
