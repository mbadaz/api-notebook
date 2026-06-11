import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { HttpError } from './workspaceFs.js';

const execFileAsync = promisify(execFile);

// Generous timeout: the process is the open dialog, and the user may take
// a while to navigate. On timeout the dialog is killed and we report cancel.
const DIALOG_TIMEOUT_MS = 5 * 60_000;

interface ExecError extends Error {
  code?: number | string;
  stderr?: string;
  killed?: boolean;
}

function asExecError(err: unknown): ExecError {
  return err instanceof Error ? (err as ExecError) : new Error(String(err));
}

async function pickMac(title: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      [
        '-e',
        'tell application "System Events" to activate',
        '-e',
        `POSIX path of (choose folder with prompt ${JSON.stringify(title)})`,
      ],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return stdout.trim() || null;
  } catch (err) {
    const e = asExecError(err);
    // Exit code 1 with "User canceled. (-128)" on stderr means cancel.
    if (e.killed || /canceled|-128/i.test(e.stderr ?? '')) return null;
    throw err;
  }
}

async function pickWindows(title: string): Promise<string | null> {
  const psTitle = `'${title.replace(/'/g, "''")}'`;
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$d.Description = ${psTitle}`,
    '$d.ShowNewFolderButton = $true',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
  ].join('; ');
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-STA', '-Command', script],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return stdout.trim() || null;
  } catch (err) {
    if (asExecError(err).killed) return null;
    throw err;
  }
}

async function pickLinux(title: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'zenity',
      ['--file-selection', '--directory', '--title', title],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return stdout.trim() || null;
  } catch (err) {
    const e = asExecError(err);
    if (e.code === 1 || e.killed) return null; // dialog canceled
    if (e.code !== 'ENOENT') throw err;
  }
  try {
    const { stdout } = await execFileAsync(
      'kdialog',
      ['--getexistingdirectory', os.homedir(), '--title', title],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return stdout.trim() || null;
  } catch (err) {
    const e = asExecError(err);
    if (e.code === 1 || e.killed) return null;
    if (e.code === 'ENOENT') {
      throw new HttpError(
        501,
        'No folder picker found. Install "zenity" or "kdialog", or type the path manually.'
      );
    }
    throw err;
  }
}

export async function pickFolder(title: string): Promise<string | null> {
  try {
    switch (process.platform) {
      case 'darwin':
        return await pickMac(title);
      case 'win32':
        return await pickWindows(title);
      default:
        return await pickLinux(title);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new HttpError(
      500,
      `Could not open the system folder picker (${detail}). You can type the path manually.`
    );
  }
}
