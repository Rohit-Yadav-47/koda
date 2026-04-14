import chalk from 'chalk';
import { readFileSync, existsSync } from 'fs';
import { resolve, isAbsolute, relative } from 'path';

const DIM = chalk.dim;
const RED = chalk.red;
const GREEN = chalk.green;
const BOLD_WHITE = chalk.bold.white;
const LINE_SEP = DIM('─'.repeat(52));

function lineNum(n: number): string {
  return DIM(String(n).padStart(4) + '│ ');
}

function blankNum(): string {
  return DIM('    │ ');
}

/**
 * Generate a colored diff preview for edit_file operations.
 * Shows the old_string → new_string replacement with surrounding context.
 */
export function generateEditDiff(
  filePath: string,
  oldString: string,
  newString: string,
  root: string,
): string {
  try {
    const absPath = isAbsolute(filePath) ? filePath : resolve(root, filePath);
    const relPath = relative(root, absPath);

    if (!existsSync(absPath)) {
      return `  ${BOLD_WHITE(relPath)}\n  ${LINE_SEP}\n  ${DIM('(file not found — will fail)')}`;
    }

    const content = readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    const idx = content.indexOf(oldString);
    if (idx === -1) {
      return `  ${BOLD_WHITE(relPath)}\n  ${LINE_SEP}\n  ${RED('old_string not found in file')}`;
    }

    // Calculate line positions
    const beforeIdx = content.slice(0, idx).split('\n').length - 1;
    const oldLines = oldString.split('\n');
    const newLines = newString.split('\n');

    const CONTEXT = 3;
    const startLine = Math.max(0, beforeIdx - CONTEXT);
    const endLine = Math.min(lines.length, beforeIdx + oldLines.length + CONTEXT);

    const output: string[] = [];
    output.push(`  ${BOLD_WHITE(relPath)}`);
    output.push(`  ${LINE_SEP}`);

    // Context before
    for (let i = startLine; i < beforeIdx; i++) {
      output.push(`  ${lineNum(i + 1)}${DIM(lines[i])}`);
    }

    // Removed lines (old_string)
    for (const line of oldLines) {
      output.push(`  ${blankNum()}${RED('- ' + line)}`);
    }

    // Added lines (new_string)
    for (const line of newLines) {
      output.push(`  ${blankNum()}${GREEN('+ ' + line)}`);
    }

    // Context after
    for (let i = beforeIdx + oldLines.length; i < endLine; i++) {
      output.push(`  ${lineNum(i + 1)}${DIM(lines[i])}`);
    }

    return output.join('\n');
  } catch (e: any) {
    return `  ${DIM('(diff preview unavailable: ' + e.message + ')')}`;
  }
}

/**
 * Generate a colored diff preview for write_file operations.
 * For new files: shows first N lines as additions.
 * For existing files: shows a line-level diff of changes.
 */
export function generateWriteDiff(
  filePath: string,
  newContent: string,
  root: string,
): string {
  try {
    const absPath = isAbsolute(filePath) ? filePath : resolve(root, filePath);
    const relPath = relative(root, absPath);
    const exists = existsSync(absPath);
    const newLines = newContent.split('\n');

    const output: string[] = [];
    output.push(`  ${BOLD_WHITE(relPath)}`);
    output.push(`  ${LINE_SEP}`);

    if (!exists) {
      // New file
      output.push(`  ${GREEN(DIM(`(new file — ${newLines.length} lines)`))}`);
      const maxPreview = 25;
      for (let i = 0; i < Math.min(newLines.length, maxPreview); i++) {
        output.push(`  ${blankNum()}${GREEN('+ ' + newLines[i])}`);
      }
      if (newLines.length > maxPreview) {
        output.push(`  ${DIM(`  ... ${newLines.length - maxPreview} more lines`)}`);
      }
    } else {
      // Existing file — show diff
      const oldContent = readFileSync(absPath, 'utf-8');
      const oldLines = oldContent.split('\n');

      output.push(`  ${DIM(`${oldLines.length} lines → ${newLines.length} lines`)}`);

      // Find diff regions
      const changes = computeLineDiff(oldLines, newLines);

      if (changes.length === 0) {
        output.push(`  ${DIM('(no changes)')}`);
      } else {
        // Show up to 40 diff lines
        let linesShown = 0;
        const MAX_DIFF_LINES = 40;

        for (const chunk of changes) {
          if (linesShown >= MAX_DIFF_LINES) {
            output.push(`  ${DIM('  ... more changes not shown')}`);
            break;
          }

          // Context before chunk
          const ctxStart = Math.max(0, chunk.oldStart - 2);
          for (let i = ctxStart; i < chunk.oldStart; i++) {
            output.push(`  ${lineNum(i + 1)}${DIM(oldLines[i])}`);
            linesShown++;
          }

          // Removed lines
          for (let i = chunk.oldStart; i < chunk.oldStart + chunk.oldCount; i++) {
            output.push(`  ${blankNum()}${RED('- ' + oldLines[i])}`);
            linesShown++;
          }

          // Added lines
          for (let i = chunk.newStart; i < chunk.newStart + chunk.newCount; i++) {
            output.push(`  ${blankNum()}${GREEN('+ ' + newLines[i])}`);
            linesShown++;
          }

          // Context after chunk
          const afterEnd = Math.min(oldLines.length, chunk.oldStart + chunk.oldCount + 2);
          for (let i = chunk.oldStart + chunk.oldCount; i < afterEnd; i++) {
            output.push(`  ${lineNum(i + 1)}${DIM(oldLines[i])}`);
            linesShown++;
          }

          if (linesShown < MAX_DIFF_LINES) {
            output.push(`  ${DIM('  ...')}`);
          }
        }
      }
    }

    return output.join('\n');
  } catch (e: any) {
    return `  ${DIM('(diff preview unavailable: ' + e.message + ')')}`;
  }
}

interface DiffChunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

/**
 * Simple line-level diff — finds contiguous regions of change.
 * Not a full Myers diff, but good enough for preview purposes.
 */
function computeLineDiff(oldLines: string[], newLines: string[]): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  let i = 0;
  while (i < maxLen) {
    // Skip matching lines
    if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
      i++;
      continue;
    }

    // Found a difference — find the extent
    const start = i;

    // Scan forward to find next matching region
    let oldEnd = start;
    let newEnd = start;

    // Try to find a sync point (3 consecutive matching lines)
    let synced = false;
    for (let scan = start; scan < maxLen && scan < start + 100; scan++) {
      // Check if we can sync at this position
      for (let oj = start; oj <= Math.min(scan, oldLines.length); oj++) {
        for (let nj = start; nj <= Math.min(scan, newLines.length); nj++) {
          if (
            oj < oldLines.length && nj < newLines.length &&
            oldLines[oj] === newLines[nj] &&
            (oj + 1 >= oldLines.length || nj + 1 >= newLines.length || oldLines[oj + 1] === newLines[nj + 1])
          ) {
            oldEnd = oj;
            newEnd = nj;
            synced = true;
            break;
          }
        }
        if (synced) break;
      }
      if (synced) break;
    }

    if (!synced) {
      oldEnd = oldLines.length;
      newEnd = newLines.length;
    }

    if (oldEnd > start || newEnd > start) {
      chunks.push({
        oldStart: start,
        oldCount: oldEnd - start,
        newStart: start,
        newCount: newEnd - start,
      });
    }

    i = Math.max(oldEnd, newEnd);
    if (i === start) i++; // prevent infinite loop
  }

  return chunks;
}
